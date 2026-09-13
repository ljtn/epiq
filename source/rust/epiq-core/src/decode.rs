//! From a reconstructed event to one a materializer may touch.
//!
//! Applied in this order, each failure quarantining the event with its place
//! in the chain kept: a schema version this build cannot read; not exactly
//! one action key; an action this build does not know; a payload missing
//! what its handler dereferences. Ports `decodeReconstructedEvents`
//! (`event-load.ts`) and `parseEventPayload` (`event-payload.schema.ts`),
//! messages included — the schemas are loose (unknown keys pass) and require
//! only what a handler reads.

use serde::ser::SerializeMap;
use serde::{Serialize, Serializer};
use serde_json::value::RawValue;

use crate::model::{RawEvent, Unreadable, INVALID_PAYLOAD, UNKNOWN_ACTION, UNSUPPORTED_SCHEMA_VERSION};
use crate::pairs::{is_non_empty_string, is_number, is_object, is_string, js_type_of, Pairs};

/// An `AppEvent`: what the materializer consumes. Borrows from the stored
/// event, so decoding a resident log copies nothing.
#[derive(Debug, Clone)]
pub struct DecodedEvent<'a> {
    pub id: &'a str,
    pub action: &'a str,
    pub payload: &'a RawValue,
    pub user_id: &'a str,
    pub user_name: &'a str,
}

impl Serialize for DecodedEvent<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(Some(5))?;
        map.serialize_entry("id", &self.id)?;
        map.serialize_entry("action", &self.action)?;
        map.serialize_entry("payload", &self.payload)?;
        map.serialize_entry("userId", &self.user_id)?;
        map.serialize_entry("userName", &self.user_name)?;
        map.end()
    }
}

/// Versions this build can decode. Readability only; an unsupported event is
/// still part of the history.
const READABLE_SCHEMA_VERSIONS: &[f64] = &[1.0];

#[derive(Clone, Copy)]
enum Kind {
    /// A non-empty string: every reference by id.
    Id,
    /// Any string.
    Str,
    /// Any number.
    Num,
    /// An object whose values are strings: `rebalance.children`'s ranks.
    RankRecord,
}

type Field = (&'static str, Kind);

const POSITIONED: &[Field] = &[("id", Kind::Id), ("name", Kind::Str), ("parent", Kind::Id), ("rank", Kind::Str)];
const WITH_ID: &[Field] = &[("id", Kind::Id)];
const NAMED: &[Field] = &[("id", Kind::Id), ("name", Kind::Str)];
const PLACED: &[Field] = &[("id", Kind::Id), ("parent", Kind::Id), ("rank", Kind::Str)];
const ON_ISSUE: &[Field] = &[("id", Kind::Id), ("issue", Kind::Id)];

/// What a payload has to look like before a materializer is allowed to touch
/// it, per action. In the schema's key order, which is the order issues are
/// reported in.
fn required_fields(action: &str) -> Option<&'static [Field]> {
    Some(match action {
        "init.workspace" | "add.workspace" => &[("id", Kind::Id), ("name", Kind::Str), ("rank", Kind::Str)],
        "add.board" | "add.swimlane" | "add.issue" | "add.field" => POSITIONED,
        "edit.title" => NAMED,
        "delete.node" | "lock.node" => WITH_ID,
        "move.node" | "close.issue" | "reopen.issue" => PLACED,
        "edit.description" => &[("id", Kind::Id), ("md", Kind::Str)],
        "create.tag" | "restore.tag" => NAMED,
        "tombstone.tag" => WITH_ID,
        "create.contributor" | "rename.contributor" | "restore.contributor" => NAMED,
        "tombstone.contributor" => WITH_ID,
        "link.contributor.user" => &[("contributor", Kind::Id)],
        "add.issue.assignee" | "remove.issue.assignee" => &[("id", Kind::Id), ("assignee", Kind::Id)],
        "add.issue.tag" | "remove.issue.tag" => &[("id", Kind::Id), ("tag", Kind::Id)],
        "add.issue.comment" | "edit.issue.comment" => &[("id", Kind::Id), ("issue", Kind::Id), ("md", Kind::Str)],
        "delete.issue.comment" | "delete.issue.attachment" => ON_ISSUE,
        "add.issue.attachment" => &[
            ("id", Kind::Id),
            ("issue", Kind::Id),
            ("hash", Kind::Id),
            ("ext", Kind::Id),
            ("name", Kind::Str),
            ("bytes", Kind::Num),
        ],
        "rebalance.children" => &[("parent", Kind::Id), ("ranks", Kind::RankRecord)],
        _ => return None,
    })
}

#[cfg(test)]
pub fn is_known_action(action: &str) -> bool {
    required_fields(action).is_some()
}

fn received(value: Option<&RawValue>) -> &'static str {
    value.map_or("undefined", js_type_of)
}

fn check_string(path: &str, value: Option<&RawValue>, non_empty: bool, issues: &mut Vec<String>) {
    match value {
        Some(raw) if is_string(raw) => {
            if non_empty && !is_non_empty_string(raw) {
                issues.push(format!("{path} Too small: expected string to have >=1 characters"));
            }
        }
        other => issues.push(format!(
            "{path} Invalid input: expected string, received {}",
            received(other)
        )),
    }
}

/// The issues zod would report, in its order, or none.
fn payload_issues(fields: &[Field], payload: &RawValue) -> Vec<String> {
    let pairs: Option<Pairs<'_>> = if is_object(payload) {
        serde_json::from_str(payload.get()).ok()
    } else {
        None
    };

    let Some(pairs) = pairs else {
        return vec![format!(
            "payload Invalid input: expected object, received {}",
            js_type_of(payload)
        )];
    };

    let mut issues = Vec::new();

    for (name, kind) in fields {
        let value = pairs.get(name);

        match kind {
            Kind::Id => check_string(name, value, true, &mut issues),
            Kind::Str => check_string(name, value, false, &mut issues),
            Kind::Num => {
                if !value.is_some_and(is_number) {
                    issues.push(format!(
                        "{name} Invalid input: expected number, received {}",
                        received(value)
                    ));
                }
            }
            Kind::RankRecord => {
                let ranks: Option<Pairs<'_>> = value
                    .filter(|raw| is_object(raw))
                    .and_then(|raw| serde_json::from_str(raw.get()).ok());

                match ranks {
                    Some(ranks) => {
                        for (key, rank) in &ranks.0 {
                            check_string(&format!("{name}.{key}"), Some(rank), false, &mut issues);
                        }
                    }
                    None => issues.push(format!(
                        "{name} Invalid input: expected record, received {}",
                        received(value)
                    )),
                }
            }
        }
    }

    issues
}

/// Best-effort, and deliberately unwilling to guess: anything ambiguous is
/// None so the caller falls back to a board-wide lock rather than locking the
/// wrong node.
fn target_node_id(event: &RawEvent) -> Option<String> {
    let [(_, payload)] = event.rest.as_slice() else {
        return None;
    };

    if !is_object(payload) {
        return None;
    }

    let pairs: Pairs<'_> = serde_json::from_str(payload.get()).ok()?;
    let id = pairs.get("id").filter(|raw| is_non_empty_string(raw))?;

    serde_json::from_str::<String>(id.get()).ok()
}

fn is_supported_version(v: &serde_json::Number) -> bool {
    v.as_f64()
        .is_some_and(|v| READABLE_SCHEMA_VERSIONS.contains(&v))
}

/// Every event this build can apply, in the order given; the rest quarantined
/// onto `unreadable` with the reason a client needs to scope a lock.
#[cfg(test)]
pub fn decode<'a>(events: &[&'a RawEvent], unreadable: &mut Vec<Unreadable>) -> Vec<DecodedEvent<'a>> {
    events
        .iter()
        .filter_map(|&event| decode_one(event, unreadable))
        .collect()
}

/// One event, or None with the reason quarantined onto `unreadable`. The
/// verdict is a pure function of the event and is kept on it, so a resident
/// event is judged once however many loads it serves.
pub fn decode_one<'a>(event: &'a RawEvent, unreadable: &mut Vec<Unreadable>) -> Option<DecodedEvent<'a>> {
    if let Some(entry) = event.verdict.get_or_init(|| verdict_of(event)) {
        unreadable.push(entry.clone());
        return None;
    }

    let (action, payload) = &event.rest[0];

    Some(DecodedEvent {
        id: &event.id,
        action,
        payload,
        user_id: &event.user_id,
        user_name: &event.user_name,
    })
}

/// Why this build cannot apply the event, or None when it can.
fn verdict_of(event: &RawEvent) -> Option<Unreadable> {
    {
        let quarantine = |reason: &'static str, detail: String| Unreadable {
            event_id: Some(event.id.clone()),
            reason,
            detail,
            target_node_id: target_node_id(event),
        };

        if !is_supported_version(&event.v) {
            return Some(quarantine(UNSUPPORTED_SCHEMA_VERSION, format!("v{}", event.v)));
        }

        if event.rest.len() != 1 {
            return Some(quarantine(
                INVALID_PAYLOAD,
                format!(
                    "Invalid persisted event: expected exactly 1 action key, got {}",
                    event.rest.len()
                ),
            ));
        }

        let (action, payload) = &event.rest[0];

        let Some(fields) = required_fields(action) else {
            return Some(quarantine(UNKNOWN_ACTION, action.clone()));
        };

        let issues = payload_issues(fields, payload);

        if !issues.is_empty() {
            return Some(quarantine(INVALID_PAYLOAD, format!("{action}: {}", issues.join(", "))));
        }

        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::raw_json;
    use serde_json::Number;

    fn raw(v: i64, id: &str, rest: &[(&str, &str)]) -> RawEvent {
        RawEvent {
            v: Number::from(v),
            id: id.into(),
            ref_id: None,
            rest: rest.iter().map(|(k, t)| ((*k).to_string(), raw_json(t))).collect(),
            user_id: "u".into(),
            user_name: "U".into(),
            ..Default::default()
        }
    }

    // Action and JSON of each decoded event, owned, since the decoded ones
    // borrow the input.
    fn run(events: Vec<RawEvent>) -> (Vec<(String, String)>, Vec<Unreadable>) {
        let mut unreadable = Vec::new();
        let refs: Vec<&RawEvent> = events.iter().collect();
        let decoded = decode(&refs, &mut unreadable)
            .iter()
            .map(|d| (d.action.to_string(), serde_json::to_string(d).unwrap()))
            .collect();
        (decoded, unreadable)
    }

    #[test]
    fn decodes_a_known_action_in_the_app_event_shape() {
        let (decoded, unreadable) = run(vec![raw(
            1,
            "01B",
            &[("edit.title", r#"{"id":"n","name":"T","extra":1}"#)],
        )]);

        assert!(unreadable.is_empty());
        assert_eq!(
            decoded[0].1,
            r#"{"id":"01B","action":"edit.title","payload":{"id":"n","name":"T","extra":1},"userId":"u","userName":"U"}"#
        );
    }

    #[test]
    fn quarantines_in_the_loaders_order() {
        let (decoded, unreadable) = run(vec![
            raw(2, "01A", &[("edit.title", r#"{"id":"n","name":"T"}"#)]),
            raw(1, "01B", &[]),
            raw(1, "01C", &[("evil", "{}"), ("init.workspace", r#"{"id":"ws"}"#)]),
            raw(1, "01D", &[("redact.contributor", r#"{"id":"c"}"#)]),
            raw(1, "01E", &[("add.issue", r#"{"id":"n","name":"x","parent":"p","rank":42}"#)]),
            raw(1, "01F", &[("edit.title", "\"str\"")]),
        ]);

        assert!(decoded.is_empty());

        let summary: Vec<(&str, &str, Option<&str>)> = unreadable
            .iter()
            .map(|u| (u.reason, u.detail.as_str(), u.target_node_id.as_deref()))
            .collect();

        assert_eq!(
            summary,
            [
                (UNSUPPORTED_SCHEMA_VERSION, "v2", Some("n")),
                (INVALID_PAYLOAD, "Invalid persisted event: expected exactly 1 action key, got 0", None),
                (INVALID_PAYLOAD, "Invalid persisted event: expected exactly 1 action key, got 2", None),
                (UNKNOWN_ACTION, "redact.contributor", Some("c")),
                (INVALID_PAYLOAD, "add.issue: rank Invalid input: expected string, received number", Some("n")),
                (INVALID_PAYLOAD, "edit.title: payload Invalid input: expected object, received string", None),
            ]
        );
        assert_eq!(unreadable[0].event_id.as_deref(), Some("01A"));
    }

    #[test]
    fn reports_every_issue_the_way_zod_does() {
        let cases: &[(&str, &str, &str)] = &[
            ("add.issue", r#"{"id":5,"name":"n"}"#, "id Invalid input: expected string, received number, parent Invalid input: expected string, received undefined, rank Invalid input: expected string, received undefined"),
            ("add.issue", r#"{"id":"","name":null,"parent":"p","rank":"r"}"#, "id Too small: expected string to have >=1 characters, name Invalid input: expected string, received null"),
            ("rebalance.children", r#"{"parent":"p","ranks":null}"#, "ranks Invalid input: expected record, received null"),
            ("rebalance.children", r#"{"parent":"p","ranks":[]}"#, "ranks Invalid input: expected record, received array"),
            ("rebalance.children", r#"{"parent":"p","ranks":{"k":2,"m":"r","z":null}}"#, "ranks.k Invalid input: expected string, received number, ranks.z Invalid input: expected string, received null"),
            ("add.issue.attachment", r#"{"id":"a","issue":"i","hash":"","ext":"png","name":"n","bytes":"1"}"#, "hash Too small: expected string to have >=1 characters, bytes Invalid input: expected number, received string"),
            ("edit.title", "null", "payload Invalid input: expected object, received null"),
            ("edit.title", "[]", "payload Invalid input: expected object, received array"),
            ("edit.title", "true", "payload Invalid input: expected object, received boolean"),
            ("edit.title", "-2", "payload Invalid input: expected object, received number"),
        ];

        for (action, payload, expected) in cases {
            let (_, unreadable) = run(vec![raw(1, "01A", &[(action, payload)])]);
            assert_eq!(unreadable[0].detail, format!("{action}: {expected}"), "{action}");
        }
    }

    #[test]
    fn accepts_what_the_schemas_accept() {
        let cases: &[(&str, &str)] = &[
            ("add.issue.comment", r#"{"id":"c","issue":"i","md":""}"#),
            ("add.issue.attachment", r#"{"id":"a","issue":"i","hash":"h","ext":"weird","name":"","bytes":1.5}"#),
            ("rebalance.children", r#"{"parent":"p","ranks":{}}"#),
            ("link.contributor.user", r#"{"contributor":"c"}"#),
            ("add.field", r#"{"id":"f","name":"n","parent":"p","rank":"r","val":[1,2]}"#),
            ("edit.title", r#"{"id":"A","name":"\n"}"#),
        ];

        for (action, payload) in cases {
            let (decoded, unreadable) = run(vec![raw(1, "01A", &[(action, payload)])]);
            assert!(unreadable.is_empty(), "{action}: {:?}", unreadable);
            assert_eq!(decoded[0].0, *action);
        }
    }

    #[test]
    fn a_repeated_payload_key_is_judged_by_its_last_value() {
        let (decoded, unreadable) = run(vec![raw(1, "01A", &[("edit.title", r#"{"id":5,"name":"n","id":"ok"}"#)])]);
        assert!(unreadable.is_empty());
        assert_eq!(decoded.len(), 1);

        let (_, unreadable) = run(vec![raw(1, "01A", &[("edit.title", r#"{"id":"ok","name":"n","id":5}"#)])]);
        assert_eq!(unreadable[0].detail, "edit.title: id Invalid input: expected string, received number");
    }

    #[test]
    fn knows_every_action_the_typescript_registry_lists() {
        let actions = [
            "init.workspace", "add.workspace", "add.board", "add.swimlane", "add.issue", "add.field",
            "edit.title", "delete.node", "create.tag", "tombstone.tag", "restore.tag",
            "create.contributor", "rename.contributor", "tombstone.contributor", "restore.contributor",
            "add.issue.assignee", "remove.issue.assignee", "add.issue.tag", "remove.issue.tag",
            "move.node", "edit.description", "add.issue.comment", "edit.issue.comment",
            "delete.issue.comment", "add.issue.attachment", "delete.issue.attachment",
            "close.issue", "reopen.issue", "lock.node", "rebalance.children", "link.contributor.user",
        ];

        assert_eq!(actions.len(), 31);
        for action in actions {
            assert!(is_known_action(action), "{action}");
        }
        assert!(!is_known_action("redact.contributor"));
    }
}
