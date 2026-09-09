---
name: epiq-architecture
description: How epiq is built — the distributed rules its event log obeys (causal ordering by last-known edge, logical clocks, tombstones, total replay), and the layers the code is arranged in. Read before touching events, ordering, merge, replay, materialization or sync, before adding an event type or a websocket message, and before adding a module, a hook or a capability that crosses layers.
---

# The event log is a CRDT

There is no server and no shared clock. Every actor appends to **its own** JSONL log on the state branch, git merges them, and each machine derives the same board from the same set. Everything below exists to keep that derivation a pure function of the event _set_.

## The model

- **`id = [ulid, refId]`.** `refId` is the causal parent: the tail of the causal order this actor last saw (`getEdgeRef`). Concurrent writers legitimately share a parent.
- **Order is derived, never stored.** `getSortedEvents` rebuilds the forest from `refId`, sorts concurrent siblings by ULID, walks depth-first, and dedupes by id. File line order is not load-bearing.
- **The ULID is a hybrid logical clock**, not a timestamp: `getNextId(Math.max(Date.now(), decodeTime(edge) + 1))`. The wall clock is only a lower bound; causality forces monotonicity.
- **Actor id comes from the file name; the display name does not.** `persist` calls `stripActor`, so the payload carries neither. The id is parsed from the log's file name; the _name_ is resolved from the contributor registry, which `create.contributor` / `rename.contributor` build. The name segment in the file name is a sanitized storage key, not a name of record.
- Same event set ⇒ same order ⇒ same board. That is the whole contract.

## Invariants

- **Derive order from `refId` plus the ULID tiebreak.** Nothing else.
- **Ids are permanent.** Tombstone instead: `tombstoneNode` marks the node _and its descendants_ `isDeleted`; `tombstoneContributor` clears the display name but keeps the record so assignments referencing the id still resolve.
- **Replay is total.** An event that lost a race or names state this replay never applied is a `materializeSkip` (`ConvergenceFail`) and is skipped. The _same_ precondition on a live write is a genuine failure — there the precondition is the answer the caller asked for.
- **Unreadable stays ordered.** The envelope (`v`, `id`) parses even when the payload cannot, so an event from a newer build keeps its place in the chain.
- **Append only.** One id always means one byte sequence. This is what makes `*.jsonl merge=union` safe.
- **Time travel cuts causally.** `splitEventsAtTime` marks a child unapplied when its parent is unapplied, whatever its own timestamp says.

## Never

- **Never order, compare or resolve conflicts by wall clock.** No "latest write wins by timestamp". `Date.now()` is a lower bound for id generation and a display value; it is not a fact about ordering.
- **Never mint an id without seeding past the current edge.** An id that sorts before its own parent corrupts the DAG. Exception: an edge that is itself damage — undecodable, at ULID's ceiling, or more than a day ahead of the wall clock — seeds from the wall clock instead (`seedFromEdgeRef`); ordering survives because it comes from `refId`, not the timestamp.
- **Never hard-delete** a node, contributor, tag or event, and never reuse or rewrite an id. Replay would then reach a reference that no longer exists.
- **Never rewrite, reorder or de-duplicate existing log lines.** Rewriting breaks the identity that union merge depends on.
- **Never abort replay on an event that merely lost.** One concurrent edit would leave a board that never opens again for whoever's build understands the most.
- **Never assume a single writer.** Any log can gain lines from another machine between two reads, including mid-sync.
- **Never put actor identity, or anything derivable, into the payload.**
- **Never read a display name off a log file name.** It is sanitized and may be stale — a rename starts a new file rather than changing old ones. Resolve names through the registry, by id.
- **Never add a payload field older clients must interpret** without a `SCHEMA_VERSION` story.

## Adding an event type

Applied on every machine, in causal order, possibly after events it did not expect. So: make it idempotent, express preconditions as `materializeSkip` rather than fatal, and reference targets by id only.

## Proving a change is safe

- `source/test/replay-equivalence.test.ts` — a batched replay must land on exactly the state a per-event replay does.
- `npm run test:collab` — several actors on one remote must end with the same events _and_ derive the same order from them.
- The pre-push hook runs lint, typecheck, unit, e2e, collaboration and GUI tests. Do not bypass it.
- Suites that shell out to git run containerised over a read-only checkout. A test that aims git at the checkout instead of a temp directory fails on the spot.

Touching ordering, merge, replay or materialization means running both.


## The layers

Dependencies point one way, and nothing lower reaches up.

- **`source/lib/`** — the domain. The event log, the node repository, ranks, state, and the TUI that draws it. Knows nothing about MCP, HTTP or React, which is what lets the same code answer all three.
- **`source/mcp/api/`** — one function per board operation: `createBoard`, `moveIssue`, `addIssueTag`. Boots, checks its preconditions, writes events, returns a `Result`. A mutation lives here and only here.
- **`source/mcp/server.ts` and `source/gui/api/`** — the front doors. An MCP tool and a websocket message are two ways into the *same* `mcp/api` function; neither re-implements one. A guard that exists in only one door is a bug in the other.
- **`source/gui/client/`** — React, and nothing else. It cannot import `source/lib/event/*` or anything else Node-side; the GUI build fails on it.

Two rules that hold across all of them:

- **Errors are returned, never thrown** — `failed()` / `succeeded()` and `isFail`, up to the front door, which turns the `Result` into a tool response or a socket frame.
- **A change in `lib/` lands in the TUI, the MCP and the GUI at once.** Check all three before calling it done.

The one inversion is `lib/state/sync-state.ts` reaching up into `gui/client/lib/gui-broadcast.js` to push a sync status. It is a wart to work around, not a pattern to copy.

## Modular per concept, not per fragment

The layering above is what exists; following it is the cheapest thing you can do for the next reader. What gets *added* has to keep it legible, and that means one module owning one high-level concept — a domain, a question, a screen's worth of state — rather than a slice of several.

- **A capability is a vertical slice through the layers, never a shortcut across them.** Creating a board from the GUI is `createBoard` in `mcp/api/boards.ts`, a `board:create` message, a hook, and a palette entry: four small additions in four layers, not one socket handler that writes an event itself.
- **Name a module after its concept, so somebody can guess the file.** `use-swimlane-editing.ts` owns the column editors, `use-board-creation.ts` the new-board modal, `commands/command-registry.ts` what the palette offers.
- **State lives where it is drawn**, and a module that owns a question answers it for every caller — reuse the rule rather than restating it. `needsWrite` in the command registry is written once and used by every command that mutates.
- **A few domain modules of a few hundred lines beat a file per fragment.** The entry file stays a brief overview of the flow.
- **Keep the domain a value, not a React tree.** The command registry is built from injected handlers, so a test constructs the whole thing with no DOM.

What the rule prevents is already on the board: `HZCA9EG` — App.tsx at 1900 lines, handing 27 hook return values down as props — and `XCNBCDB` — the same nine-line boot/actor/state preamble repeated at 21 `mcp/api` call sites. Both are what adding to a layer without giving the addition a home costs later.

### Adding a websocket message

Five places. Miss one and it fails quietly rather than loudly:

- `gui/api/lib/websocket.model.ts` — the type
- `gui/api/lib/websocket.schema.ts` — the zod shape; an unlisted message is refused at the door
- `gui/client/lib/gui-mutations.ts` — if it mutates, so the client holds broadcasts until its own reply lands
- `gui/api/lib/websocket.ts` — the handler, which calls `mcp/api` and does nothing else
- `mcp/epiq-api.ts` — the export, when the function is new

## Workflow
- Make branch in worktree
- Make changes
- Review your work
- Address findings
- On green light - merge via rebase
- Squash commits only if they are trivial and share the same ticket ref prefix. Otherwise, keep them separate for history and bisectability.
