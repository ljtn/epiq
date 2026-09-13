//! The shapes the TypeScript side already has, kept field for field so the
//! JSON that crosses the boundary is what `event-load.ts` would have built.

use serde::ser::{SerializeMap, SerializeSeq};
use serde::{Serialize, Serializer};
use serde_json::{Map, Number, Value};

/// A `ReconstructedEvent`: the envelope of one log line plus the actor the
/// file name carries. `rest` is every key that is not `v` or `id`, in the
/// order the line had them — the action key among them, and any others a
/// peer's build wrote.
#[derive(Debug, Clone, PartialEq)]
pub struct RawEvent {
    pub v: Number,
    pub id: String,
    pub ref_id: Option<String>,
    pub rest: Map<String, Value>,
    pub user_id: String,
    pub user_name: String,
}

impl RawEvent {
    /// The keys that are neither envelope nor actor: what `getPersistedAction`
    /// counts, and what the genesis check reads.
    pub fn action_keys(&self) -> impl Iterator<Item = &str> {
        self.rest.keys().map(String::as_str)
    }

    /// The tie-break text: `JSON.stringify` of the reconstructed event, whose
    /// key order is `v`, `id`, the line's other keys, then the actor.
    pub fn stringified(&self) -> String {
        serde_json::to_string(self).expect("an event serialises")
    }
}

impl Serialize for RawEvent {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(Some(4 + self.rest.len()))?;
        map.serialize_entry("v", &self.v)?;
        map.serialize_entry("id", &CompositeId(&self.id, self.ref_id.as_deref()))?;

        for (key, value) in &self.rest {
            map.serialize_entry(key, value)?;
        }

        map.serialize_entry("userId", &self.user_id)?;
        map.serialize_entry("userName", &self.user_name)?;
        map.end()
    }
}

struct CompositeId<'a>(&'a str, Option<&'a str>);

impl Serialize for CompositeId<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut seq = serializer.serialize_seq(Some(2))?;
        seq.serialize_element(self.0)?;
        seq.serialize_element(&self.1)?;
        seq.end()
    }
}

/// An `UnreadableEvent`: a line the load kept its place for but cannot
/// interpret, or — `corrupt-line` — one it could not place at all.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Unreadable {
    pub event_id: Option<String>,
    pub reason: &'static str,
    pub detail: String,
    pub target_node_id: Option<String>,
}

pub const CORRUPT_LINE: &str = "corrupt-line";
pub const UNSUPPORTED_SCHEMA_VERSION: &str = "unsupported-schema-version";
pub const UNKNOWN_ACTION: &str = "unknown-action";
pub const INVALID_PAYLOAD: &str = "invalid-payload";

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn serialises_in_the_reconstructed_key_order() {
        let mut rest = Map::new();
        rest.insert("edit.title".into(), json!({"id": "n", "name": "T"}));

        let event = RawEvent {
            v: Number::from(1),
            id: "01B".into(),
            ref_id: Some("01A".into()),
            rest,
            user_id: "U".into(),
            user_name: "Ann".into(),
        };

        assert_eq!(
            event.stringified(),
            r#"{"v":1,"id":["01B","01A"],"edit.title":{"id":"n","name":"T"},"userId":"U","userName":"Ann"}"#
        );
    }

    #[test]
    fn a_root_serialises_a_null_ref() {
        let event = RawEvent {
            v: Number::from(1),
            id: "01A".into(),
            ref_id: None,
            rest: Map::new(),
            user_id: "U".into(),
            user_name: "Ann".into(),
        };

        assert_eq!(
            event.stringified(),
            r#"{"v":1,"id":["01A",null],"userId":"U","userName":"Ann"}"#
        );
    }
}
