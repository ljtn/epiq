---
name: epiq
description: Workflow rules for working the epiq issue board — use the epiq MCP, sync on demand, scope tickets small, keep status/tags accurate, and communicate via comments.
---

# Epiq board workflow

- **Use the epiq MCP tools** (`epiq_*`) for all board operations — never the `epiq` CLI or hand-edited state files.
- **Sync is on-demand only.** MCP reads/writes operate on local state and never pull/push automatically. Call `epiq_sync` explicitly when you need the latest remote state or want to publish local changes.
- **Break work into small, scoped tickets.** One ticket per independent unit of work, not one giant ticket for a whole feature/epic. Small tickets move through the board cleanly and are easier to review.
- **Keep the status column current as work progresses**
- **Tag tickets properly.** Reuse existing tags where they fit (check current issues/tags first) instead of inventing near-duplicates.
- **Use comments to communicate deviations.** If the work diverges from what the ticket describes — scope changes, findings, blockers, test results — record it as a comment on the ticket, not just in chat.
- **Be concise.** Titles, descriptions, and comments should be scannable, not essays.
