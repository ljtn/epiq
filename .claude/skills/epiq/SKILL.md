---
name: epiq
description: Workflow rules for working the epiq issue board — use the epiq MCP, sync on demand, scope tickets small, keep status/tags accurate, and communicate via comments.
---

# Epiq board workflow

- **Never test against the real board.** Point any dev server, manual test or test run at a throwaway project, never at this repo's own. Deleting test tickets afterwards does not undo the events. Stop the dev server when you're done rather than leaving it autosyncing.
- **Use the epiq MCP tools** (`epiq_*`) for all board operations — never the `epiq` CLI or hand-edited state files.
- **Never edit the state branch directly.** Don't check it out, don't write to its worktree, don't touch the event log or any file under it by hand or by script — go through the MCP for every read and write. The event log is the system of record: an edit made outside it bypasses validation and ordering, and can corrupt history in ways no later fix can undo.
- **Sync is on-demand only.** MCP reads/writes operate on local state and never pull/push automatically. Call `epiq_sync` explicitly when you need the latest remote state or want to publish local changes.
- **Break work into small, scoped tickets.** One ticket per independent unit of work, not one giant ticket for a whole feature/epic. Small tickets move through the board cleanly and are easier to review.
- **Keep the status column current as work progresses**
- **Assign the ticket to yourself when you pick it up**, alongside moving it to Ongoing — so the board shows who is on what, not just what is in flight.
- **Prefix commits with the ticket ref. **Retrieve the ref programmatically, NEVER DERIVE IT.\*\* Read the `ref` field off the MCP response (`epiq_issue_list` and `epiq_board_list` include it on every entry). This is what link-by-reference feature matches on.
- **Prefer rebase over merge when integrating a branch, and squash-merge only when there's a real reason to collapse history.** A squash merge folds every ref-prefixed commit into one, which breaks the commit↔ticket linking this same ref-prefix convention exists for — main ends up with no trace of which commits belonged to which ticket. Squashing is fine *within* a run of commits that share the same ref prefix (they're already one ticket's worth of history); never squash across commits carrying different refs into one.
- **Tag tickets properly.** Reuse existing tags where they fit (check current issues/tags first) instead of inventing near-duplicates.
- **Read the ticket's comments before starting, not just its description.** The description is what was known when the ticket was written; comments carry later context — narrowed scope, a decision already taken, a dead end someone hit, a correction to the original diagnosis. Working from the description alone risks redoing settled work or implementing something that was already ruled out.
- **Use comments to communicate deviations.** If the work diverges from what the ticket describes — scope changes, findings, blockers, test results — record it as a comment on the ticket, not just in chat.
- When a ticket is done, **Document the outcome in a comment starting with `Solution:`.** Use that exact prefix as the comment's opening line, so `^Solution:` finds every resolved ticket on the board. Say what actually resolved it — the commit, the approach taken, and anything a reader would otherwise have to reverse-engineer from the diff; a bare commit hash is not a solution. Use the same prefix when a ticket is closed _without_ a code change, and say why.
- **Be concise.** Titles, descriptions, and comments should be scannable, not essays.
- If a ticket is blocked, **record the blocker in a comment** and move it to Blocked (or tag it blocked if there is no Blocked column).
- If a you decide to take a new approach, make sure to document the fork in a new comment, and tag the ticket with a "fork" tag, **update the description** to reflect the new plan. Don't leave it as-is and expect readers to infer the change from comments.
- **Park decisions that are the user's to make.** A design fork, a change with blast radius beyond its ticket, anything you'd want a second opinion on — file a ticket tagged `human-input-needed` naming the options and the trade-off, then carry on with whatever doesn't depend on the answer. Settling it alone in chat, while nobody is reading, is a decision the user never made.
- **Findings from a code review get their own tickets**, tagged `from-review`, with the description saying which branch or PR the review covered — so the provenance survives even if the tag doesn't.
