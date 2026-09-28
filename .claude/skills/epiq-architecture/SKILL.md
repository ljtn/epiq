---
name: epiq-architecture
description: How epiq is built — the event log's distributed rules (causal ordering, logical clocks, tombstones, total replay), the code's layers, and the workflow for this repository. Read before any change here, especially to events, ordering, merge, replay, materialization or sync, a new event type or websocket message, or anything that crosses layers.
---

# The event log is a CRDT

No server, no shared clock. Each actor appends to **its own** JSONL log on the state branch, git merges them, and every machine derives the same board from the same set. Everything below keeps that derivation a pure function of the event _set_.

## The model

- **`id = [ulid, refId]`.** `refId` is the causal parent: the tail of the order this actor last saw (`getEdgeRef`). Concurrent writers may share a parent.
- **Order is derived, never stored.** `getSortedEvents` builds the forest from `refId`, sorts siblings by ULID, walks depth-first, dedupes by id. File line order means nothing.
- **The ULID is a hybrid logical clock:** `getNextId(Math.max(Date.now(), decodeTime(edge) + 1))`. Wall clock is only a lower bound.
- **An event names its actor by id only.** `persist` calls `stripActor`; `AppEvent` has no name. Spread `actorOf(user)`, never the configured identity — TypeScript does not excess-check a spread. The id comes from the log file name `<id>.jsonl`; the name from the contributor registry, built by `create.contributor` / `rename.contributor` / `tombstone.contributor` / `restore.contributor`.
- Same event set ⇒ same order ⇒ same board.

## Invariants

- **Order = `refId` + ULID tiebreak.** Nothing else.
- **Ids are permanent; tombstone instead.** `tombstoneNode` marks the node and its descendants `isDeleted`; `tombstoneContributor` clears the name but keeps the record so assignments still resolve.
- **Replay is total.** An event that lost a race, or names state this replay never applied, is a `materializeSkip` (`ConvergenceFail`) and skipped. The same precondition on a live write is a real failure — there it is the answer the caller asked for.
- **Unreadable stays ordered.** The envelope (`v`, `id`) parses even when the payload doesn't, so a newer build's event keeps its place.
- **Append only.** One id, one byte sequence — what makes `*.jsonl merge=union` safe.
- **Time travel cuts causally.** `splitEventsAtTime` leaves a child unapplied when its parent is, whatever its timestamp.

## Never

- **Break a client already out there.** The format grows by adding (new event type, field nothing older must read), never by changing or repurposing what an older build reads. Most rules below follow from this one. A version marker can't help retroactively: an older build can't check for something it shipped without.
- **Change the log file name grammar without a release between reader and writer.** It has no additive form — every client reads every other client's logs, so there is no second name to add — and an old build misreads a name rather than failing. The `<id>.<name>.jsonl` → `<id>.jsonl` move was safe only because the reader shipped a release earlier. `old-log-file-names.test.ts` pins both `<id>.<name>.jsonl` and `<id>.jsonl`.
- **Order or resolve conflicts by wall clock.** `Date.now()` is an id lower bound and a display value only.
- **Mint an id without seeding past the current edge** — it would sort before its parent. Exception: a damaged edge (undecodable, at ULID's ceiling, or over a day ahead) seeds from the wall clock (`seedFromEdgeRef`); order still comes from `refId`.
- **Hard-delete** a node, contributor, tag or event, or reuse or rewrite an id — replay would reach a reference that no longer exists.
- **Rewrite, reorder or de-duplicate log lines** — union merge depends on their identity.
- **Abort replay on an event that merely lost** — one concurrent edit would leave a board that never opens again for whoever's build understands the most.
- **Assume a single writer.** Any log can gain lines between two reads, even mid-sync.
- **Put actor identity, or anything derivable, in the payload.**
- **Read a display name off an event or a log file name.** Resolve it by id through `identityOf`. The name segment in an old `<id>.<name>.jsonl` is a sanitized storage key — lowercased, `/` and `.` mangled — only a fallback for authors the registry lacks (`loadActorNames`).
- **Store a name beside an id** — a copy freezes at the old name and never sees a rename. That is why `userName` left `AppEvent` and `authorName` left comments.
- **Add a payload field older clients must interpret** without a `SCHEMA_VERSION` story.

## Adding an event type

It is applied on every machine, in causal order, possibly after events it didn't expect: make it idempotent, express preconditions as `materializeSkip` rather than fatal, and reference targets by id only. Four places in `lib/board/`: `AppEventMap` + `EVENT_ACTIONS` (`board-events.model.ts`), the payload schema (`board-events.schema.ts`), the handler (`board-materialize.ts`), and `getAffectedNodeIds` (`board-replay.ts`). `lib/event/` doesn't change; it reads the action list and handlers off the catalog.

## Proving a change is safe

- `source/test/replay-equivalence.test.ts` — batched replay equals per-event replay.
- `source/test/event-core-generic.test.ts` — the log still works for a non-board product.
- `npm run test:collab` — several actors on one remote end with the same events and order.
- Touching ordering, merge, replay or materialization means running all three.
- The pre-push hook runs lint, typecheck, unit, e2e, collaboration and GUI tests. Do not bypass it.
- Git-driving suites run containerised over a read-only checkout; a test that aims git at the checkout instead of a temp dir fails.

## The layers

Dependencies point down only.

- **`source/lib/event/`** — the log, generic over an `EventMap`: ids and edge, causal sort, envelope, pending log, replay guards, write path. A product passes `createEventLog` an `EventCatalog`: its genesis action, action list, payload check, a handler per action, and replay/write hooks. **No board vocabulary here**, in code or comments; `event-core-generic.test.ts` imports no board code.
- **`source/lib/board/`** — the board as that product: event map, schemas, handlers, replay, boot. `board-log.ts` is its one `createEventLog` instance and what everything else imports (`materialize`, `loadMergedEvents`, `materializeAndPersistAll`, …); nothing outside `lib/board/` reaches into `lib/event/`.
- **Rest of `source/lib/`** — node repository, ranks, state, the TUI. No MCP, HTTP or React — which is what lets the same code serve all three.
- **`source/mcp/api/`** — one function per board operation (`createBoard`, `moveIssue`, `addIssueTag`): boots, checks preconditions, writes events, returns a `Result`. Mutations live here only.
- **`source/mcp/server.ts`, `source/gui/api/`** — front doors into the same `mcp/api` functions. A guard in only one door is a bug in the other.
- **`source/gui/client/`** — React only; importing Node-side code (`lib/event`, `lib/board`, …) breaks the GUI build.

Across all layers:

- **Errors are returned, never thrown** — `failed()` / `succeeded()` / `isFail` up to the front door.
- **A `lib/` change lands in TUI, MCP and GUI at once**; check all three.
- The one upward reach, `lib/state/sync-state.ts` → `gui/client/lib/gui-broadcast.js`, is a wart, not a pattern.

## One module per concept

- **A capability is a vertical slice**, not a shortcut: GUI board creation is `createBoard` in `mcp/api/boards.ts`, a `board:create` message, a hook, a palette entry.
- **Name a module after its concept** (`use-swimlane-editing.ts`, `use-board-creation.ts`, `commands/command-registry.ts`).
- **State lives where it is drawn**; a module answers its question for every caller (`needsWrite` in the command registry).
- **A few domain modules of a few hundred lines**, not a file per fragment; the entry file stays an overview.
- **Keep the domain a value, not a React tree** — the command registry takes injected handlers and tests without a DOM.

What this prevents has happened here: App.tsx at 1900 lines passing 27 hook return values down as props, and one nine-line boot/actor/state preamble repeated at 21 `mcp/api` call sites.

### Adding a websocket message

Five places; a missed one fails quietly:

- `gui/api/lib/websocket.model.ts` — the type
- `gui/api/lib/websocket.schema.ts` — the zod shape; unlisted messages are refused
- `gui/client/lib/gui-mutations.ts` — if it mutates, so the client holds broadcasts until its reply lands
- `gui/api/lib/websocket.ts` — the handler; calls `mcp/api`, nothing else
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
- **Check `git log --format='%an%n%b'` before pushing** — a template's trailer survives a rebase.
