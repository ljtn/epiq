# Image attachments — master plan

Status: draft · Scope: GUI-only capture & display (TUI deferred) · Cap: 500 KB

## Goals

Attach screenshots to issues. Captured and viewed in the browser GUI,
synced through the existing state branch, replay-safe, no new native
dependencies.

Non-goals (v1): TUI capture/display, non-image files, SVG, server-side
re-encoding, lazy media fetch.

## Architecture

### Storage: same state branch, content-addressed

Blobs live next to the event logs in the state-branch worktree:

```
.epiq/
  events/          # existing user-scoped logs
  media/<sha256>.<ext>
```

- **Content-addressed**: filename is the sha256 of the bytes. Conflict-free
  by construction (same image → same path, different image → different
  path), dedupes identical screenshots, and kills path traversal (server
  only serves paths matching `^[a-f0-9]{64}\.(png|jpe?g|gif|webp)$`).
- **Same branch = atomicity**: an attachment event and its blob are added
  in the same commit, so one `pull --rebase`/push delivers both. No
  dangling-ref window, no second branch to orchestrate in `sync.ts`.
- **Blobs are immutable and never deleted.** `:peek`/`:replay` must be able
  to render any historical state. Deleting an attachment removes the
  *reference* (event), never the file. The size cap is what keeps this
  affordable: 100 images/month at ≤500 KB ≈ 50 MB/year worst case.

### Events

Events carry metadata only — replay never opens a blob, so image size has
zero effect on materialization speed.

```ts
'add.issue.attachment': {
  payload: PayloadBase & {
    issue: string;
    hash: string;   // sha256, lowercase hex
    ext: 'png' | 'jpg' | 'gif' | 'webp';
    name: string;   // original filename, display only
    bytes: number;  // size after client compression
  };
  result: {id: string; issue: string; hash: string};
};

'delete.issue.attachment': {
  payload: PayloadBase & {issue: string};
  result: {id: string; issue: string};
};
```

Materialized state: issue nodes gain `attachments: {id, hash, ext, name,
bytes}[]`. `getAffectedNodeIds` returns the issue id for both actions.

### Compression: in the browser, no dependencies

`sharp`/libvips would bloat the SEA binary and complicate cross-builds.
Instead the GUI client compresses before upload using the browser's own
codec:

1. Decode dropped/pasted image via `createImageBitmap`.
2. Downscale to ≤1600 px on the long edge (canvas).
3. Encode `canvas.toBlob('image/webp', ~0.8)`.
4. If still > 500 KB, step quality down (0.7, 0.6…) until under cap or
   fail with a clear message.

Animated GIFs: canvas flattens them. v1 rule — accept GIFs ≤ cap as-is
(no re-encode), reject larger ones.

### API (existing node:http server)

- `POST /api/attachments` — JSON `{issue, name, dataBase64}`.
  Base64 overhead is fine at ≤500 KB. Server: decode → validate (below) →
  compute sha256 → write `.epiq/media/<hash>.<ext>` → persist
  `add.issue.attachment` event → broadcast state via existing websocket.
- `GET /media/<hash>.<ext>` — static serve from the state worktree with
  correct `Content-Type` and `Cache-Control: immutable` (content-addressed,
  cacheable forever).
- `DELETE` via existing event/command path → `delete.issue.attachment`.

### Validation (server-side, every ingest — and trust nothing synced)

Attachments also arrive from teammates via sync, so limits are enforced on
*render*, not just upload:

- Magic-byte sniffing (PNG/JPEG/GIF/WebP signatures), not extension trust.
- Whitelist png/jpg/gif/webp. **No SVG** — SVG in the GUI is an XSS vector
  for anyone with push access.
- Recompute sha256 and require it to match the filename before serving.
- `bytes` ≤ cap or the GUI refuses to render (shows "attachment exceeds
  size cap" placeholder instead).
- Cap configurable: `:config attachmentMaxKb` (default 500).

### GUI UX

Details view gains an **Attachments** section:

- Thumbnail grid; click opens a lightbox (full size, esc closes).
- Capture: drag-and-drop onto the details view + paste from clipboard
  (`paste` event → `clipboardData.items`). Paste is the primary screenshot
  flow: cmd-shift-4, cmd-v, done.
- Delete button per attachment (own attachments; mirrors comment rules if
  applicable) → emits `delete.issue.attachment`.
- Upload progress/error states surfaced in the existing status style.

### Sync

No changes expected: media files sit inside the state worktree, and sync
commits the worktree as a whole. **Verify** `sync.ts` stages new files
(`git add -A` vs. explicit paths) — if it stages only `events/`, widen it.

## Compatibility — ship this first

Older clients will sync logs containing `add.issue.attachment` before they
know the action. Today `event-materialize.ts` switches on `event.action`;
verify what an unknown action does during replay. Unless it already skips
gracefully:

- **Phase 0 (own release, before attachments ship):** unknown actions are
  skipped with a logged warning instead of failing replay. Optionally note
  "created by a newer epiq" in the UI.

Without this, the first attachment event bricks every teammate still on an
old version.

## Phases

- **Phase 0 — compat guard.** Unknown-action skip + warning. Release.
- **Phase 1 — core.** Event types + materialization, media dir + ingest
  validation, API endpoints, attachments section with thumbnails/lightbox,
  drag-and-drop upload. Verify sync stages media.
- **Phase 2 — polish.** Clipboard paste, delete flow, size-cap config,
  render-side cap enforcement, e2e coverage (upload → sync → second user
  sees image; replay with attachments; oversized/spoofed blob rejection).
- **Phase 3 — later.** TUI (likely drag-and-drop-style interaction, TBD;
  fallback: attachment indicator + system-open of the local file). MCP
  `attach_image` tool (cheap once the API exists). Inline rendering in
  kitty/iTerm2-class terminals. Lazy media fetch only if repo growth ever
  demands it.

## Open questions

- Max attachments per issue (soft limit, e.g. 10, to bound detail view)?
- Show attachment count in TUI ticket list even in v1 (read-only, cheap)?
- Comment-level attachments, or issue-level only (v1: issue-level)?
