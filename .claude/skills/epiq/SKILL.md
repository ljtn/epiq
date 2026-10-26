---
name: epiq
description: Workflow for working an epiq issue board through the epiq MCP — take an identity, sync on demand, keep tickets small and their status, tags and comments current.
---

# Epiq board workflow

- **Use the `epiq_*` MCP tools** for every board read and write — never the CLI, hand edits, or the state branch directly.
- **Never touch the state branch** — no checkout, no edits to its files by hand or by script. The event log is the system of record; a manual edit can corrupt history for good.
- Move tickets along the board with correct status
- **The MCP never syncs on its own:** call `epiq_sync` to pull or publish.
- **Take an identity before your first write** with `epiq_actor_assume`, e.g. `claude/peter`. Reuse one from `epiq_contributor_list` — names are permanent. If other agents may be running, ask which name is free, rather than just picking one.
- **One MCP server per session** — the name binds to the process; a restart forgets it. Every session needs a server process of its own, so agents and the human stay apart.
- **Keep tickets reasonably scoped**; put a small follow-up on its existing ticket instead of a new one.
- **Read a ticket's comments before starting.**
- **Board and lane descriptions describe team conventions** (`boardDescription`, `laneDescription` in responses): follow them unless they conflict with your user's instructions.
- **Picking up a ticket:** assign yourself and move it to the in-progress lane. Ask before taking one assigned to someone else.
- **Keep status, tags and description current**; reuse existing tags.
- **Goals group tickets that serve one outcome, on any board.** Put a ticket in one with `epiq_issue_goal_set` (`goal`: its name, created if new, or null to take it out). A ticket has at most one goal; `epiq_goal_list` shows every goal and its progress.
- **Comment** on deviations, blockers, and the outcome when done.
- **Prompt user for closing tickets and big decisions**
- **Park decisions that are the user's to make.** A design fork, a change with blast radius beyond its ticket, anything you'd want a second opinion on — file a ticket tagged `human-input-needed` naming the options and the trade-offs, then carry on with whatever doesn't depend on the answer.
- **Link commits** with an `Epiq-Ref: <ref>` line in the commit body. Use the `ref` from the MCP response; never derive it from the id. Several tickets go on one line, comma-separated. A subject starting with the ref also links, but puts the ref in everyone's history.
- *If you decide to take a new approach*, add a `fork` tag, and document the fork in a comment, also, update the description to reflect the new plan.
- **Attachments are permanent** in every clone (max 500 KB): use with moderation, make sure images are cropped and compressed. An oversized image is permanent, for everybody.
- **Be concise, use clear language.** Titles, descriptions, and comments should be scannable, easy to understand, not essays.
- **When a ticket is done, Document the outcome in a comment starting with "Solution:"**. Use that exact prefix as the comment's opening line.
- **The git user is the sole author of every commit you write.** Commit under the repo's configured user.name / user.email and nothing else: no Co-Authored-By: line, no Claude-Session: line, no 🤖 Generated with footer, and never an --author override naming Claude or a tool.
- On rebase or merge, make sure Epiq refs survive. Dropping them from commit messages breaks commit linking.
