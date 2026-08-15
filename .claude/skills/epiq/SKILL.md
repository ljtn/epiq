---
name: epiq
description: Workflow rules for working the epiq issue board — use the epiq MCP, sync on demand, scope tickets small, keep status/tags accurate, and communicate via comments.
---

# Epiq board workflow

- **Use the epiq MCP tools** (`epiq_*`) for all board operations — never the `epiq` CLI or hand-edited state files.
- **Never edit the state branch directly.** Don't check it out, don't write to its worktree, don't touch the event log or any file under it by hand or by script — go through the MCP for every read and write. The event log is the system of record: an edit made outside it bypasses validation and ordering, and can corrupt history in ways no later fix can undo.
- **Sync is on-demand only.** MCP reads/writes operate on local state and never pull/push automatically. Call `epiq_sync` explicitly when you need the latest remote state or want to publish local changes.
- **Break work into small, scoped tickets.** One ticket per independent unit of work, not one giant ticket for a whole feature/epic. Small tickets move through the board cleanly and are easier to review.
- **Keep the status column current as work progresses**
- **Assign the ticket to yourself when you pick it up**, alongside moving it to Ongoing — so the board shows who is on what, not just what is in flight.
- **Prefix commits with the ticket ref. **Retrieve the ref programmatically, never derive it.\*\* Read the `ref` field off the MCP response (`epiq_issue_list` and `epiq_board_list` include it on every entry). This is what link-by-reference feature will match on. Copy the ref verbatim from the tool response — nothing validates a commit prefix, so a wrong one fails silently.
- **Tag tickets properly.** Reuse existing tags where they fit (check current issues/tags first) instead of inventing near-duplicates.
- **Read the ticket's comments before starting, not just its description.** The description is what was known when the ticket was written; comments carry later context — narrowed scope, a decision already taken, a dead end someone hit, a correction to the original diagnosis. Working from the description alone risks redoing settled work or implementing something that was already ruled out.
- **Use comments to communicate deviations.** If the work diverges from what the ticket describes — scope changes, findings, blockers, test results — record it as a comment on the ticket, not just in chat.
- When a ticket is done, **Document the outcome in a comment starting with `Solution:`.** Use that exact prefix as the comment's opening line, so `^Solution:` finds every resolved ticket on the board. Say what actually resolved it — the commit, the approach taken, and anything a reader would otherwise have to reverse-engineer from the diff; a bare commit hash is not a solution. Use the same prefix when a ticket is closed _without_ a code change, and say why.
- **Be concise.** Titles, descriptions, and comments should be scannable, not essays.
