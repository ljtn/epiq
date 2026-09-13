//! The causal order: a function of the event set alone.
//!
//! Every event names its parent in `ref_id`; the forest that gives is walked
//! depth-first from genesis, siblings in id order, and whatever the walk did
//! not reach — orphans whose parent is missing, then cycles — is appended in
//! the same order. A duplicated id is placed once. This is `getSortedEvents`
//! in `event-load.ts`, step for step.

use std::cmp::Ordering;
use rustc_hash::FxHashMap;

use crate::model::RawEvent;

const GENESIS: &str = "init.workspace";

/// Ids by code unit, then the whole stringified event: the actor comes off
/// the file name and the payload off the line, both identical on every
/// replica, so two events sharing an id still land the same way everywhere.
fn compare(a: &RawEvent, b: &RawEvent) -> Ordering {
    match a.id.as_bytes().cmp(b.id.as_bytes()) {
        Ordering::Equal => a.stringified().as_bytes().cmp(b.stringified().as_bytes()),
        other => other,
    }
}

/// Only genesis is a legal root. Any other parentless event — trivially
/// forgeable, and able to sort in front of all of history via a low id — is
/// anchored after the known history, with the orphans. Exactly one action
/// key, or extra keys smuggle a payload past the check.
fn is_genesis(event: &RawEvent) -> bool {
    let mut keys = event.action_keys();

    matches!((keys.next(), keys.next()), (Some(GENESIS), None))
}

pub fn sorted<'a>(events: Vec<&'a RawEvent>) -> Vec<&'a RawEvent> {
    order_indices(&events).into_iter().map(|index| events[index]).collect()
}

// Every event is a slot; two extra slots stand for "no parent" and "a parent
// nobody has". Children are grouped by their parent's slot in one flat array
// (counts, prefix sums, fill), so the forest costs two allocations rather
// than a list per parent.
fn order_indices<'a>(events: &[&'a RawEvent]) -> Vec<usize> {
    let n = events.len();
    let root_slot = n;
    let orphan_slot = n + 1;

    // The first index carrying each id: an id's slot. Grouping is by the id
    // *string*, so events sharing an id share a slot, as they share a key in
    // TypeScript's maps.
    let mut slot_of_id: FxHashMap<&'a str, usize> =
        FxHashMap::with_capacity_and_hasher(n, Default::default());
    for (index, event) in events.iter().enumerate() {
        slot_of_id.entry(&event.id).or_insert(index);
    }

    let canonical: Vec<usize> = events.iter().map(|e| slot_of_id[e.id.as_str()]).collect();
    let parent_slot: Vec<usize> = events
        .iter()
        .map(|e| match e.ref_id.as_deref() {
            None => root_slot,
            Some(ref_id) => slot_of_id.get(ref_id).copied().unwrap_or(orphan_slot),
        })
        .collect();

    let mut start = vec![0usize; n + 3];
    for &slot in &parent_slot {
        start[slot + 1] += 1;
    }
    for slot in 0..n + 2 {
        start[slot + 1] += start[slot];
    }

    let mut children = vec![0usize; n];
    let mut cursor = start.clone();
    for (index, &slot) in parent_slot.iter().enumerate() {
        children[cursor[slot]] = index;
        cursor[slot] += 1;
    }

    for slot in 0..n + 2 {
        children[start[slot]..start[slot + 1]].sort_by(|&a, &b| compare(events[a], events[b]));
    }

    let children_of = |slot: usize| &children[start[slot]..start[slot + 1]];

    let mut order: Vec<usize> = Vec::with_capacity(n);
    let mut placed = vec![false; n];

    // Depth-first on an explicit stack: every event refs its predecessor, so
    // the forest is one chain as long as the log.
    let visit = |root: usize, order: &mut Vec<usize>, placed: &mut Vec<bool>| {
        let mut stack = vec![root];

        while let Some(index) = stack.pop() {
            let id_slot = canonical[index];

            if placed[id_slot] {
                continue;
            }

            placed[id_slot] = true;
            order.push(index);

            // Reversed, so the lowest sibling is popped first.
            stack.extend(children_of(id_slot).iter().rev());
        }
    };

    let roots: Vec<usize> = children_of(root_slot)
        .iter()
        .copied()
        .filter(|&index| is_genesis(events[index]))
        .collect();

    for root in roots {
        visit(root, &mut order, &mut placed);
    }

    let mut orphan_roots: Vec<usize> = (0..n)
        .filter(|&index| !placed[canonical[index]] && parent_slot[index] >= root_slot)
        .collect();
    orphan_roots.sort_by(|&a, &b| compare(events[a], events[b]));

    for root in orphan_roots {
        visit(root, &mut order, &mut placed);
    }

    let mut remaining: Vec<usize> = (0..n).filter(|&index| !placed[canonical[index]]).collect();
    remaining.sort_by(|&a, &b| compare(events[a], events[b]));

    for index in remaining {
        visit(index, &mut order, &mut placed);
    }

    order
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::raw_json;
    use serde_json::Number;

    // The tests build owned events; the order borrows them.
    fn sorted(events: Vec<RawEvent>) -> Vec<RawEvent> {
        super::sorted(events.iter().collect()).into_iter().cloned().collect()
    }

    fn event(id: &str, after: Option<&str>, action: &str) -> RawEvent {
        RawEvent {
            v: Number::from(1),
            id: id.into(),
            ref_id: after.map(Into::into),
            rest: vec![(action.into(), raw_json("{}"))],
            user_id: "user".into(),
            user_name: "User".into(),
            ..Default::default()
        }
    }

    fn genesis(id: &str) -> RawEvent {
        event(id, None, GENESIS)
    }

    fn ids(events: &[RawEvent]) -> Vec<&str> {
        events.iter().map(|e| e.id.as_str()).collect()
    }

    #[test]
    fn places_an_event_after_its_anchor_whatever_the_input_order() {
        let sorted = sorted(vec![
            event("01C", Some("01A"), "x"),
            event("01B", Some("01A"), "x"),
            genesis("01A"),
        ]);

        assert_eq!(ids(&sorted), ["01A", "01B", "01C"]);
    }

    #[test]
    fn places_anchored_events_before_later_siblings() {
        let sorted = sorted(vec![
            genesis("01A"),
            event("01B", Some("01A"), "x"),
            event("01D", Some("01A"), "x"),
            event("01C", Some("01B"), "x"),
        ]);

        assert_eq!(ids(&sorted), ["01A", "01B", "01C", "01D"]);
    }

    #[test]
    fn appends_dangling_events_by_id() {
        let sorted = sorted(vec![
            event("01C", Some("missing"), "x"),
            genesis("01A"),
            event("01B", Some("missing"), "x"),
        ]);

        assert_eq!(ids(&sorted), ["01A", "01B", "01C"]);
    }

    #[test]
    fn orders_siblings_and_ties_by_code_unit() {
        let mut tie_lower = event("c1", Some("01A"), "x");
        tie_lower.user_name = "a".into();
        let mut tie_upper = event("c1", Some("01A"), "x");
        tie_upper.user_name = "B".into();

        let sorted = sorted(vec![
            genesis("01A"),
            event("b1", Some("01A"), "x"),
            event("A1", Some("01A"), "x"),
            event("a1", Some("01A"), "x"),
            event("B1", Some("01A"), "x"),
            tie_lower,
            tie_upper,
        ]);

        assert_eq!(ids(&sorted), ["01A", "A1", "B1", "a1", "b1", "c1"]);
        assert_eq!(sorted.last().unwrap().user_name, "B");
    }

    #[test]
    fn orders_two_events_sharing_an_id_the_same_way_whatever_the_input_order() {
        let first = event("01B", Some("01A"), "edit.title");
        let mut second = event("01B", Some("01A"), "edit.title");
        second.user_name = "Other".into();

        let one_way = sorted(vec![genesis("01A"), first.clone(), second.clone()]);
        let other_way = sorted(vec![genesis("01A"), second, first]);

        assert_eq!(one_way, other_way);
        assert_eq!(one_way.len(), 2);
    }

    #[test]
    fn anchors_a_forged_second_root_after_history() {
        let sorted = sorted(vec![
            event("00Z", None, "edit.title"),
            genesis("01A"),
            event("01B", Some("01A"), "x"),
        ]);

        assert_eq!(ids(&sorted), ["01A", "01B", "00Z"]);
    }

    #[test]
    fn anchors_a_root_that_smuggles_a_genesis_key_after_history_too() {
        let mut forged = event("00Z", None, GENESIS);
        forged.rest.push(("evil".into(), raw_json("{}")));

        let sorted = sorted(vec![forged, genesis("01A"), event("01B", Some("01A"), "x")]);

        assert_eq!(ids(&sorted), ["01A", "01B", "00Z"]);
    }

    #[test]
    fn places_a_cycle_after_everything_else() {
        let sorted = sorted(vec![
            event("01Y", Some("01Z"), "x"),
            event("01Z", Some("01Y"), "x"),
            genesis("01A"),
        ]);

        assert_eq!(ids(&sorted), ["01A", "01Y", "01Z"]);
    }

    #[test]
    fn orders_a_chain_far_longer_than_a_call_stack() {
        let mut events = vec![genesis("E0000000")];

        for index in 1..200_000 {
            events.push(event(
                &format!("E{index:07}"),
                Some(&format!("E{:07}", index - 1)),
                "x",
            ));
        }

        events.reverse();
        let sorted = sorted(events);

        assert_eq!(sorted.len(), 200_000);
        assert_eq!(sorted[0].id, "E0000000");
        assert_eq!(sorted[199_999].id, "E0199999");
    }

    #[test]
    fn is_a_function_of_the_set_alone() {
        let base = vec![
            genesis("01A"),
            event("01B", Some("01A"), "x"),
            event("01C", Some("01A"), "x"),
            event("01D", Some("01C"), "x"),
            event("01E", Some("nope"), "x"),
            event("01F", None, "x"),
            event("01G", Some("01H"), "x"),
            event("01H", Some("01G"), "x"),
        ];

        let expected = sorted(base.clone());

        // Every rotation and the reverse: a cheap stand-in for every permutation.
        for shift in 0..base.len() {
            let mut rotated = base.clone();
            rotated.rotate_left(shift);
            assert_eq!(sorted(rotated), expected, "rotation {shift}");
        }

        let mut reversed = base;
        reversed.reverse();
        assert_eq!(sorted(reversed), expected);
    }
}
