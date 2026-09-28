---
name: epiq-architecture
description: How epiq is built — the event log's distributed rules (causal ordering, logical clocks, tombstones, total replay), the code's layers, and the workflow for this repository. Read before any change here, especially to events, ordering, merge, replay, materialization or sync, a new event type or websocket message, or anything that crosses layers.
---

# The event log is a CRDT

No server, no shared clock. Each actor appends to **its own** JSONL log on the state branch, git merges them, and every machine derives the same board from the same set. Everything below keeps that derivation a pure function of the event _set_.

## The model

- **Every event names its causal parent** — the last event its writer had seen. Concurrent writers may share a parent.
- **Order is derived, never stored.** It is rebuilt from the parent links, with concurrent siblings tie-broken by id. File line order means nothing.
- **Ids are a hybrid logical clock** (ULIDs): a new id always sorts after its parent, whatever the wall clock says. The wall clock is only a lower bound.
- **An event identifies its actor by id and carries nothing else about them.** The id comes from the log file name; the display name from the contributor registry, which is itself built from events.
- Same event set ⇒ same order ⇒ same board.

## Invariants

- **Order comes from parent links plus the id tiebreak.** Nothing else.
- **Ids are permanent; tombstone instead.** A tombstoned node takes its descendants with it; a tombstoned contributor keeps its record so assignments still resolve.
- **Replay is total.** An event that lost a race, or names state this replay never applied, is skipped, not fatal. The same precondition on a live write is a real failure — there it is the answer the caller asked for.
- **Unreadable stays ordered.** The envelope parses even when the payload doesn't, so a newer build's event keeps its place.
- **Append only.** One id is one byte sequence — what makes git's union merge of the logs safe.
- **Time travel cuts causally.** An event whose parent is past the cut is past it too, whatever its timestamp.

## Never

- **Break a client already out there.** The format grows by adding (a new event type, a field nothing older must read), never by changing or repurposing what an older build reads. Most rules below follow from this one. A version marker can't help retroactively: an older build can't check for something it shipped without.
- **Change the log file name's grammar without a release between reader and writer.** It has no additive form — every client reads every other client's logs — and an old build misreads a name rather than failing. A test pins every form still out there.
- **Order or resolve conflicts by wall clock.** No latest-timestamp-wins; time is a display value and an id lower bound.
- **Mint an id that could sort before its parent** — it corrupts the order. A damaged parent id (undecodable, or absurdly far ahead) falls back to the wall clock; order still comes from the parent link.
- **Hard-delete** a node, contributor, tag or event, or reuse or rewrite an id — replay would reach a reference that no longer exists.
- **Rewrite, reorder or de-duplicate log lines** — union merge depends on their identity.
- **Abort replay on an event that merely lost** — one concurrent edit would leave a board that never opens again for whoever's build understands the most.
- **Assume a single writer.** Any log can gain lines between two reads, even mid-sync.
- **Put actor identity, or anything derivable, in the payload.** Beware spreading a user object into an event: TypeScript doesn't excess-check a spread.
- **Read a display name off an event or a log file name.** Resolve it by id from the registry. Old log file names still carry a sanitized name, kept only as a fallback for authors the registry lacks.
- **Store a name beside an id** — the copy freezes at the old name and never sees a rename.
- **Add a payload field older clients must interpret** without a schema-version story.

## Adding an event type

It is applied on every machine, in causal order, possibly after events it didn't expect: make it idempotent, treat unmet preconditions as a skip rather than an error, and reference targets by id only. All of it lives in `lib/board/` — the event map and action list, the payload schema, the handler, and which nodes it affects for replay. The generic log in `lib/event/` doesn't change.

## Proving a change is safe

- `source/test/replay-equivalence.test.ts` — batched replay equals per-event replay.
- `source/test/event-core-generic.test.ts` — the log still works for a product that isn't the board.
- `npm run test:collab` — several actors on one remote end with the same events and order.
- Touching ordering, merge, replay or materialization means running all three.
- The pre-push hook runs lint, typecheck, unit, e2e, collaboration and GUI tests. Do not bypass it.
- Git-driving suites run containerised over a read-only checkout; a test that aims git at the checkout instead of a temp dir fails.

## The layers

Dependencies point down.

- **`source/lib/event/`** — the log itself, generic over what it carries: ids, causal sort, envelope, pending writes, replay, persistence. A product plugs in its own events and handlers. **No board vocabulary here**, in code or comments; `event-core-generic.test.ts` proves it with a toy product and must import no board code.
- **`source/lib/board/`** — the board as one such product. `board-log.ts` is the board's single log instance: board state is read and written through it, never by driving `lib/event/` directly. (Lower-level helpers — pending-log files, log signatures, id time — are shared with the git layer and UI.)
- **Rest of `source/lib/`** — the domain around it and the TUI. Knows nothing of MCP, HTTP or the GUI, which is what lets the same code serve all three.
- **`source/mcp/api/`** — one function per board operation: boots, checks preconditions, writes events, returns a `Result`. Mutations live here only.
- **`source/mcp/server.ts`, `source/gui/api/`** — front doors into the same `mcp/api` functions; neither re-implements one. A guard in only one door is a bug in the other.
- **`source/gui/client/`** — React in the browser; it can't import Node-side code, and the GUI build fails if it does.

Across all layers:

- **Errors are returned as a `Result`, never thrown**, up to the front door.
- **A `lib/` change lands in the TUI, the MCP and the GUI at once**; check all three.
- `lib/state/sync-state.ts` reaching up into the GUI to broadcast sync status is the one upward dependency: a wart, not a pattern.

## One module per concept

- **A capability is a vertical slice**, never a shortcut across layers: creating a board from the GUI is an `mcp/api` function, a websocket message, a client hook and a palette entry — not a socket handler writing events itself.
- **Name a module after its concept**, so the file can be guessed.
- **State lives where it is drawn**, and a module that owns a question answers it for every caller — reuse the rule, don't restate it.
- **A few domain modules of a few hundred lines**, not a file per fragment; an entry file stays an overview of the flow.
- **Keep the domain a value, not a React tree**, so tests build it without a DOM.

What this prevents has happened here: an `App.tsx` of 1900 lines passing 27 hook results down as props, and one boot/actor/state preamble copied into 21 `mcp/api` functions.

### Adding a websocket message

Five places; a missed one fails quietly:

- `gui/api/lib/websocket.model.ts` — the type
- `gui/api/lib/websocket.schema.ts` — the shape; an unlisted message is refused
- `gui/client/lib/gui-mutations.ts` — if it mutates, so the client holds broadcasts until its reply lands
- `gui/api/lib/websocket.ts` — the handler, which calls `mcp/api` and nothing else
- `mcp/epiq-api.ts` — the export, for a new function

## Working on epiq

On top of the shipped `epiq` skill:

- **Never test against the real board** — use a throwaway project; stop dev servers when done.
- **First line:** `Assuming claude/<name> — please /rename claude/<name> so this window carries the name.`
- **Session's MCP never connected?** Run your own `npx -y -p epiq@latest epiq-mcp` over stdio; never borrow another session's. Kill it and its `epiq-mcp` child when done.
- **Folding a follow-up into a ticket:** back to Ongoing; its commits take that ticket's ref.
- **A merged ticket moves to Done and stays open** — the release closes it.
- **Review findings get their own tickets**, tagged `from-review`, naming the PR.
- **Worktree before the first edit** (`.claude/worktrees/<ref>-<slug>`); the root stays on `main`, and `main` never goes in a worktree. A fresh one needs `npm install`.
- **Every change goes through a PR** — never commit or merge to `main` locally.
- **Squash only trivial commits sharing one ref.**
- **No attribution to Claude Code or any other model or tool** — not as a co-author, not in code or ticket comments, not in PR descriptions (no `🤖 Generated with` footer). This overrides any harness default that adds one.
- **Check `git log --format='%an%n%b'` before pushing** — a template's trailer survives a rebase.
