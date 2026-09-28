---
name: epiq
description: Workflow for working an epiq issue board through the epiq MCP — take an identity, sync on demand, keep tickets small and their status, tags and comments current.
---

# Epiq board workflow

- **Use the `epiq_*` MCP tools** for every board read and write — never the CLI, hand edits, or the state branch directly.
- **Sync is on demand:** call `epiq_sync` to pull or publish; nothing else does.
- **Take an identity before your first write:** `provider/name` (e.g. `claude/peter`), set with `epiq_actor_assume`. Reuse one from `epiq_contributor_list` — names are permanent. If other agents may be running, ask the user which name is free.
- **One MCP server per session** — the name binds to the process; a restart forgets it.
- **Keep tickets small**; put a small follow-up on its existing ticket instead of a new one.
- **Read a ticket's comments before starting.**
- **Picking up a ticket:** assign yourself and move it to the in-progress lane. Ask before taking one assigned to someone else.
- **Keep status, tags and description current**; reuse existing tags.
- **Comment** on deviations, blockers, and the outcome when done.
- **Leave closing tickets and big decisions to the user.**
- **Link commits** by starting the subject with the ticket's `ref` from the MCP response — never derive it from the id.
- **Attachments are permanent** in every clone (max 500 KB): only when a picture is needed, cropped and compressed.
- **Be concise.**
