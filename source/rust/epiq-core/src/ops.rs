use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::decode::{self, DecodedEvent};
use crate::frame::{self, NamedBytes};
use crate::model::{RawEvent, Unreadable};
use crate::order;
use crate::parse::parse_file;
use crate::store;
use crate::times;

/// Every answer is a JSON document. A failure is `{"error": "<message>"}`, so
/// the host maps it onto its own `Result` type without inspecting a status
/// code — the same shape whether the op was unknown or its input was not.
pub fn call(op: &str, input: &[u8]) -> Vec<u8> {
    let answer = match op {
        "ping" => ping(input),
        "parse_files" => parse_files(input),
        "load_files" => load_files(input),
        "load" => load(input),
        _ => Err(format!("unknown op: {op}")),
    };

    match answer {
        Ok(bytes) => bytes,
        Err(message) => serde_json::to_vec(&json!({ "error": message }))
            .expect("an error document serialises"),
    }
}

fn to_json<T: Serialize>(value: &T) -> Result<Vec<u8>, String> {
    serde_json::to_vec(value).map_err(|e| e.to_string())
}

/// Round trip: proves the boundary carries bytes both ways intact, including
/// ones that grow the module's memory.
fn ping(input: &[u8]) -> Result<Vec<u8>, String> {
    let text = std::str::from_utf8(input).map_err(|e| format!("ping: {e}"))?;

    to_json(&json!({ "pong": text, "bytes": input.len() }))
}

#[derive(Serialize)]
struct Parsed {
    events: Vec<RawEvent>,
    unreadable: Vec<Unreadable>,
}

fn parse_all(files: &[NamedBytes<'_>]) -> Result<Parsed, String> {
    let mut events = Vec::new();
    let mut unreadable = Vec::new();

    for file in files {
        events.extend(parse_file(file.name, file.data, &mut unreadable)?);
    }

    Ok(Parsed { events, unreadable })
}

/// Framed files in, their reconstructed events out in file order, unordered:
/// what `parsePersistedEventsFile` yields for each file, concatenated.
fn parse_files(input: &[u8]) -> Result<Vec<u8>, String> {
    to_json(&parse_all(&frame::decode(input)?)?)
}

#[derive(Serialize)]
struct Ordered<'a> {
    events: Vec<&'a RawEvent>,
    unreadable: &'a [Unreadable],
}

/// Framed files in, their events out in causal order: what
/// `loadAllPersistedEvents` yields, before decoding.
fn load_files(input: &[u8]) -> Result<Vec<u8>, String> {
    let parsed = parse_all(&frame::decode(input)?)?;

    to_json(&Ordered {
        events: order::sorted(parsed.events.iter().collect()),
        unreadable: &parsed.unreadable,
    })
}

/// The frame entry that carries an op's parameters, ahead of the files.
const PARAMS: &str = "@params";

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct LoadParams {
    /// The events directory, which is what the resident store is keyed by.
    #[serde(default)]
    root: String,
    /// The wall clock, for the poisoned-id ceiling; never read in here.
    now: f64,
    /// A cut: applied events before it, unapplied at or after it.
    split_at: Option<f64>,
    /// Whether to answer the effective time of every event.
    #[serde(default)]
    times: bool,
    /// Whether to decode: `AppEvent`s out instead of reconstructed ones, and
    /// every event this build cannot read quarantined.
    #[serde(default)]
    decode: bool,
    /// Whether to answer who wrote each event, in order — what a caller that
    /// only wants authors reads instead of the events.
    #[serde(default)]
    actors: bool,
    /// Leave the events out of the answer: for a caller after the edge, the
    /// times or the actors alone, which is a fraction of the bytes.
    #[serde(default)]
    omit_events: bool,
    /// The host holds a cache of the decoded events this store has handed it
    /// for this root: answer with the order as ids and only the events it
    /// has not seen. False empties the store's picture of that cache.
    #[serde(default)]
    known: bool,
}

/// The answer to a decoded load for a host that caches: ids in order, and
/// the events it does not have yet.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Handed<'a> {
    order: Vec<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    unapplied_order: Option<Vec<&'a str>>,
    fresh: Vec<DecodedEvent<'a>>,
    unreadable: Vec<Unreadable>,
    edge: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    times: Option<Vec<(String, Option<f64>)>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    actors: Option<Vec<(String, String)>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Loaded<E: Serialize> {
    events: Vec<E>,
    #[serde(skip_serializing_if = "Option::is_none")]
    unapplied_events: Option<Vec<E>>,
    unreadable: Vec<Unreadable>,
    edge: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    times: Option<Vec<(String, Option<f64>)>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    actors: Option<Vec<(String, String)>>,
}

fn split_params(items: Vec<NamedBytes<'_>>) -> Result<(LoadParams, Vec<NamedBytes<'_>>), String> {
    let mut items = items.into_iter();

    match items.next() {
        Some(first) if first.name == PARAMS => {
            let params = serde_json::from_slice(first.data).map_err(|e| format!("{PARAMS}: {e}"))?;
            Ok((params, items.collect()))
        }
        Some(first) => Err(format!("load: expected {PARAMS} first, got {}", first.name)),
        None => Err(format!("load: expected {PARAMS} first")),
    }
}

/// The whole read: parse, order, and — when asked — split at a time or report
/// every effective time. The edge is the tail of the full order, whatever the
/// cut.
fn load(input: &[u8]) -> Result<Vec<u8>, String> {
    let (params, files) = split_params(frame::decode(input)?)?;

    store::with_snapshot(&params.root, &files, |snapshot, cache| {
        answer(&params, snapshot, cache)
    })?
}

fn answer(
    params: &LoadParams,
    snapshot: store::Snapshot<'_>,
    cache: &mut store::HostCache,
) -> Result<Vec<u8>, String> {
    let sorted = order::sorted(snapshot.events);
    let edge = times::edge(&sorted).map(str::to_string);

    let times = params.times.then(|| {
        times::effective_event_times(&sorted, params.now)
            .into_iter()
            .zip(&sorted)
            .map(|(time, event)| (event.id.clone(), time))
            .collect()
    });

    let actors = params.actors.then(|| {
        sorted
            .iter()
            .map(|event| (event.user_id.clone(), event.user_name.clone()))
            .collect()
    });

    let (events, unapplied_events) = match params.split_at {
        Some(_) if params.omit_events => (Vec::new(), None),
        None if params.omit_events => (Vec::new(), None),
        Some(target) => {
            let (applied, unapplied) = times::split_at(sorted, target, params.now);
            (applied, Some(unapplied))
        }
        None => (sorted, None),
    };

    let mut unreadable = snapshot.unreadable;

    if !params.decode {
        return to_json(&Loaded { events, unapplied_events, unreadable, edge, times, actors });
    }

    if !params.known {
        cache.clear();
    }

    // Applied first, then unapplied, so the quarantine list reads in causal
    // order across the cut. The host cache is fed either way: a full answer
    // is what starts it, and only what it lacks travels after that.
    let mut applied = Vec::new();
    let order = hand(&events, cache, &mut applied, &mut unreadable);

    let mut unapplied = Vec::new();
    let unapplied_order = unapplied_events
        .as_deref()
        .map(|events| hand(events, cache, &mut unapplied, &mut unreadable));

    if params.known {
        applied.extend(unapplied);

        return to_json(&Handed { order, unapplied_order, fresh: applied, unreadable, edge, times, actors });
    }

    let unapplied_events = unapplied_order.map(|_| unapplied);

    to_json(&Loaded { events: applied, unapplied_events, unreadable, edge, times, actors })
}

/// Decodes `events` in order for a caching host: their ids, with every event
/// the host's cache lacks pushed onto `fresh`.
fn hand<'a>(
    events: &[&'a RawEvent],
    cache: &mut store::HostCache,
    fresh: &mut Vec<DecodedEvent<'a>>,
    unreadable: &mut Vec<Unreadable>,
) -> Vec<&'a str> {
    let mut order = Vec::with_capacity(events.len());

    for &event in events {
        let Some(decoded) = decode::decode_one(event, unreadable) else {
            continue;
        };

        if cache.needs(decoded.id, event.origin) {
            fresh.push(decoded.clone());
        }

        order.push(decoded.id);
    }

    order
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ping_echoes_its_input() {
        let out = call("ping", b"hello");
        let doc: serde_json::Value = serde_json::from_slice(&out).unwrap();
        assert_eq!(doc["pong"], "hello");
        assert_eq!(doc["bytes"], 5);
    }

    #[test]
    fn unknown_op_is_an_error_document() {
        let out = call("nope", b"");
        let doc: serde_json::Value = serde_json::from_slice(&out).unwrap();
        assert_eq!(doc["error"], "unknown op: nope");
    }

    #[test]
    fn parse_files_answers_events_and_quarantines() {
        let framed = frame::encode(&[
            ("01A.alice.jsonl", b"{\"v\":1,\"id\":[\"01A\",null],\"init.workspace\":{}}\nnot json\n"),
            ("01B.bob.jsonl", b"{\"v\":1,\"id\":[\"01B\",\"01A\"],\"edit.title\":{}}\n"),
        ]);

        let out = call("parse_files", &framed);
        let doc: serde_json::Value = serde_json::from_slice(&out).unwrap();

        assert_eq!(doc["events"].as_array().unwrap().len(), 2);
        assert_eq!(doc["events"][1]["userName"], "bob");
        assert_eq!(doc["unreadable"][0]["detail"], "01A.alice.jsonl:2 (invalid JSON)");
    }

    #[test]
    fn parse_files_fails_the_whole_read_on_a_bad_file_name() {
        let framed = frame::encode(&[("01A..jsonl", b"")]);
        let out = call("parse_files", &framed);
        let doc: serde_json::Value = serde_json::from_slice(&out).unwrap();

        assert_eq!(doc["error"], "Invalid event file name 01A..jsonl: userName");
    }

    const NOW: f64 = 1_700_000_000_000.0;

    // Time characters for NOW - 10 s, NOW, NOW + 10 s (encodeTime of each).
    const EARLIER: &str = "01HF7YAG7G0000000000000000";
    const AT: &str = "01HF7YAT000000000000000000";
    const LATER: &str = "01HF7YB3RG0000000000000000";

    fn log() -> Vec<u8> {
        let lines = format!(
            "{{\"v\":1,\"id\":[\"{EARLIER}\",null],\"init.workspace\":{{}}}}\n{{\"v\":1,\"id\":[\"{LATER}\",\"{EARLIER}\"],\"x\":{{}}}}\n{{\"v\":1,\"id\":[\"{AT}\",\"{EARLIER}\"],\"x\":{{}}}}\n"
        );
        let params = format!("{{\"now\":{NOW},\"splitAt\":{NOW},\"times\":true}}");

        frame::encode(&[(PARAMS, params.as_bytes()), ("01A.alice.jsonl", lines.as_bytes())])
    }

    #[test]
    fn load_orders_splits_and_reports_times_and_the_edge() {
        let out = call("load", &log());
        let doc: serde_json::Value = serde_json::from_slice(&out).unwrap();

        assert_eq!(doc["events"].as_array().unwrap().len(), 1);
        assert_eq!(doc["events"][0]["id"][0], EARLIER);
        assert_eq!(doc["unappliedEvents"][0]["id"][0], AT);
        assert_eq!(doc["unappliedEvents"][1]["id"][0], LATER);
        assert_eq!(doc["edge"], LATER);
        assert_eq!(doc["times"][0][0], EARLIER);
        assert_eq!(doc["times"][0][1], NOW - 10_000.0);
        assert_eq!(doc["times"][2][1], NOW + 10_000.0);
        assert!(doc["unreadable"].as_array().unwrap().is_empty());
    }

    #[test]
    fn load_without_a_cut_answers_the_whole_order_and_no_times() {
        let params = format!("{{\"now\":{NOW}}}");
        let framed = frame::encode(&[(PARAMS, params.as_bytes()), ("01A.alice.jsonl", b"")]);
        let out = call("load", &framed);
        let doc: serde_json::Value = serde_json::from_slice(&out).unwrap();

        assert!(doc["events"].as_array().unwrap().is_empty());
        assert!(doc.get("unappliedEvents").is_none());
        assert!(doc.get("times").is_none());
        assert_eq!(doc["edge"], serde_json::Value::Null);
    }

    #[test]
    fn load_can_answer_actors_and_leave_the_events_out() {
        let params = format!("{{\"now\":{NOW},\"splitAt\":{NOW},\"actors\":true,\"omitEvents\":true}}");
        let lines = format!("{{\"v\":1,\"id\":[\"{EARLIER}\",null],\"init.workspace\":{{}}}}\n");
        let framed = frame::encode(&[(PARAMS, params.as_bytes()), ("01A.alice.jsonl", lines.as_bytes())]);
        let out = call("load", &framed);
        let doc: serde_json::Value = serde_json::from_slice(&out).unwrap();

        assert!(doc["events"].as_array().unwrap().is_empty());
        assert!(doc.get("unappliedEvents").is_none());
        assert_eq!(doc["actors"][0][0], "01A");
        assert_eq!(doc["actors"][0][1], "alice");
        assert_eq!(doc["edge"], EARLIER);
    }

    #[test]
    fn load_refuses_a_frame_without_params() {
        let out = call("load", &frame::encode(&[("01A.alice.jsonl", b"")]));
        let doc: serde_json::Value = serde_json::from_slice(&out).unwrap();

        assert_eq!(doc["error"], "load: expected @params first, got 01A.alice.jsonl");
    }
}

// `EPIQ_BENCH_DIR=<events dir> cargo test --release -- --ignored --nocapture bench_phases`
#[cfg(test)]
mod bench {
    use super::*;
    use std::time::Instant;

    #[test]
    #[ignore]
    fn bench_phases() {
        let Ok(dir) = std::env::var("EPIQ_BENCH_DIR") else { return };
        let mut names: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.ends_with(".jsonl"))
            .collect();
        names.sort();
        let data: Vec<(String, Vec<u8>)> = names
            .iter()
            .map(|n| (n.clone(), std::fs::read(format!("{dir}/{n}")).unwrap()))
            .collect();
        let files: Vec<NamedBytes<'_>> = data
            .iter()
            .map(|(n, d)| NamedBytes { name: n, data: d })
            .collect();

        let t = Instant::now();
        let parsed = parse_all(&files).unwrap();
        eprintln!("parse      {:?}  ({} events)", t.elapsed(), parsed.events.len());

        let t = Instant::now();
        let sorted = order::sorted(parsed.events.iter().collect());
        eprintln!("order      {:?}", t.elapsed());

        let t = Instant::now();
        let raw_json = to_json(&sorted).unwrap();
        eprintln!("json raw   {:?}  ({} MB)", t.elapsed(), raw_json.len() / 1_000_000);

        let t = Instant::now();
        let mut unreadable = parsed.unreadable;
        let decoded = decode::decode(&sorted, &mut unreadable);
        eprintln!("decode     {:?}", t.elapsed());

        let t = Instant::now();
        let json = to_json(&decoded).unwrap();
        eprintln!("json dec   {:?}  ({} MB)", t.elapsed(), json.len() / 1_000_000);
    }
}
