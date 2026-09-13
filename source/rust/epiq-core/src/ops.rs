use serde::Serialize;
use serde_json::json;

use crate::frame;
use crate::model::{RawEvent, Unreadable};
use crate::parse::parse_file;

/// Every answer is a JSON document. A failure is `{"error": "<message>"}`, so
/// the host maps it onto its own `Result` type without inspecting a status
/// code — the same shape whether the op was unknown or its input was not.
pub fn call(op: &str, input: &[u8]) -> Vec<u8> {
    let answer = match op {
        "ping" => ping(input),
        "parse_files" => parse_files(input),
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

/// Framed files in, their reconstructed events out in file order, unordered:
/// what `parsePersistedEventsFile` yields for each file, concatenated.
fn parse_files(input: &[u8]) -> Result<Vec<u8>, String> {
    let files = frame::decode(input)?;
    let mut events = Vec::new();
    let mut unreadable = Vec::new();

    for file in files {
        events.extend(parse_file(file.name, file.data, &mut unreadable)?);
    }

    to_json(&Parsed { events, unreadable })
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
}
