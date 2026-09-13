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
use serde_json::Value;

use crate::model::{RawEvent, Unreadable, INVALID_PAYLOAD, UNKNOWN_ACTION, UNSUPPORTED_SCHEMA_VERSION};

/// An `AppEvent`: what the materializer consumes.
#[derive(Debug, Clone, PartialEq)]
pub struct DecodedEvent {
    pub id: String,
    pub action: String,
    pub payload: Value,
    pub user_id: String,
    pub user_name: String,
}

impl Serialize for DecodedEvent {
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

pub fn is_known_action(action: &str) -> bool {
    required_fields(action).is_some()
}

fn received(value: Option<&Value>) -> &'static str {
    match value {
        None => "undefined",
        Some(Value::Null) => "null",
        Some(Value::Bool(_)) => "boolean",
        Some(Value::Number(_)) => "number",
        Some(Value::String(_)) => "string",
        Some(Value::Array(_)) => "array",
        Some(Value::Object(_)) => "object",
    }
}

fn check_string(path: &str, value: Option<&Value>, non_empty: bool, issues: &mut Vec<String>) {
    match value {
        Some(Value::String(s)) => {
            if non_empty && s.is_empty() {
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
fn payload_issues(fields: &[Field], payload: &Value) -> Vec<String> {
    let Value::Object(object) = payload else {
        return vec![format!(
            "payload Invalid input: expected object, received {}",
            received(Some(payload))
        )];
    };

    let mut issues = Vec::new();

    for (name, kind) in fields {
        let value = object.get(*name);

        match kind {
            Kind::Id => check_string(name, value, true, &mut issues),
            Kind::Str => check_string(name, value, false, &mut issues),
            Kind::Num => {
                if !matches!(value, Some(Value::Number(_))) {
                    issues.push(format!(
                        "{name} Invalid input: expected number, received {}",
                        received(value)
                    ));
                }
            }
            Kind::RankRecord => match value {
                Some(Value::Object(ranks)) => {
                    for (key, rank) in ranks {
                        check_string(&format!("{name}.{key}"), Some(rank), false, &mut issues);
                    }
                }
                other => issues.push(format!(
                    "{name} Invalid input: expected record, received {}",
                    received(other)
                )),
            },
        }
    }

    issues
}

/// Best-effort, and deliberately unwilling to guess: anything ambiguous is
/// None so the caller falls back to a board-wide lock rather than locking the
/// wrong node.
fn target_node_id(event: &RawEvent) -> Option<String> {
    if event.rest.len() != 1 {
        return None;
    }

    let payload = event.rest.values().next()?;

    match payload.get("id") {
        Some(Value::String(id)) if !id.is_empty() => Some(id.clone()),
        _ => None,
    }
}

fn is_supported_version(v: &serde_json::Number) -> bool {
    v.as_f64()
        .is_some_and(|v| READABLE_SCHEMA_VERSIONS.contains(&v))
}

/// Every event this build can apply, in the order given; the rest quarantined
/// onto `unreadable` with the reason a client needs to scope a lock.
pub fn decode(events: Vec<RawEvent>, unreadable: &mut Vec<Unreadable>) -> Vec<DecodedEvent> {
    let mut decoded = Vec::with_capacity(events.len());

    for event in events {
        let quarantine = |reason: &'static str, detail: String| Unreadable {
            event_id: Some(event.id.clone()),
            reason,
            detail,
            target_node_id: target_node_id(&event),
        };

        if !is_supported_version(&event.v) {
            unreadable.push(quarantine(UNSUPPORTED_SCHEMA_VERSION, format!("v{}", event.v)));
            continue;
        }

        if event.rest.len() != 1 {
            unreadable.push(quarantine(
                INVALID_PAYLOAD,
                format!(
                    "Invalid persisted event: expected exactly 1 action key, got {}",
                    event.rest.len()
                ),
            ));
            continue;
        }

        let action = event.rest.keys().next().expect("one key").clone();

        let Some(fields) = required_fields(&action) else {
            unreadable.push(quarantine(UNKNOWN_ACTION, action));
            continue;
        };

        let payload = event.rest.values().next().expect("one value");
        let issues = payload_issues(fields, payload);

        if !issues.is_empty() {
            unreadable.push(quarantine(INVALID_PAYLOAD, format!("{action}: {}", issues.join(", "))));
            continue;
        }

        let mut event = event;
        let payload = event.rest.shift_remove(&action).expect("the one value");

        decoded.push(DecodedEvent {
            id: event.id,
            action,
            payload,
            user_id: event.user_id,
            user_name: event.user_name,
        });
    }

    decoded
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Map, Number};

    fn raw(v: i64, id: &str, rest: &[(&str, Value)]) -> RawEvent {
        let mut map = Map::new();
        for (key, value) in rest {
            map.insert((*key).into(), value.clone());
        }

        RawEvent {
            v: Number::from(v),
            id: id.into(),
            ref_id: None,
            rest: map,
            user_id: "u".into(),
            user_name: "U".into(),
        }
    }

    fn run(events: Vec<RawEvent>) -> (Vec<DecodedEvent>, Vec<Unreadable>) {
        let mut unreadable = Vec::new();
        let decoded = decode(events, &mut unreadable);
        (decoded, unreadable)
    }

    #[test]
    fn decodes_a_known_action_in_the_app_event_shape() {
        let (decoded, unreadable) = run(vec![raw(
            1,
            "01B",
            &[("edit.title", json!({"id": "n", "name": "T", "extra": 1}))],
        )]);

        assert!(unreadable.is_empty());
        assert_eq!(
            serde_json::to_string(&decoded[0]).unwrap(),
            r#"{"id":"01B","action":"edit.title","payload":{"id":"n","name":"T","extra":1},"userId":"u","userName":"U"}"#
        );
    }

    #[test]
    fn quarantines_in_the_loaders_order() {
        let (decoded, unreadable) = run(vec![
            raw(2, "01A", &[("edit.title", json!({"id": "n", "name": "T"}))]),
            raw(1, "01B", &[]),
            raw(1, "01C", &[("evil", json!({})), ("init.workspace", json!({"id": "ws"}))]),
            raw(1, "01D", &[("redact.contributor", json!({"id": "c"}))]),
            raw(1, "01E", &[("add.issue", json!({"id": "n", "name": "x", "parent": "p", "rank": 42}))]),
            raw(1, "01F", &[("edit.title", json!("str"))]),
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
        let cases: &[(&str, Value, &str)] = &[
            ("add.issue", json!({"id": 5, "name": "n"}), "id Invalid input: expected string, received number, parent Invalid input: expected string, received undefined, rank Invalid input: expected string, received undefined"),
            ("add.issue", json!({"id": "", "name": null, "parent": "p", "rank": "r"}), "id Too small: expected string to have >=1 characters, name Invalid input: expected string, received null"),
            ("rebalance.children", json!({"parent": "p", "ranks": null}), "ranks Invalid input: expected record, received null"),
            ("rebalance.children", json!({"parent": "p", "ranks": []}), "ranks Invalid input: expected record, received array"),
            ("rebalance.children", json!({"parent": "p", "ranks": {"k": 2, "m": "r", "z": null}}), "ranks.k Invalid input: expected string, received number, ranks.z Invalid input: expected string, received null"),
            ("add.issue.attachment", json!({"id": "a", "issue": "i", "hash": "", "ext": "png", "name": "n", "bytes": "1"}), "hash Too small: expected string to have >=1 characters, bytes Invalid input: expected number, received string"),
            ("edit.title", json!(null), "payload Invalid input: expected object, received null"),
            ("edit.title", json!([]), "payload Invalid input: expected object, received array"),
        ];

        for (action, payload, expected) in cases {
            let (_, unreadable) = run(vec![raw(1, "01A", &[(action, payload.clone())])]);
            assert_eq!(unreadable[0].detail, format!("{action}: {expected}"), "{action}");
        }
    }

    #[test]
    fn accepts_what_the_schemas_accept() {
        let cases: &[(&str, Value)] = &[
            ("add.issue.comment", json!({"id": "c", "issue": "i", "md": ""})),
            ("add.issue.attachment", json!({"id": "a", "issue": "i", "hash": "h", "ext": "weird", "name": "", "bytes": 1.5})),
            ("rebalance.children", json!({"parent": "p", "ranks": {}})),
            ("link.contributor.user", json!({"contributor": "c"})),
            ("add.field", json!({"id": "f", "name": "n", "parent": "p", "rank": "r", "val": [1, 2]})),
        ];

        for (action, payload) in cases {
            let (decoded, unreadable) = run(vec![raw(1, "01A", &[(action, payload.clone())])]);
            assert!(unreadable.is_empty(), "{action}: {:?}", unreadable);
            assert_eq!(decoded[0].action, *action);
        }
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
