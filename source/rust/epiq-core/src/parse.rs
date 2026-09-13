//! One log file to its reconstructed events: the actor off the file name, the
//! envelope off each line, and a quarantine entry for every line that has no
//! envelope to keep its place in the chain with.
//!
//! Every rule here mirrors `parsePersistedEventsFile` and
//! `parseEventFileActor` in `event-load.ts`, down to the messages, so a
//! quarantine reads the same whichever side produced it.

use serde_json::value::RawValue;
use serde_json::Number;

use crate::model::{Origin, RawEvent, Unreadable, CORRUPT_LINE};
use crate::pairs::{is_non_empty_string, js_type_of, Pairs};

#[derive(Debug, Clone)]
pub struct Actor {
    pub user_id: String,
    pub user_name: String,
}

const UNKNOWN: &str = "unknown";

/// `<id>[~pending[-<ulid>[-f<bytes>]]].<name>.jsonl`, split on the first
/// dot only: a name keeps its own dots, an id segment never has one.
pub fn parse_actor(file_name: &str) -> Result<Actor, String> {
    let base = file_name.strip_suffix(".jsonl").unwrap_or(file_name);

    let (id_segment, name) = match base.find('.') {
        Some(index) => (&base[..index], Some(&base[index + 1..])),
        None => (base, None),
    };

    let user_id = canonical_user_id(strip_pending_marker(id_segment));

    let mut issues = Vec::new();

    if user_id.is_empty() {
        issues.push("userId");
    }

    // Undefined, not empty, is what falls back to `unknown`: a dot with
    // nothing after it names nobody.
    let user_name = match name {
        None => UNKNOWN,
        Some("") => {
            issues.push("userName");
            ""
        }
        Some(name) => name,
    };

    if !issues.is_empty() {
        return Err(format!(
            "Invalid event file name {file_name}: {}",
            issues.join(", ")
        ));
    }

    Ok(Actor {
        user_id,
        user_name: user_name.to_string(),
    })
}

/// `~pending`, `~pending-<ulid>`, `~pending-<ulid>-f<bytes>` — any run of
/// `-[0-9a-z]+` groups after the marker, case-insensitively, at the end.
pub fn strip_pending_marker(id_segment: &str) -> &str {
    let lower = id_segment.to_ascii_lowercase();

    let Some(marker) = lower.rfind("~pending") else {
        return id_segment;
    };

    let tail = &lower[marker + "~pending".len()..];
    let tail_is_groups = tail.is_empty()
        || tail.starts_with('-')
            && tail
                .split('-')
                .skip(1)
                .all(|group| !group.is_empty() && group.bytes().all(|b| b.is_ascii_alphanumeric()));

    if tail_is_groups {
        &id_segment[..marker]
    } else {
        id_segment
    }
}

/// A lower-cased ULID is the same ULID; anything else is not guessed at.
fn canonical_user_id(user_id: &str) -> String {
    let is_ulid = user_id.len() == 26
        && user_id.bytes().all(|b| {
            matches!(b.to_ascii_uppercase(), b'0'..=b'9' | b'A'..=b'H' | b'J' | b'K' | b'M' | b'N' | b'P'..=b'T' | b'V'..=b'Z')
        });

    if is_ulid {
        user_id.to_ascii_uppercase()
    } else {
        user_id.to_string()
    }
}

/// JavaScript's `String.prototype.trim` set: WhiteSpace plus LineTerminator,
/// which has U+FEFF and lacks U+0085 relative to Unicode White_Space.
fn is_js_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n'
            | '\u{0B}'
            | '\u{0C}'
            | '\r'
            | ' '
            | '\u{A0}'
            | '\u{1680}'
            | '\u{2000}'..='\u{200A}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202F}'
            | '\u{205F}'
            | '\u{3000}'
            | '\u{FEFF}'
    )
}

enum LineError {
    InvalidJson,
    Envelope(String),
}

fn envelope_error(issues: &[&str]) -> LineError {
    LineError::Envelope(format!(
        "Invalid persisted event envelope: {}",
        issues.join(", ")
    ))
}

fn is_positive_integer(n: &Number) -> bool {
    if let Some(u) = n.as_u64() {
        return u > 0;
    }

    if let Some(i) = n.as_i64() {
        return i > 0;
    }

    match n.as_f64() {
        Some(f) => f.is_finite() && f > 0.0 && f.fract() == 0.0,
        None => false,
    }
}

/// The envelope: `v` a positive integer, `id` a pair of a non-empty string
/// and a nullable non-empty string, anything else kept as it is. Issues are
/// reported the way zod's are — a path where there is one, the message where
/// there is not — and joined with `, `.
fn parse_line(line: &str, actor: &Actor) -> Result<RawEvent, LineError> {
    let pairs: Pairs<'_> = match serde_json::from_str(line) {
        Ok(pairs) => pairs,
        Err(_) => {
            // Valid JSON that is not an object reads as an envelope issue;
            // anything else did not parse at all.
            return match serde_json::from_str::<&RawValue>(line) {
                Ok(raw) => Err(LineError::Envelope(format!(
                    "Invalid persisted event envelope: Invalid input: expected object, received {}",
                    js_type_of(raw)
                ))),
                Err(_) => Err(LineError::InvalidJson),
            };
        }
    };

    let mut issues: Vec<&str> = Vec::new();

    let v = pairs
        .get("v")
        .and_then(|raw| serde_json::from_str::<Number>(raw.get()).ok())
        .filter(is_positive_integer);

    if v.is_none() {
        issues.push("v");
    }

    let mut id = None;
    let mut ref_id = None;

    match pairs
        .get("id")
        .and_then(|raw| serde_json::from_str::<Vec<&RawValue>>(raw.get()).ok())
    {
        Some(items) if items.len() == 2 => {
            if is_non_empty_string(items[0]) {
                id = serde_json::from_str::<String>(items[0].get()).ok();
            }

            if id.is_none() {
                issues.push("id.0");
            }

            if items[1].get() == "null" {
                ref_id = Some(None);
            } else if is_non_empty_string(items[1]) {
                ref_id = serde_json::from_str::<String>(items[1].get()).ok().map(Some);
            }

            if ref_id.is_none() {
                issues.push("id.1");
            }
        }
        _ => issues.push("id"),
    }

    if !issues.is_empty() {
        return Err(envelope_error(&issues));
    }

    let rest = pairs
        .0
        .into_iter()
        .filter(|(key, _)| key != "v" && key != "id")
        .map(|(key, raw)| (key.into_owned(), raw.to_owned()))
        .collect();

    Ok(RawEvent {
        v: v.expect("checked"),
        id: id.expect("checked"),
        ref_id: ref_id.expect("checked"),
        rest,
        user_id: actor.user_id.clone(),
        user_name: actor.user_name.clone(),
        ..Default::default()
    })
}

/// Every line of one file. A line that will not parse, or parses to no
/// envelope, is quarantined as `corrupt-line` and the rest still load; a file
/// name that names no actor fails the whole read, as it does in TypeScript.
pub fn parse_file(
    file_name: &str,
    bytes: &[u8],
    unreadable: &mut Vec<Unreadable>,
) -> Result<Vec<RawEvent>, String> {
    let actor = parse_actor(file_name)?;
    let content = String::from_utf8_lossy(bytes);
    let mut events = Vec::new();

    parse_lines(file_name, &actor, &content, 0, None, &mut events, unreadable);

    Ok(events)
}

/// The lines of `text`, numbered from `lines_before + 1` as the file counts
/// them, appended to `events` and `unreadable`. Answers how many newlines
/// `text` held, which is how many complete lines a caller may consider kept.
pub fn parse_lines(
    file_name: &str,
    actor: &Actor,
    text: &str,
    lines_before: usize,
    origin: Option<(u32, u32)>,
    events: &mut Vec<RawEvent>,
    unreadable: &mut Vec<Unreadable>,
) -> usize {
    for (index, line) in text.split('\n').enumerate() {
        let trimmed = line.trim_matches(is_js_space);
        if trimmed.is_empty() {
            continue;
        }

        match parse_line(trimmed, actor) {
            Ok(mut event) => {
                event.origin = origin.map(|(file_id, generation)| Origin {
                    file_id,
                    generation,
                    index: events.len(),
                });
                events.push(event);
            }
            Err(error) => {
                let reason = match error {
                    LineError::InvalidJson => "invalid JSON".to_string(),
                    LineError::Envelope(message) => message,
                };

                unreadable.push(Unreadable {
                    event_id: None,
                    reason: CORRUPT_LINE,
                    detail: format!("{file_name}:{} ({reason})", lines_before + index + 1),
                    target_node_id: None,
                });
            }
        }
    }

    text.bytes().filter(|&b| b == b'\n').count()
}

#[cfg(test)]
mod tests {
    use super::*;

    const ULID: &str = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

    fn actor(name: &str) -> (String, String) {
        let a = parse_actor(name).unwrap();
        (a.user_id, a.user_name)
    }

    #[test]
    fn splits_on_the_first_dot_only() {
        assert_eq!(actor(&format!("{ULID}.j.-lampa.jsonl")), (ULID.into(), "j.-lampa".into()));
        assert_eq!(actor(&format!("{ULID}.a.b.c.jsonl")), (ULID.into(), "a.b.c".into()));
    }

    #[test]
    fn a_name_without_a_dot_is_unknown() {
        assert_eq!(actor("someone.jsonl"), ("someone".into(), UNKNOWN.into()));
    }

    #[test]
    fn an_empty_name_segment_fails_the_file() {
        let err = parse_actor("01A..jsonl").unwrap_err();
        assert_eq!(err, "Invalid event file name 01A..jsonl: userName");

        let err = parse_actor(".alice.jsonl").unwrap_err();
        assert_eq!(err, "Invalid event file name .alice.jsonl: userId");
    }

    #[test]
    fn restores_ulid_casing_and_leaves_other_ids_alone() {
        assert_eq!(actor(&format!("{}.alice.jsonl", ULID.to_lowercase())).0, ULID);
        assert_eq!(actor("u-1.alice.jsonl").0, "u-1");
        assert_eq!(actor("01arz3ndektsv4rrffq69g5fal.x.jsonl").0, "01arz3ndektsv4rrffq69g5fal");
    }

    #[test]
    fn strips_every_pending_marker_shape() {
        assert_eq!(strip_pending_marker("01A~pending"), "01A");
        assert_eq!(strip_pending_marker("01A~pending-01b2c3"), "01A");
        assert_eq!(strip_pending_marker("01A~pending-01b2c3-f1234"), "01A");
        assert_eq!(strip_pending_marker("01A~PENDING"), "01A");
        assert_eq!(strip_pending_marker("01A~pending-"), "01A~pending-");
        assert_eq!(strip_pending_marker("01A~pendingx"), "01A~pendingx");
        assert_eq!(strip_pending_marker("01A"), "01A");
    }

    fn parse(lines: &str) -> (Vec<RawEvent>, Vec<Unreadable>) {
        let mut unreadable = Vec::new();
        let events = parse_file("01A.alice.jsonl", lines.as_bytes(), &mut unreadable).unwrap();
        (events, unreadable)
    }

    #[test]
    fn keeps_every_key_verbatim_and_the_actor() {
        let (events, unreadable) = parse(
            r#"{"add.issue": {"id":"n", "name":"x"},"v":1,"id":["01B","01A"],"extra":true}
"#,
        );

        assert!(unreadable.is_empty());
        assert_eq!(events.len(), 1);
        assert_eq!(
            serde_json::to_string(&events[0]).unwrap(),
            r#"{"v":1,"id":["01B","01A"],"add.issue":{"id":"n", "name":"x"},"extra":true,"userId":"01A","userName":"alice"}"#
        );
    }

    #[test]
    fn keeps_the_line_key_order_around_the_envelope() {
        let (events, _) = parse(r#"{"v":1,"id":["01A",null],"init.workspace":{},"evil":true}"#);

        assert_eq!(
            events[0].action_keys().collect::<Vec<_>>(),
            ["init.workspace", "evil"]
        );
    }

    #[test]
    fn a_repeated_key_keeps_its_first_place_and_last_value() {
        let (events, _) = parse(r#"{"x":1,"v":1,"id":["01A",null],"y":2,"x":3,"v":2}"#);
        assert_eq!(events[0].v, Number::from(2));

        let (events, _) = parse(r#"{"x":1,"v":2,"id":["01A",null],"y":2,"x":3,"v":1}"#);
        assert_eq!(events[0].v, Number::from(1));
        assert_eq!(
            serde_json::to_string(&events[0]).unwrap(),
            r#"{"v":1,"id":["01A",null],"x":3,"y":2,"userId":"01A","userName":"alice"}"#
        );
    }

    #[test]
    fn unescapes_the_ids() {
        let (events, _) = parse(r#"{"v":1,"id":["01A","01é"],"x":{}}"#);

        assert_eq!(events[0].id, "01A");
        assert_eq!(events[0].ref_id.as_deref(), Some("01é"));
    }

    #[test]
    fn quarantines_a_truncated_line_with_its_number() {
        let (events, unreadable) = parse(
            "{\"v\":1,\"id\":[\"01A\",null],\"init.workspace\":{}}\n{\"v\":1,\"id\":[\"01B\",null],\"lock.node\"\n\n{\"v\":1,\"id\":[\"01C\",\"01A\"],\"edit.title\":{}}\n",
        );

        assert_eq!(events.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(), ["01A", "01C"]);
        assert_eq!(
            unreadable,
            vec![Unreadable {
                event_id: None,
                reason: CORRUPT_LINE,
                detail: "01A.alice.jsonl:2 (invalid JSON)".into(),
                target_node_id: None,
            }]
        );
    }

    #[test]
    fn reports_envelope_issues_the_way_zod_does() {
        let cases = [
            ("\"str\"", "Invalid input: expected object, received string"),
            ("null", "Invalid input: expected object, received null"),
            ("[]", "Invalid input: expected object, received array"),
            ("{}", "v, id"),
            ("{\"v\":1}", "id"),
            ("{\"id\":[\"a\",null]}", "v"),
            ("{\"v\":\"1\",\"id\":[\"a\",null]}", "v"),
            ("{\"v\":0,\"id\":[\"a\",null]}", "v"),
            ("{\"v\":1.5,\"id\":[\"a\",null]}", "v"),
            ("{\"v\":1,\"id\":[\"a\"]}", "id"),
            ("{\"v\":1,\"id\":[\"\",null]}", "id.0"),
            ("{\"v\":1,\"id\":[\"a\",\"\"]}", "id.1"),
            ("{\"v\":1,\"id\":[\"a\",null,\"c\"]}", "id"),
            ("{\"v\":1,\"id\":\"a\"}", "id"),
            ("{\"v\":-1,\"id\":[null,null]}", "v, id.0"),
        ];

        for (line, expected) in cases {
            let (events, unreadable) = parse(line);
            assert!(events.is_empty(), "{line}");
            assert_eq!(
                unreadable[0].detail,
                format!("01A.alice.jsonl:1 (Invalid persisted event envelope: {expected})"),
                "{line}"
            );
        }

        let (events, _) = parse("{\"v\":1.0,\"id\":[\"a\",null]}");
        assert_eq!(events.len(), 1);
    }

    #[test]
    fn trims_like_javascript() {
        let (events, unreadable) =
            parse("\u{FEFF}{\"v\":1,\"id\":[\"01A\",null]}\r\n   \n\u{3000}\n");

        assert_eq!(events.len(), 1);
        assert!(unreadable.is_empty());
    }
}
