//! The events this process has already parsed, kept between loads.
//!
//! A log only ever grows, so most loads differ from the last by a few lines
//! at the end of one file. The store keeps each file's events up to the last
//! newline it parsed, with a hash of those bytes; the next load hashes the
//! same prefix of the new bytes and, when it matches, parses only what came
//! after. Anything else — a shorter file, a different prefix, a new name —
//! is parsed whole, and a name that is gone is dropped.
//!
//! One events directory at a time: switching projects starts over. The
//! trailing partial line of a file is parsed on every load and never kept,
//! so a line completed by a later append is seen whole, once.
//!
//! The store also remembers which stored event the host's own cache holds
//! for each id, so a load can hand over only what the host has not seen: a
//! file parsed again bumps its generation, and every cache entry that pointed
//! into it stops matching.

use std::cell::RefCell;
use std::hash::Hasher;

use rustc_hash::{FxHashMap, FxHasher};

use crate::frame::NamedBytes;
use crate::model::{Origin, RawEvent, Unreadable};
use crate::parse::{parse_actor, parse_lines, Actor};

struct FileEntry {
    /// Stable for the store's lifetime, whatever order the files arrive in.
    file_id: u32,
    /// Bumped every time the file is parsed from the start.
    generation: u32,
    actor: Actor,
    /// Bytes parsed and kept: up to and including the last newline.
    parsed_len: usize,
    hash: u64,
    /// Complete lines in the kept prefix, so a later line keeps its number.
    lines: usize,
    events: Vec<RawEvent>,
    unreadable: Vec<Unreadable>,
}

/// An id as a map key without an allocation: nearly every id is a 26-byte
/// ULID, which fits inline; anything else goes through the fallback.
#[derive(Default)]
pub struct HostCache {
    ulids: FxHashMap<[u8; 26], Origin>,
    others: FxHashMap<String, Origin>,
}

impl HostCache {
    pub fn clear(&mut self) {
        self.ulids.clear();
        self.others.clear();
    }

    fn get(&self, id: &str) -> Option<Origin> {
        match <[u8; 26]>::try_from(id.as_bytes()) {
            Ok(key) => self.ulids.get(&key).copied(),
            Err(_) => self.others.get(id).copied(),
        }
    }

    fn set(&mut self, id: &str, origin: Origin) {
        match <[u8; 26]>::try_from(id.as_bytes()) {
            Ok(key) => {
                self.ulids.insert(key, origin);
            }
            Err(_) => {
                self.others.insert(id.to_string(), origin);
            }
        }
    }

    fn remove(&mut self, id: &str) {
        match <[u8; 26]>::try_from(id.as_bytes()) {
            Ok(key) => {
                self.ulids.remove(&key);
            }
            Err(_) => {
                self.others.remove(id);
            }
        }
    }

    /// Whether the host must be handed this event: true unless its cache
    /// already holds exactly this stored one. Records the answer.
    pub fn needs(&mut self, id: &str, origin: Option<Origin>) -> bool {
        match origin {
            Some(origin) if self.get(id) == Some(origin) => false,
            Some(origin) => {
                self.set(id, origin);
                true
            }
            // A trailing line's event is never kept, so nothing it puts in
            // the host's cache can be trusted next time.
            None => {
                self.remove(id);
                true
            }
        }
    }
}

pub struct Store {
    root: String,
    files: FxHashMap<String, FileEntry>,
    file_ids: FxHashMap<String, u32>,
    host_cache: HostCache,
}

thread_local! {
    static STORE: RefCell<Option<Store>> = const { RefCell::new(None) };
}

/// What one load sees: the kept events of every file in the order given,
/// then the events of every trailing partial line, and every quarantine
/// entry in the same order.
pub struct Snapshot<'a> {
    pub events: Vec<&'a RawEvent>,
    pub unreadable: Vec<Unreadable>,
}

fn hash_of(bytes: &[u8]) -> u64 {
    let mut hasher = FxHasher::default();
    hasher.write(bytes);
    hasher.finish()
}

/// The length up to and including the last newline; zero when there is none.
fn complete_prefix_len(bytes: &[u8]) -> usize {
    bytes.iter().rposition(|&b| b == b'\n').map_or(0, |at| at + 1)
}

impl Store {
    fn new(root: &str) -> Self {
        Store {
            root: root.to_string(),
            files: FxHashMap::default(),
            file_ids: FxHashMap::default(),
            host_cache: HostCache::default(),
        }
    }

    fn file_id(&mut self, name: &str) -> u32 {
        let next = self.file_ids.len() as u32;
        *self.file_ids.entry(name.to_string()).or_insert(next)
    }

    /// Brings one file up to date: reuses the kept prefix when its bytes are
    /// what they were, parses the tail or the whole file otherwise.
    fn update_file(
        &mut self,
        previous: Option<FileEntry>,
        name: &str,
        bytes: &[u8],
    ) -> Result<(), String> {
        let parsed_len = complete_prefix_len(bytes);

        let mut entry = match previous {
            Some(entry)
                if entry.parsed_len <= parsed_len
                    && hash_of(&bytes[..entry.parsed_len]) == entry.hash =>
            {
                entry
            }
            previous => FileEntry {
                file_id: self.file_id(name),
                generation: previous.map_or(0, |entry| entry.generation + 1),
                actor: parse_actor(name)?,
                parsed_len: 0,
                hash: hash_of(&[]),
                lines: 0,
                events: Vec::new(),
                unreadable: Vec::new(),
            },
        };

        if entry.parsed_len < parsed_len {
            let tail = &bytes[entry.parsed_len..parsed_len];
            let text = String::from_utf8_lossy(tail);
            let lines = parse_lines(
                name,
                &entry.actor,
                &text,
                entry.lines,
                Some((entry.file_id, entry.generation)),
                &mut entry.events,
                &mut entry.unreadable,
            );

            entry.lines += lines;
            entry.parsed_len = parsed_len;
            entry.hash = hash_of(&bytes[..parsed_len]);
        }

        self.files.insert(name.to_string(), entry);

        Ok(())
    }
}

/// Updates the store for `root` from these files and answers with a view of
/// everything they hold, in the order the files were given, plus the host
/// cache to consult and update.
pub fn with_snapshot<T>(
    root: &str,
    files: &[NamedBytes<'_>],
    answer: impl FnOnce(Snapshot<'_>, &mut HostCache) -> T,
) -> Result<T, String> {
    STORE.with(|cell| {
        let mut slot = cell.borrow_mut();

        let store = match slot.as_mut() {
            Some(store) if store.root == root => store,
            _ => slot.insert(Store::new(root)),
        };

        let mut kept = std::mem::take(&mut store.files);

        for file in files {
            store.update_file(kept.remove(file.name), file.name, file.data)?;
        }

        // What is left in `kept` vanished from the directory; dropped with it.
        drop(kept);

        let Store {
            files: entries,
            host_cache,
            ..
        } = &mut *store;

        let mut events: Vec<&RawEvent> = Vec::new();
        let mut unreadable: Vec<Unreadable> = Vec::new();
        let mut trailing: Vec<RawEvent> = Vec::new();

        for file in files {
            let entry = &entries[file.name];
            events.extend(entry.events.iter());
            unreadable.extend(entry.unreadable.iter().cloned());

            let rest = &file.data[entry.parsed_len..];
            if !rest.is_empty() {
                let text = String::from_utf8_lossy(rest);
                parse_lines(
                    file.name,
                    &entry.actor,
                    &text,
                    entry.lines,
                    None,
                    &mut trailing,
                    &mut unreadable,
                );
            }
        }

        // The trailing lines belong to this load only; they live as long as
        // the snapshot does.
        events.extend(trailing.iter());

        Ok(answer(Snapshot { events, unreadable }, host_cache))
    })
}

/// Forgets everything, for tests that must see a cold load.
#[cfg(test)]
pub fn reset() {
    STORE.with(|cell| *cell.borrow_mut() = None);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot_ids(
        root: &str,
        files: &[(&str, &[u8])],
    ) -> (Vec<String>, Vec<String>, Vec<Option<Origin>>) {
        let files: Vec<NamedBytes<'_>> = files
            .iter()
            .map(|(name, data)| NamedBytes { name, data })
            .collect();

        with_snapshot(root, &files, |snapshot, _| {
            (
                snapshot.events.iter().map(|e| e.id.clone()).collect(),
                snapshot.unreadable.iter().map(|u| u.detail.clone()).collect(),
                snapshot.events.iter().map(|e| e.origin).collect(),
            )
        })
        .unwrap()
    }

    fn ids(root: &str, files: &[(&str, &[u8])]) -> (Vec<String>, Vec<String>) {
        let (ids, unreadable, _) = snapshot_ids(root, files);
        (ids, unreadable)
    }

    fn line(id: &str) -> String {
        format!("{{\"v\":1,\"id\":[\"{id}\",null],\"x\":{{}}}}\n")
    }

    #[test]
    fn parses_only_the_appended_tail() {
        reset();
        let one = line("01A");
        let (first, _) = ids("r", &[("01A.a.jsonl", one.as_bytes())]);
        assert_eq!(first, ["01A"]);

        let two = format!("{one}{}", line("01B"));
        let (second, _, origins) = snapshot_ids("r", &[("01A.a.jsonl", two.as_bytes())]);
        assert_eq!(second, ["01A", "01B"]);
        assert_eq!(origins[1], Some(Origin { file_id: 0, generation: 0, index: 1 }));

        STORE.with(|cell| {
            let slot = cell.borrow();
            let entry = &slot.as_ref().unwrap().files["01A.a.jsonl"];
            assert_eq!(entry.lines, 2);
            assert_eq!(entry.parsed_len, two.len());
        });
    }

    #[test]
    fn reparses_a_rewritten_prefix_and_a_shorter_file_with_a_new_generation() {
        reset();
        let two = format!("{}{}", line("01A"), line("01B"));
        let (_, _, origins) = snapshot_ids("r", &[("01A.a.jsonl", two.as_bytes())]);
        assert_eq!(origins[0].unwrap().generation, 0);

        let rewritten = format!("{}{}", line("01C"), line("01B"));
        let (after_rewrite, _, origins) = snapshot_ids("r", &[("01A.a.jsonl", rewritten.as_bytes())]);
        assert_eq!(after_rewrite, ["01C", "01B"]);
        assert_eq!(origins[0].unwrap().generation, 1);

        let shorter = line("01D");
        let (after_shrink, _, origins) = snapshot_ids("r", &[("01A.a.jsonl", shorter.as_bytes())]);
        assert_eq!(after_shrink, ["01D"]);
        assert_eq!(origins[0].unwrap().generation, 2);
    }

    #[test]
    fn a_partial_last_line_is_seen_whole_once_completed_and_has_no_origin() {
        reset();
        let partial = "{\"v\":1,\"id\":[\"01A\",null],\"x\":{}}\n{\"v\":1,\"id\":[\"01B\",null],\"x\":{}}";
        let (first, unreadable, origins) = snapshot_ids("r", &[("01A.a.jsonl", partial.as_bytes())]);
        assert_eq!(first, ["01A", "01B"]);
        assert!(unreadable.is_empty());
        assert!(origins[0].is_some());
        assert!(origins[1].is_none());

        let completed = format!("{partial}\n{}", line("01C"));
        let (second, _, origins) = snapshot_ids("r", &[("01A.a.jsonl", completed.as_bytes())]);
        assert_eq!(second, ["01A", "01B", "01C"]);
        assert!(origins.iter().all(Option::is_some));
    }

    #[test]
    fn keeps_line_numbers_across_loads() {
        reset();
        let first = format!("{}bad\n", line("01A"));
        ids("r", &[("01A.a.jsonl", first.as_bytes())]);

        let second = format!("{first}worse\n");
        let (_, unreadable) = ids("r", &[("01A.a.jsonl", second.as_bytes())]);
        assert_eq!(
            unreadable,
            ["01A.a.jsonl:2 (invalid JSON)", "01A.a.jsonl:3 (invalid JSON)"]
        );
    }

    #[test]
    fn drops_a_vanished_file_and_starts_over_for_another_root() {
        reset();
        let a = line("01A");
        let b = line("01B");
        ids("r", &[("01A.a.jsonl", a.as_bytes()), ("01B.b.jsonl", b.as_bytes())]);

        let (only_b, _) = ids("r", &[("01B.b.jsonl", b.as_bytes())]);
        assert_eq!(only_b, ["01B"]);
        STORE.with(|cell| {
            assert_eq!(cell.borrow().as_ref().unwrap().files.len(), 1);
        });

        let (other_root, _) = ids("elsewhere", &[("01A.a.jsonl", a.as_bytes())]);
        assert_eq!(other_root, ["01A"]);
        STORE.with(|cell| {
            let slot = cell.borrow();
            let store = slot.as_ref().unwrap();
            assert_eq!(store.root, "elsewhere");
            assert_eq!(store.files.len(), 1);
        });
    }

    #[test]
    fn a_bad_file_name_fails_the_load() {
        reset();
        let files = [NamedBytes { name: "01B..jsonl", data: b"" }];
        assert!(with_snapshot("r", &files, |_, _| ()).is_err());
    }

    #[test]
    fn the_host_cache_asks_for_an_event_once_per_stored_copy() {
        let mut cache = HostCache::default();
        let here = Origin { file_id: 0, generation: 0, index: 3 };
        let reparsed = Origin { file_id: 0, generation: 1, index: 3 };
        let elsewhere = Origin { file_id: 1, generation: 0, index: 0 };

        for id in ["01ARZ3NDEKTSV4RRFFQ69G5FAV", "short"] {
            assert!(cache.needs(id, Some(here)));
            assert!(!cache.needs(id, Some(here)));
            assert!(cache.needs(id, Some(reparsed)));
            assert!(cache.needs(id, Some(elsewhere)));
            assert!(!cache.needs(id, Some(elsewhere)));
            assert!(cache.needs(id, None));
            assert!(cache.needs(id, Some(elsewhere)));
        }

        cache.clear();
        assert!(cache.needs("short", Some(elsewhere)));
    }
}
