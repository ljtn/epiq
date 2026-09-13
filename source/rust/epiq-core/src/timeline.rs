//! The timeline's derived view of the log: every event as the entry a client
//! receives, in the order their effective times put them, each carrying the
//! board it belongs to. Ports `buildTimelineEntries` (`mcp/timeline-index.ts`)
//! with `formatLogAction` and `getStringColor` behind it, phrase for phrase.
//!
//! Built once per state of the store and kept there, because deriving it is
//! O(the whole history) and answering a window off it is O(the window). Tag,
//! contributor and swimlane names come from the log's own create events, so a
//! name renamed later reads under the one it was created with — what the log
//! itself says happened at the moment being described.

use std::cmp::Ordering;

use rustc_hash::{FxHashMap, FxHashSet};
use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};
use serde_json::value::RawValue;

use crate::decode::decode_one;
use crate::model::{RawEvent, Unreadable};
use crate::pairs::{is_string, Pairs};
use crate::parse::is_js_space;
use crate::times::{decode_time, effective_times};

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Identity {
    pub id: String,
    pub name: String,
    pub color: String,
}

/// One event, ready to send. `board` is not part of what a client receives —
/// it is how a request narrows to its own board without walking the log.
#[derive(Clone, Debug)]
pub struct Entry {
    pub id: String,
    pub t: f64,
    pub action: String,
    pub label: String,
    pub issue: Option<String>,
    pub board: Option<String>,
    pub actor: Option<Identity>,
    pub tag: Option<Identity>,
    pub assignee: Option<Identity>,
}

/// A JavaScript number: an integral value prints without a fraction.
pub struct JsNumber(pub f64);

impl Serialize for JsNumber {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        if self.0.fract() == 0.0 && self.0.abs() < 9.0e15 {
            serializer.serialize_i64(self.0 as i64)
        } else {
            serializer.serialize_f64(self.0)
        }
    }
}

/// The entry as a client receives it: without the board.
pub struct Sent<'a>(pub &'a Entry);

impl Serialize for Sent<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let e = self.0;
        let mut s = serializer.serialize_struct("Entry", 8)?;
        s.serialize_field("id", &e.id)?;
        s.serialize_field("t", &JsNumber(e.t))?;
        s.serialize_field("action", &e.action)?;
        s.serialize_field("label", &e.label)?;
        s.serialize_field("issue", &e.issue)?;
        s.serialize_field("actor", &e.actor)?;
        s.serialize_field("tag", &e.tag)?;
        s.serialize_field("assignee", &e.assignee)?;
        s.end()
    }
}

/// The TUI's phrasing minus the details that need state.
pub fn format_log_action(action: &str) -> String {
    let phrase = match action {
        "add.issue" => "Created with title",
        "add.issue.assignee" => "Assigned to",
        "remove.issue.assignee" => "Unassigned from",
        "close.issue" => "Closed",
        "delete.node" => "Deleted",
        "edit.title" => "Changed title to",
        "edit.description" => "Changed description",
        "reopen.issue" => "Reopened",
        "add.issue.tag" => "Tagged with",
        "remove.issue.tag" => "Removed tag",
        "lock.node" => "Locked node",
        "move.node" => "Moved issue",
        "add.issue.comment" => "Commented",
        "delete.issue.comment" => "Deleted comment",
        "add.issue.attachment" => "Attached",
        "delete.issue.attachment" => "Removed attachment",
        "edit.issue.comment" => "Edited comment",
        "init.workspace" | "add.workspace" => "Created workspace",
        "add.board" => "Created board",
        "add.swimlane" => "Created swimlane",
        "add.field" => "Added field",
        "create.tag" => "Created tag",
        "tombstone.tag" => "Deleted tag",
        "restore.tag" => "Restored tag",
        "create.contributor" => "Added contributor",
        "rename.contributor" => "Renamed contributor",
        "link.contributor.user" => "Linked contributor",
        "tombstone.contributor" => "Removed contributor",
        "restore.contributor" => "Restored contributor",
        "rebalance.children" => "Rebalanced order",
        other => {
            return if other.ends_with('e') {
                format!("{other}d")
            } else {
                format!("{other}ed")
            }
        }
    };

    phrase.to_string()
}

// ---- colours: `getStringColor` ------------------------------------------

/// `hashString`: `(hash * 31 + code) >>> 0` over UTF-16 code units.
fn hash_string(value: &str) -> u32 {
    value
        .encode_utf16()
        .fold(0u32, |hash, unit| hash.wrapping_mul(31).wrapping_add(unit as u32))
}

fn hsl_to_rgb(h: f64, s: f64, l: f64) -> [u8; 3] {
    let sat = s / 100.0;
    let light = l / 100.0;

    let c = (1.0 - (2.0 * light - 1.0).abs()) * sat;
    let hh = h / 60.0;
    let x = c * (1.0 - ((hh % 2.0) - 1.0).abs());

    let (r, g, b) = if (0.0..1.0).contains(&hh) {
        (c, x, 0.0)
    } else if (1.0..2.0).contains(&hh) {
        (x, c, 0.0)
    } else if (2.0..3.0).contains(&hh) {
        (0.0, c, x)
    } else if (3.0..4.0).contains(&hh) {
        (0.0, x, c)
    } else if (4.0..5.0).contains(&hh) {
        (x, 0.0, c)
    } else {
        (c, 0.0, x)
    };

    let m = light - c / 2.0;
    let channel = |v: f64| ((v + m) * 255.0).round() as u8;

    [channel(r), channel(g), channel(b)]
}

const STRING_COLOR_SATURATION: f64 = 50.0;
const STRING_COLOR_LIGHTNESS: f64 = 60.0;

fn string_to_hsl_hex(value: &str) -> String {
    let hue = (hash_string(value) % 360) as f64;
    let [r, g, b] = hsl_to_rgb(hue, STRING_COLOR_SATURATION, STRING_COLOR_LIGHTNESS);

    format!("#{r:02x}{g:02x}{b:02x}")
}

/// `getStringColor`: a well-known tag's colour from the table, anyone else's
/// hashed from the lower-cased, trimmed name.
pub fn string_color(name: &str, tag_colors: &FxHashMap<String, String>) -> String {
    let normalized = name.to_lowercase();
    let normalized = normalized.trim_matches(is_js_space);

    if !normalized.is_empty() {
        if let Some(hex) = tag_colors.get(normalized) {
            return hex.clone();
        }
    }

    string_to_hsl_hex(normalized)
}

// ---- payload reading -----------------------------------------------------

struct Fields<'a> {
    pairs: Option<Pairs<'a>>,
}

impl<'a> Fields<'a> {
    fn of(payload: &'a RawValue) -> Self {
        Fields {
            pairs: serde_json::from_str(payload.get()).ok(),
        }
    }

    fn raw(&self, key: &str) -> Option<&'a RawValue> {
        self.pairs.as_ref()?.get(key)
    }

    /// A string field, as JavaScript reads it: present and a string.
    fn string(&self, key: &str) -> Option<String> {
        let raw = self.raw(key)?;
        is_string(raw).then(|| serde_json::from_str(raw.get()).ok())?
    }

    /// A truthy string: present, a string, and not empty.
    fn truthy(&self, key: &str) -> Option<String> {
        self.string(key).filter(|s| !s.is_empty())
    }

}

/// `${value}` for a JSON value, the way a template literal renders it.
fn js_template(raw: &RawValue) -> String {
    let text = raw.get();

    if is_string(raw) {
        return serde_json::from_str(text).unwrap_or_default();
    }

    match text.as_bytes().first() {
        Some(b'{') => "[object Object]".to_string(),
        Some(b'[') => {
            let items: Vec<&RawValue> = serde_json::from_str(text).unwrap_or_default();
            items
                .iter()
                .map(|item| {
                    if item.get() == "null" {
                        String::new()
                    } else {
                        js_template(item)
                    }
                })
                .collect::<Vec<_>>()
                .join(",")
        }
        _ => text.to_string(),
    }
}

// ---- the index -------------------------------------------------------------

const COMMENT_PREVIEW_CHARS: usize = 90;

/// The first line of a comment, flattened and cut to a preview.
fn comment_preview(md: &str) -> String {
    let first_line = md
        .trim_matches(is_js_space)
        .split('\n')
        .next()
        .unwrap_or("")
        .trim_matches(is_js_space);

    let units: Vec<u16> = first_line.encode_utf16().collect();

    if units.len() > COMMENT_PREVIEW_CHARS {
        let cut = String::from_utf16_lossy(&units[..COMMENT_PREVIEW_CHARS]);
        format!("{}…", cut.trim_end_matches(is_js_space))
    } else {
        first_line.to_string()
    }
}

/// Which tag an event is about: tagging names it as `tag`; deleting or
/// restoring the tag itself names it as the event's own `id`.
fn tag_of(action: &str, fields: &Fields<'_>) -> Option<String> {
    if action == "tombstone.tag" || action == "restore.tag" {
        fields.string("id")
    } else {
        fields.string("tag")
    }
}

fn identity_for(
    id: Option<&str>,
    names: &FxHashMap<String, String>,
    fallback: Option<&str>,
    tag_colors: &FxHashMap<String, String>,
) -> Option<Identity> {
    let id = id.filter(|id| !id.is_empty())?;
    let name = names
        .get(id)
        .map(String::as_str)
        .or(fallback)
        .unwrap_or(id)
        .to_string();
    let color = string_color(&name, tag_colors);

    Some(Identity {
        id: id.to_string(),
        name,
        color,
    })
}

struct Decoded<'a> {
    event: &'a RawEvent,
    action: &'a str,
    fields: Fields<'a>,
}

/// Every event the log holds, in effective-time order.
pub fn build(
    sorted: &[&RawEvent],
    now: f64,
    tag_colors: &FxHashMap<String, String>,
) -> Vec<Entry> {
    let mut scratch: Vec<Unreadable> = Vec::new();
    let decoded: Vec<Decoded<'_>> = sorted
        .iter()
        .filter_map(|&event| {
            let d = decode_one(event, &mut scratch)?;
            Some(Decoded {
                event,
                action: d.action,
                fields: Fields::of(d.payload),
            })
        })
        .collect();

    // Names, from the log's own create events.
    let mut names: FxHashMap<String, String> = FxHashMap::default();
    // Where each node sat before the move an event describes, by event id.
    let mut previous_parent: FxHashMap<&str, Option<String>> = FxHashMap::default();
    let mut parent_by_node: FxHashMap<String, String> = FxHashMap::default();
    // Which ids are tickets, and what hangs off what.
    let mut issue_ids: FxHashSet<String> = FxHashSet::default();
    let mut issue_parent: FxHashMap<String, String> = FxHashMap::default();

    for d in &decoded {
        if matches!(d.action, "create.tag" | "create.contributor" | "add.swimlane") {
            if let (Some(id), Some(name)) = (d.fields.truthy("id"), d.fields.truthy("name")) {
                names.insert(id, name);
            }
        }

        if let (Some(id), Some(parent)) = (d.fields.truthy("id"), d.fields.truthy("parent")) {
            if d.action == "move.node" {
                previous_parent.insert(&d.event.id, parent_by_node.get(&id).cloned());
            }

            parent_by_node.insert(id.clone(), parent.clone());
            issue_parent.insert(id.clone(), parent);
        }

        if d.action == "add.issue" {
            if let Some(id) = d.fields.truthy("id") {
                issue_ids.insert(id);
            }
        }
    }

    // Which board each event belongs to, positionally: the hierarchy as it
    // stood when the event happened.
    let mut board_parent: FxHashMap<String, String> = FxHashMap::default();
    let mut board_ids: FxHashSet<String> = FxHashSet::default();
    let mut boards: Vec<Option<String>> = Vec::with_capacity(decoded.len());

    for d in &decoded {
        let Some(id) = d.fields.truthy("id") else {
            boards.push(None);
            continue;
        };

        if d.action == "add.board" {
            board_ids.insert(id.clone());
        }

        if let Some(parent) = d.fields.truthy("parent").or_else(|| d.fields.truthy("issue")) {
            board_parent.insert(id.clone(), parent);
        }

        boards.push(if board_ids.contains(&id) {
            Some(id)
        } else {
            resolve_up(&id, &board_parent, &board_ids)
        });
    }

    let raw_times: Vec<Option<f64>> = decoded.iter().map(|d| decode_time(&d.event.id)).collect();
    let times = effective_times(&raw_times, now);

    let mut entries: Vec<Entry> = Vec::with_capacity(decoded.len());

    for (index, d) in decoded.iter().enumerate() {
        let Some(t) = times[index] else { continue };
        let fields = &d.fields;
        let tag = tag_of(d.action, fields);

        let issue = match fields.truthy("issue") {
            Some(issue) => Some(issue),
            None => match fields.string("id") {
                Some(id) => resolve_up(&id, &issue_parent, &issue_ids),
                None => None,
            },
        };

        let label = describe(d, &names, &previous_parent, tag.as_deref());

        let assignee = fields.raw("assignee").and_then(|raw| {
            is_string(raw).then(|| serde_json::from_str::<String>(raw.get()).ok())?
        });

        entries.push(Entry {
            id: d.event.id.clone(),
            t,
            action: d.action.to_string(),
            label,
            issue,
            board: boards[index].clone(),
            actor: identity_for(
                Some(&d.event.user_id),
                &names,
                Some(&d.event.user_name),
                tag_colors,
            ),
            tag: identity_for(tag.as_deref(), &names, None, tag_colors),
            assignee: identity_for(assignee.as_deref(), &names, None, tag_colors),
        });
    }

    // Sorted here rather than per request: effective times are not the order
    // the log is stored in, and a window is a range over this axis. Stable,
    // so ties keep the causal order.
    entries.sort_by(|a, b| a.t.partial_cmp(&b.t).unwrap_or(Ordering::Equal));

    entries
}

/// Walks up from `id` until a member of `targets`, guarding against a cycle.
fn resolve_up(
    id: &str,
    parents: &FxHashMap<String, String>,
    targets: &FxHashSet<String>,
) -> Option<String> {
    let mut seen: FxHashSet<&str> = FxHashSet::default();
    let mut current = id;

    while !seen.contains(current) {
        if targets.contains(current) {
            return Some(current.to_string());
        }

        seen.insert(current);
        current = parents.get(current)?;
    }

    None
}

fn describe(
    d: &Decoded<'_>,
    names: &FxHashMap<String, String>,
    previous_parent: &FxHashMap<&str, Option<String>>,
    tag: Option<&str>,
) -> String {
    let fields = &d.fields;
    let action = format_log_action(d.action);

    // A comment says what it said, after a colon.
    if let Some(md) = fields.raw("md") {
        let preview = comment_preview(&js_template(md));

        return if preview.is_empty() {
            action
        } else {
            format!("{action}: {preview}")
        };
    }

    // A move says which lane, and whether it changed lanes at all.
    if d.action == "move.node" {
        if let Some(parent) = fields.truthy("parent") {
            let Some(lane) = names.get(&parent) else {
                return action;
            };

            return match previous_parent.get(d.event.id.as_str()) {
                Some(Some(previous)) if *previous == parent => format!("Moved within {lane}"),
                _ => format!("Moved to {lane}"),
            };
        }
    }

    let detail = if let Some(tag) = tag {
        names.get(tag).cloned().unwrap_or_default()
    } else if let Some(assignee) = fields.raw("assignee") {
        match is_string(assignee) {
            true => serde_json::from_str::<String>(assignee.get())
                .ok()
                .and_then(|id| names.get(&id).cloned())
                .unwrap_or_default(),
            false => String::new(),
        }
    } else if let Some(name) = fields.raw("name") {
        format!("\"{}\"", js_template(name))
    } else {
        String::new()
    };

    if detail.is_empty() {
        action
    } else {
        format!("{action} {detail}")
    }
}

/// The first entry at or after `t`, or the length where none is.
pub fn first_at_or_after(entries: &[Entry], t: f64) -> usize {
    entries.partition_point(|entry| entry.t < t)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phrases_every_action_and_falls_back_on_the_spelling() {
        assert_eq!(format_log_action("add.issue"), "Created with title");
        assert_eq!(format_log_action("rebalance.children"), "Rebalanced order");
        assert_eq!(format_log_action("redact.contributor"), "redact.contributored");
        assert_eq!(format_log_action("archive"), "archived");
    }

    #[test]
    fn hashes_and_colours_like_the_typescript() {
        // `(hash * 31 + code) >>> 0` over "jola" and a non-ASCII name.
        assert_eq!(hash_string("jola"), 3_267_962);
        assert_eq!(hash_string("é"), 233);
        assert_eq!(string_to_hsl_hex(""), "#cc6666");
        assert_eq!(string_to_hsl_hex("jola"), "#6966cc");
    }

    #[test]
    fn a_known_tag_takes_its_colour_and_a_name_is_normalised() {
        let mut table = FxHashMap::default();
        table.insert("bug".to_string(), "#ff0000".to_string());

        assert_eq!(string_color("  Bug ", &table), "#ff0000");
        assert_eq!(string_color("Jola", &table), string_color("jola", &table));
    }

    #[test]
    fn previews_the_first_line_and_cuts_long_ones() {
        assert_eq!(comment_preview("  hello\nworld  "), "hello");
        assert_eq!(comment_preview(""), "");
        let long = "x".repeat(95);
        assert_eq!(comment_preview(&long), format!("{}…", "x".repeat(90)));
        let spaced = format!("{} {}", "y".repeat(89), "z".repeat(20));
        assert_eq!(comment_preview(&spaced), format!("{}…", "y".repeat(89)));
    }

    #[test]
    fn renders_a_template_the_way_javascript_does() {
        let raw = |t: &str| RawValue::from_string(t.into()).unwrap();
        assert_eq!(js_template(&raw("\"a\\nb\"")), "a\nb");
        assert_eq!(js_template(&raw("5")), "5");
        assert_eq!(js_template(&raw("null")), "null");
        assert_eq!(js_template(&raw("true")), "true");
        assert_eq!(js_template(&raw("{\"a\":1}")), "[object Object]");
        assert_eq!(js_template(&raw("[1,[2,\"x\"],null]")), "1,2,x,");
    }
}
