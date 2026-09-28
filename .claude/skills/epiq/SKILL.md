---
name: epiq
description: Workflow for working an epiq issue board through the epiq MCP — take an identity, sync on demand, keep tickets small and their status, tags and comments current.
---

# Epiq board workflow

- **Use the `epiq_*` MCP tools** for every board read and write — never the CLI, hand edits, or the state branch directly.
- Never edit the state branch directly. Don't check it out, don't write to its worktree, don't touch the event log or any file under it by hand or by script — go through the MCP for every read and write. The event log is the system of record: an edit made outside it bypasses validation and ordering, and can corrupt history in ways no later fix can undo.
- Keep the status column current as work progresses (move tickets along the board with correct status)
- **Sync is on demand:** call `epiq_sync` to pull or publish; nothing else does.
- **Take an identity before your first write:** `provider/name` (e.g. `claude/peter`), set with `epiq_actor_assume`. Reuse one from `epiq_contributor_list` — names are permanent. If other agents may be running, ask which name is free, rather than just picking one.
- Break work into small, reasonably scoped tickets.
- **One MCP server per session** — the name binds to the process; a restart forgets it. epiq_actor_assume binds the name to the server process it is called on, so two sessions on one server — or a session on the user's own instance — would sign every write with whichever name was assumed last, and the log would fold them into one contributor. Every session therefore needs a server process of its own.
- **Keep tickets small**; put a small follow-up on its existing ticket instead of a new one.
- **Read a ticket's comments before starting.**
- **Picking up a ticket:** assign yourself and move it to the in-progress lane. Ask before taking one assigned to someone else.
- **Keep status, tags and description current**; reuse existing tags.
- **Comment** on deviations, blockers, and the outcome when done.
- **Prompt user for closing tickets and big decisions**
- **Park decisions that are the user's to make.** A design fork, a change with blast radius beyond its ticket, anything you'd want a second opinion on - file a ticket tagged human-input-needed naming the options and the trade-offs, then carry on with whatever doesn't depend on the answer.
- **Link commits** by starting the subject with the ticket's `ref` from the MCP response — never derive the ref from the id.
- *If a you decide to take a new approach*, add a "fork" tag, and document the fork in a comment, also, update the description to reflect the new plan.
- **Attachments are permanent** in every clone (max 500 KB): only when a picture is needed, make sure images are cropped and compressed. An oversized image is permanent, for everybody — the same reason the text limits exist.
- **Be concise.** Titles, descriptions, and comments should be scannable, not essays.
- **When a ticket is done, Document the outcome in a comment starting with "Solution:"**. Use that exact prefix as the comment's opening line.
- **The git user is the sole author of every commit you write.** Commit under the repo's configured user.name / user.email and nothing else: no Co-Authored-By: line, no Claude-Session: line, no 🤖 Generated with footer, and never an --author override naming Claude or a tool.
- Always rebase onto the target, never merge into it. Rebase the branch onto the target first, then integrate with a rebase merge — gh pr merge --rebase, never --merge. Main stays a flat sequence of ref-prefixed commits, which is what the commit↔ticket linking reads. A merge commit adds a subject carrying no ref and buries the branch's commits behind it.
