//! The shapes the TypeScript side already has, kept field for field so the
//! JSON that crosses the boundary is what `event-load.ts` would have built.
//!
//! Payloads stay as the text the line had them in: `serde_json::RawValue`
//! validates the JSON and keeps the bytes, so a load allocates one string per
//! payload rather than a tree per event, and hands the text through to the
//! host verbatim — `JSON.parse` there normalises it exactly as parsing the
//! line would have.

use std::cell::OnceCell;

use serde::ser::{SerializeMap, SerializeSeq};
use serde::{Serialize, Serializer};
use serde_json::value::RawValue;
use serde_json::{Number, Value};

/// Where a stored event lives, precisely enough to tell whether the host's
/// cache holds this very one: a file parsed again bumps its generation.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Origin {
    pub file_id: u32,
    pub generation: u32,
    pub index: usize,
}

/// A `ReconstructedEvent`: the envelope of one log line plus the actor the
/// file name carries. `rest` is every key that is not `v` or `id`, in the
/// order the line had them — the action key among them, and any others a
/// peer's build wrote. A key the line repeats keeps its first position and
/// its last value, as `JSON.parse` leaves it.
#[derive(Debug, Clone)]
pub struct RawEvent {
    pub v: Number,
    pub id: String,
    pub ref_id: Option<String>,
    pub rest: Vec<(String, Box<RawValue>)>,
    pub user_id: String,
    pub user_name: String,
    /// Set by the store for a kept event; a trailing line's event has none.
    pub origin: Option<Origin>,
    /// The decode outcome, computed once: None when decodable, else the
    /// quarantine entry. A pure function of the event, so it never changes.
    pub verdict: OnceCell<Option<Unreadable>>,
}

impl Default for RawEvent {
    fn default() -> Self {
        RawEvent {
            v: Number::from(0),
            id: String::new(),
            ref_id: None,
            rest: Vec::new(),
            user_id: String::new(),
            user_name: String::new(),
            origin: None,
            verdict: OnceCell::new(),
        }
    }
}

impl RawEvent {
    /// The keys that are neither envelope nor actor: what `getPersistedAction`
    /// counts, and what the genesis check reads.
    pub fn action_keys(&self) -> impl Iterator<Item = &str> {
        self.rest.iter().map(|(key, _)| key.as_str())
    }

    /// The tie-break text: `JSON.stringify` of the reconstructed event as
    /// TypeScript holds it — parsed, so whitespace and escapes are canonical
    /// — whose key order is `v`, `id`, the line's other keys, then the actor.
    /// Only two events sharing an id ever need it.
    pub fn stringified(&self) -> String {
        let mut map = serde_json::Map::new();
        map.insert("v".into(), Value::Number(self.v.clone()));
        map.insert(
            "id".into(),
            Value::Array(vec![
                Value::String(self.id.clone()),
                self.ref_id.clone().map_or(Value::Null, Value::String),
            ]),
        );

        for (key, raw) in &self.rest {
            let value = serde_json::from_str(raw.get()).unwrap_or(Value::Null);
            map.insert(key.clone(), value);
        }

        map.insert("userId".into(), Value::String(self.user_id.clone()));
        map.insert("userName".into(), Value::String(self.user_name.clone()));

        Value::Object(map).to_string()
    }
}

impl PartialEq for RawEvent {
    fn eq(&self, other: &Self) -> bool {
        self.v == other.v
            && self.id == other.id
            && self.ref_id == other.ref_id
            && self.user_id == other.user_id
            && self.user_name == other.user_name
            && self.rest.len() == other.rest.len()
            && self
                .rest
                .iter()
                .zip(&other.rest)
                .all(|(a, b)| a.0 == b.0 && a.1.get() == b.1.get())
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
pub fn raw_json(text: &str) -> Box<RawValue> {
    RawValue::from_string(text.to_string()).expect("valid JSON in a test")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serialises_in_the_reconstructed_key_order() {
        let event = RawEvent {
            v: Number::from(1),
            id: "01B".into(),
            ref_id: Some("01A".into()),
            rest: vec![("edit.title".into(), raw_json(r#"{"id": "n","name":"T"}"#))],
            user_id: "U".into(),
            user_name: "Ann".into(),
            ..Default::default()
        };

        // Verbatim across the boundary, canonical for the tie-break.
        assert_eq!(
            serde_json::to_string(&event).unwrap(),
            r#"{"v":1,"id":["01B","01A"],"edit.title":{"id": "n","name":"T"},"userId":"U","userName":"Ann"}"#
        );
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
            rest: vec![],
            user_id: "U".into(),
            user_name: "Ann".into(),
            ..Default::default()
        };

        assert_eq!(
            event.stringified(),
            r#"{"v":1,"id":["01A",null],"userId":"U","userName":"Ann"}"#
        );
    }
}
