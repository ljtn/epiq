//! What a checkout cut judges each event by.
//!
//! A ULID's leading ten characters are a millisecond timestamp, and only a
//! lower bound at that: the wall clock is one input to minting, causality the
//! other. A poisoned id — decodable but absurdly far ahead — must not be
//! allowed to hide history, so it inherits its predecessor's effective time.
//! Ports `decodeTime` (the ulid package), `toEffectiveUlidTimes`
//! (`date-utils.ts`), and `splitEventsAtTime` (`event-load.ts`).

use std::collections::HashSet;

use crate::model::RawEvent;

/// Honest clock skew between machines is minutes; a decoded time further
/// ahead than this is not a fact about time.
pub const MAX_ULID_AHEAD_MS: f64 = 24.0 * 60.0 * 60.0 * 1000.0;

const ENCODING: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_LEN: usize = 10;
const ULID_LEN: usize = 26;
const TIME_MAX: f64 = 281_474_976_710_655.0;

/// The timestamp in a ULID, or None where `decodeTime` would throw: not 26
/// characters (UTF-16 units, as JavaScript counts), a time character outside
/// Crockford's alphabet after upper-casing, or a value past 2^48 - 1.
pub fn decode_time(id: &str) -> Option<f64> {
    if id.encode_utf16().count() != ULID_LEN {
        return None;
    }

    let mut time = 0.0f64;

    for (index, unit) in id.encode_utf16().take(TIME_LEN).enumerate() {
        let byte = u8::try_from(unit).ok()?.to_ascii_uppercase();
        let digit = ENCODING.iter().position(|&c| c == byte)? as f64;
        let power = 32f64.powi((TIME_LEN - 1 - index) as i32);
        time += digit * power;
    }

    if time > TIME_MAX {
        return None;
    }

    Some(time)
}

/// Effective times for one causally ordered set: a poisoned time inherits its
/// predecessor's (else the first honest) time, deterministically per set. A
/// set with no honest time passes through raw; nulls (undecodable ids) pass
/// through and do not advance the predecessor.
pub fn effective_times(times: &[Option<f64>], now: f64) -> Vec<Option<f64>> {
    let ceiling = now + MAX_ULID_AHEAD_MS;

    let first_honest = times
        .iter()
        .flatten()
        .copied()
        .find(|&t| t <= ceiling);

    let Some(first_honest) = first_honest else {
        return times.to_vec();
    };

    let mut previous: Option<f64> = None;

    times
        .iter()
        .map(|time| {
            let t = (*time)?;
            let effective = if t <= ceiling {
                t
            } else {
                previous.unwrap_or(first_honest)
            };
            previous = Some(effective);

            Some(effective)
        })
        .collect()
}

/// The effective time of every event of a causally ordered set.
pub fn effective_event_times(events: &[&RawEvent], now: f64) -> Vec<Option<f64>> {
    let raw: Vec<Option<f64>> = events.iter().map(|e| decode_time(&e.id)).collect();

    effective_times(&raw, now)
}

/// A cut at `target`: applied where the effective time is known and earlier,
/// and the parent is applied too; unapplied otherwise, descendants included.
pub fn split_at<'a>(events: Vec<&'a RawEvent>, target: f64, now: f64) -> (Vec<&'a RawEvent>, Vec<&'a RawEvent>) {
    let times = effective_event_times(&events, now);
    let mut unapplied_ids: HashSet<String> = HashSet::new();
    let mut applied = Vec::new();
    let mut unapplied = Vec::new();

    for (event, time) in events.into_iter().zip(times) {
        let should_apply = matches!(time, Some(t) if t < target);
        let parent_unapplied = event
            .ref_id
            .as_deref()
            .is_some_and(|ref_id| unapplied_ids.contains(ref_id));

        if !should_apply || parent_unapplied {
            unapplied_ids.insert(event.id.clone());
            unapplied.push(event);
        } else {
            applied.push(event);
        }
    }

    (applied, unapplied)
}

/// The tail of the causal order, which the next write points at.
pub fn edge<'a>(events: &[&'a RawEvent]) -> Option<&'a str> {
    events.last().map(|e| e.id.as_str())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::raw_json;
    use serde_json::Number;

    // The tests build owned events; the cut borrows them.
    fn split_at(events: Vec<RawEvent>, target: f64, now: f64) -> (Vec<RawEvent>, Vec<RawEvent>) {
        let (applied, unapplied) = super::split_at(events.iter().collect(), target, now);
        (
            applied.into_iter().cloned().collect(),
            unapplied.into_iter().cloned().collect(),
        )
    }

    fn edge(events: &[RawEvent]) -> Option<&str> {
        super::edge(&events.iter().collect::<Vec<_>>())
    }

    const NOW: f64 = 1_700_000_000_000.0;
    const DAY: f64 = 24.0 * 60.0 * 60.0 * 1000.0;

    fn event(id: &str, after: Option<&str>) -> RawEvent {
        RawEvent {
            v: Number::from(1),
            id: id.into(),
            ref_id: after.map(Into::into),
            rest: vec![("x".into(), raw_json("{}"))],
            user_id: "u".into(),
            user_name: "U".into(),
            ..Default::default()
        }
    }

    // The ulid package's own encoding, so the tests do not hard-code digits.
    fn encode_time(mut time: u64) -> String {
        let mut out = vec![b'0'; TIME_LEN];
        for slot in out.iter_mut().rev() {
            *slot = ENCODING[(time % 32) as usize];
            time /= 32;
        }
        String::from_utf8(out).unwrap()
    }

    fn ulid_at(time: f64, suffix: &str) -> String {
        format!("{}{suffix:0>16}", encode_time(time as u64))
    }

    #[test]
    fn decodes_the_leading_ten_characters() {
        assert_eq!(decode_time("01ARZ3NDEKTSV4RRFFQ69G5FAV"), Some(1_469_922_850_259.0));
        assert_eq!(decode_time("01arz3ndektsv4rrffq69g5fav"), Some(1_469_922_850_259.0));
        assert_eq!(decode_time(&ulid_at(NOW, "A")), Some(NOW));
    }

    #[test]
    fn refuses_what_decode_time_throws_on() {
        assert_eq!(decode_time(""), None);
        assert_eq!(decode_time("01ARZ3NDEKTSV4RRFFQ69G5FA"), None);
        assert_eq!(decode_time("01ARZ3NDEKTSV4RRFFQ69G5FAVX"), None);
        assert_eq!(decode_time("01ARZ3NDIKTSV4RRFFQ69G5FAV"), None);
        assert_eq!(decode_time("80000000000000000000000000"), None);
        assert_eq!(decode_time("7ZZZZZZZZZ0000000000000000"), Some(TIME_MAX));
        assert_eq!(decode_time("é1ARZ3NDEKTSV4RRFFQ69G5FAV"), None);
    }

    #[test]
    fn a_poisoned_time_inherits_its_predecessor() {
        let times = [Some(NOW), Some(NOW + 2.0 * DAY), Some(NOW + 1.0)];
        assert_eq!(effective_times(&times, NOW), [Some(NOW), Some(NOW), Some(NOW + 1.0)]);
    }

    #[test]
    fn consecutive_poisoned_times_chain_through() {
        let times = [Some(NOW), Some(NOW + 2.0 * DAY), Some(NOW + 3.0 * DAY)];
        assert_eq!(effective_times(&times, NOW), [Some(NOW), Some(NOW), Some(NOW)]);
    }

    #[test]
    fn a_poisoned_leader_takes_the_first_honest_time() {
        let times = [Some(NOW + 2.0 * DAY), Some(NOW - 5.0), Some(NOW)];
        assert_eq!(effective_times(&times, NOW), [Some(NOW - 5.0), Some(NOW - 5.0), Some(NOW)]);
    }

    #[test]
    fn all_poisoned_passes_through_raw() {
        let times = [Some(NOW + 2.0 * DAY), Some(NOW + 3.0 * DAY)];
        assert_eq!(effective_times(&times, NOW), times);
    }

    #[test]
    fn nulls_pass_through_without_advancing() {
        let times = [Some(NOW), None, Some(NOW + 2.0 * DAY)];
        assert_eq!(effective_times(&times, NOW), [Some(NOW), None, Some(NOW)]);
    }

    #[test]
    fn one_day_of_skew_is_honest() {
        let times = [Some(NOW), Some(NOW + DAY)];
        assert_eq!(effective_times(&times, NOW), times);
    }

    fn ids(events: &[RawEvent]) -> Vec<&str> {
        events.iter().map(|e| e.id.as_str()).collect()
    }

    #[test]
    fn splits_before_at_and_after_the_target() {
        let a = ulid_at(NOW - 10.0, "A");
        let b = ulid_at(NOW, "B");
        let c = ulid_at(NOW + 10.0, "C");
        let events = vec![event(&a, None), event(&b, Some(&a)), event(&c, Some(&b))];

        let (applied, unapplied) = split_at(events, NOW, NOW);

        assert_eq!(ids(&applied), [a.as_str()]);
        assert_eq!(ids(&unapplied), [b.as_str(), c.as_str()]);
    }

    #[test]
    fn a_child_of_an_unapplied_event_stays_unapplied() {
        let a = ulid_at(NOW - 10.0, "A");
        let late = ulid_at(NOW + 10.0, "B");
        let honest_child = ulid_at(NOW - 5.0, "C");
        let sibling = ulid_at(NOW - 4.0, "D");
        let events = vec![
            event(&a, None),
            event(&late, Some(&a)),
            event(&honest_child, Some(&late)),
            event(&sibling, Some(&a)),
        ];

        let (applied, unapplied) = split_at(events, NOW, NOW);

        assert_eq!(ids(&applied), [a.as_str(), sibling.as_str()]);
        assert_eq!(ids(&unapplied), [late.as_str(), honest_child.as_str()]);
    }

    #[test]
    fn an_undecodable_id_is_unapplied() {
        let a = ulid_at(NOW - 10.0, "A");
        let events = vec![event(&a, None), event("not-a-ulid", Some(&a))];

        let (applied, unapplied) = split_at(events, NOW, NOW);

        assert_eq!(ids(&applied), [a.as_str()]);
        assert_eq!(ids(&unapplied), ["not-a-ulid"]);
    }

    #[test]
    fn a_poisoned_event_applies_at_a_checkout_of_the_present() {
        let a = ulid_at(NOW - 10.0, "A");
        let poisoned = ulid_at(NOW + 2.0 * DAY, "B");
        let events = vec![event(&a, None), event(&poisoned, Some(&a))];

        let (applied, unapplied) = split_at(events, NOW, NOW);

        assert_eq!(ids(&applied), [a.as_str(), poisoned.as_str()]);
        assert!(unapplied.is_empty());
    }

    #[test]
    fn the_edge_is_the_last_event() {
        assert_eq!(edge(&[]), None);
        assert_eq!(edge(&[event("01A", None), event("01B", Some("01A"))]), Some("01B"));
    }
}
