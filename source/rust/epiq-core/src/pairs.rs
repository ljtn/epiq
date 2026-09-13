//! A JSON object as its members, in order, with the values left as text.
//!
//! `JSON.parse` keeps the first position and the last value of a repeated
//! key; so does this, so what reaches the host is what the line would have
//! parsed to there.

use std::borrow::Cow;
use std::fmt;

use serde::de::{Deserializer, MapAccess, Visitor};
use serde::Deserialize;
use serde_json::value::RawValue;

/// The members of one object, borrowing from the text where it can.
pub struct Pairs<'a>(pub Vec<(Cow<'a, str>, &'a RawValue)>);

impl<'a> Pairs<'a> {
    pub fn get(&self, key: &str) -> Option<&'a RawValue> {
        self.0.iter().find(|(k, _)| k == key).map(|(_, v)| *v)
    }

    fn push(&mut self, key: Cow<'a, str>, value: &'a RawValue) {
        match self.0.iter_mut().find(|(k, _)| *k == key) {
            Some(slot) => slot.1 = value,
            None => self.0.push((key, value)),
        }
    }
}

impl<'de> Deserialize<'de> for Pairs<'de> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct PairsVisitor;

        impl<'de> Visitor<'de> for PairsVisitor {
            type Value = Pairs<'de>;

            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("a JSON object")
            }

            fn visit_map<M: MapAccess<'de>>(self, mut access: M) -> Result<Self::Value, M::Error> {
                let mut pairs = Pairs(Vec::with_capacity(access.size_hint().unwrap_or(4)));

                while let Some((key, value)) = access.next_entry::<Cow<'de, str>, &'de RawValue>()? {
                    pairs.push(key, value);
                }

                Ok(pairs)
            }
        }

        deserializer.deserialize_map(PairsVisitor)
    }
}

/// What `typeof`-style reporting calls the value a raw JSON text holds.
pub fn js_type_of(raw: &RawValue) -> &'static str {
    match raw.get().as_bytes().first() {
        Some(b'{') => "object",
        Some(b'[') => "array",
        Some(b'"') => "string",
        Some(b'n') => "null",
        Some(b't') | Some(b'f') => "boolean",
        _ => "number",
    }
}

pub fn is_string(raw: &RawValue) -> bool {
    raw.get().starts_with('"')
}

/// A string with at least one character: any string text but `""`.
pub fn is_non_empty_string(raw: &RawValue) -> bool {
    is_string(raw) && raw.get() != "\"\""
}

pub fn is_number(raw: &RawValue) -> bool {
    matches!(raw.get().as_bytes().first(), Some(b'-') | Some(b'0'..=b'9'))
}

pub fn is_object(raw: &RawValue) -> bool {
    raw.get().starts_with('{')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_order_first_position_and_last_value() {
        let pairs: Pairs<'_> = serde_json::from_str(r#"{"b": 1, "a": {"x":[1, 2]}, "b": "two", "cA": null}"#).unwrap();

        let keys: Vec<&str> = pairs.0.iter().map(|(k, _)| k.as_ref()).collect();
        assert_eq!(keys, ["b", "a", "cA"]);
        assert_eq!(pairs.get("b").unwrap().get(), "\"two\"");
        assert_eq!(pairs.get("a").unwrap().get(), "{\"x\":[1, 2]}");
        assert!(pairs.get("z").is_none());
    }

    #[test]
    fn refuses_a_non_object() {
        assert!(serde_json::from_str::<Pairs<'_>>("[1]").is_err());
        assert!(serde_json::from_str::<Pairs<'_>>("\"s\"").is_err());
    }

    #[test]
    fn classifies_raw_values() {
        let raw = |t: &str| RawValue::from_string(t.into()).unwrap();
        assert_eq!(js_type_of(&raw("{}")), "object");
        assert_eq!(js_type_of(&raw("[]")), "array");
        assert_eq!(js_type_of(&raw("\"\"")), "string");
        assert_eq!(js_type_of(&raw("null")), "null");
        assert_eq!(js_type_of(&raw("true")), "boolean");
        assert_eq!(js_type_of(&raw("-1.5e3")), "number");
        assert!(is_non_empty_string(&raw("\"a\"")));
        assert!(!is_non_empty_string(&raw("\"\"")));
        assert!(is_number(&raw("0")));
        assert!(!is_number(&raw("\"0\"")));
    }
}
