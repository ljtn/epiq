use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::frame::{self, NamedBytes};
use crate::model::{RawEvent, Unreadable};
use crate::order;
use crate::parse::parse_file;
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

/// Framed files in, their events out in causal order: what
/// `loadAllPersistedEvents` yields, before decoding.
fn load_files(input: &[u8]) -> Result<Vec<u8>, String> {
    let parsed = parse_all(&frame::decode(input)?)?;

    to_json(&Parsed {
        events: order::sorted(parsed.events),
        unreadable: parsed.unreadable,
    })
}

/// The frame entry that carries an op's parameters, ahead of the files.
const PARAMS: &str = "@params";

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct LoadParams {
    /// The wall clock, for the poisoned-id ceiling; never read in here.
    now: f64,
    /// A cut: applied events before it, unapplied at or after it.
    split_at: Option<f64>,
    /// Whether to answer the effective time of every event.
    #[serde(default)]
    times: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Loaded {
    events: Vec<RawEvent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    unapplied_events: Option<Vec<RawEvent>>,
    unreadable: Vec<Unreadable>,
    edge: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    times: Option<Vec<(String, Option<f64>)>>,
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
    let parsed = parse_all(&files)?;
    let sorted = order::sorted(parsed.events);
    let edge = times::edge(&sorted).map(str::to_string);

    let times = params.times.then(|| {
        times::effective_event_times(&sorted, params.now)
            .into_iter()
            .zip(&sorted)
            .map(|(time, event)| (event.id.clone(), time))
            .collect()
    });

    let (events, unapplied_events) = match params.split_at {
        Some(target) => {
            let (applied, unapplied) = times::split_at(sorted, target, params.now);
            (applied, Some(unapplied))
        }
        None => (sorted, None),
    };

    to_json(&Loaded {
        events,
        unapplied_events,
        unreadable: parsed.unreadable,
        edge,
        times,
    })
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
    fn load_refuses_a_frame_without_params() {
        let out = call("load", &frame::encode(&[("01A.alice.jsonl", b"")]));
        let doc: serde_json::Value = serde_json::from_slice(&out).unwrap();

        assert_eq!(doc["error"], "load: expected @params first, got 01A.alice.jsonl");
    }
}
