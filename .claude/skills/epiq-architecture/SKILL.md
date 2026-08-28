---
name: epiq-architecture
description: The distributed rules epiq's event log obeys — causal ordering by last-known edge, logical clocks, tombstones, total replay. Read before touching events, ordering, merge, replay, materialization, sync, or before adding an event type.
---

# The event log is a CRDT

There is no server and no shared clock. Every actor appends to **its own** JSONL log on the state branch, git merges them, and each machine derives the same board from the same set. Everything below exists to keep that derivation a pure function of the event *set*.

## The model

- **`id = [ulid, refId]`.** `refId` is the causal parent: the tail of the causal order this actor last saw (`getEdgeRef`). Concurrent writers legitimately share a parent.
- **Order is derived, never stored.** `getSortedEvents` rebuilds the forest from `refId`, sorts concurrent siblings by ULID, walks depth-first, and dedupes by id. File line order is not load-bearing.
- **The ULID is a hybrid logical clock**, not a timestamp: `getNextId(Math.max(Date.now(), decodeTime(edge) + 1))`. The wall clock is only a lower bound; causality forces monotonicity.
- **Actor identity is the file name**, not the payload — `persist` calls `stripActor`.
- Same event set ⇒ same order ⇒ same board. That is the whole contract.

## Invariants

- **Derive order from `refId` plus the ULID tiebreak.** Nothing else.
- **Ids are permanent.** Tombstone instead: `tombstoneNode` marks the node *and its descendants* `isDeleted`; `tombstoneContributor` clears the display name but keeps the record so assignments referencing the id still resolve.
- **Replay is total.** An event that lost a race or names state this replay never applied is a `materializeSkip` (`ConvergenceFail`) and is skipped. The *same* precondition on a live write is a genuine failure — there the precondition is the answer the caller asked for.
- **Unreadable stays ordered.** The envelope (`v`, `id`) parses even when the payload cannot, so an event from a newer build keeps its place in the chain.
- **Append only.** One id always means one byte sequence. This is what makes `*.jsonl merge=union` safe.
- **Time travel cuts causally.** `splitEventsAtTime` marks a child unapplied when its parent is unapplied, whatever its own timestamp says.

## Never

- **Never order, compare or resolve conflicts by wall clock.** No "latest write wins by timestamp". `Date.now()` is a lower bound for id generation and a display value; it is not a fact about ordering.
- **Never mint an id without seeding past the current edge.** An id that sorts before its own parent corrupts the DAG.
- **Never hard-delete** a node, contributor, tag or event, and never reuse or rewrite an id. Replay would then reach a reference that no longer exists.
- **Never rewrite, reorder or de-duplicate existing log lines.** Rewriting breaks the identity that union merge depends on.
- **Never abort replay on an event that merely lost.** One concurrent edit would leave a board that never opens again for whoever's build understands the most.
- **Never assume a single writer.** Any log can gain lines from another machine between two reads, including mid-sync.
- **Never put actor identity, or anything derivable, into the payload.**
- **Never add a payload field older clients must interpret** without a `SCHEMA_VERSION` story.

## Adding an event type

Applied on every machine, in causal order, possibly after events it did not expect. So: make it idempotent, express preconditions as `materializeSkip` rather than fatal, and reference targets by id only.

## Where the rules live

| Concern | Code |
| --- | --- |
| Edge capture, id generation, `SCHEMA_VERSION` | `source/lib/event/event-persist.ts` |
| Ordering, causal cut | `source/lib/event/event-load.ts` (`getSortedEvents`, `splitEventsAtTime`) |
| Skip-vs-fail, replay batching | `source/lib/event/event-materialize.ts` |
| Tombstones | `source/lib/repository/node-repo.ts` |
| Union merge attribute | `source/git/git-storage.ts` |

## Proving a change is safe

- `source/test/replay-equivalence.test.ts` — a batched replay must land on exactly the state a per-event replay does.
- `npm run test:collab` — several actors on one remote must end with the same events *and* derive the same order from them.

Touching ordering, merge, replay or materialization means running both.
