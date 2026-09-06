# Epiq

_Issue tracking as code. Open source, distributed, local-first, and code-native._

**[See docs →](https://ljtn.github.io/epiq/docs.html)** 

Epiq provides issue tracking as a portable, integrated part of the development environment, with access to all the powerful tooling developers are used to.

> Manage your projects in a visual kanban board — in your terminal or in your browser — while keeping all state local, Git-backed, and versioned.

With great attention to user ergonomics and developer experience, epiq strives to make project management painless and friction free.

![Epiq board with the time travel timeline above it](https://raw.githubusercontent.com/ljtn/epiq/main/source/assets/time-travel.jpeg)

## Audit the workflow

Agents now run whole sprints unattended. Because state is a full event log, you can replay the board to find out what moved when, who moved it, and what changed along the way.

## Code, linked to tickets

Prefix a commit's subject with the ticket's ref and the two are linked:

```
git commit -m "1YRTG8T document the commit-to-ticket link in the readme"
```

That commit now shows up in the ticket's **Commits** tab with its diffstat, and expands into a per-file diff right inside the ticket. Drag across diff lines to quote them into a comment on the ticket, or file a new ticket straight from the selection — the quote links back to the exact lines. The scrubber plots commits alongside board events; click a commit dot to open its diff in the ticket it belongs to.

![A ticket's Commits tab, showing the diff of a linked commit](https://raw.githubusercontent.com/ljtn/epiq/main/source/assets/code-diff.jpeg)

The link is nothing more than the commit subject: Epiq matches commits whose subject starts with `<REF> ` (case-insensitive) and stores nothing else. That makes it robust — no hooks, no database — but it means your merge strategy has to keep those subjects on the branch you inspect:

- **Prefix every commit** with the ref of the ticket it belongs to. Agents get it from the `ref` field on `epiq_issue_list` and `epiq_board_list` responses.
- **Rebase-merge** (`gh pr merge --rebase`) so the ref-prefixed commits land on `main` as they are. A merge commit adds a subject carrying no ref; a squash merge folds every commit into one whose subject GitHub invents from the PR title, and the link is gone.
- Squashing _within_ one ticket's commits is fine as long as the result keeps the prefix. Never squash commits carrying different refs into one.

## Terminal + Browser

Epiq originated from the command line and offers a first-class terminal experience, but also features a browser interface powered by the same Git-backed event engine.

![The Epiq terminal UI: the same board rendered in a terminal, with the command palette along the bottom](https://raw.githubusercontent.com/ljtn/epiq/main/source/assets/tui.jpeg)

## What is epiq?

Epiq is a self hosted, vim-inspired issue tracker that brings developer experience to project management. It renders either as ASCII, or as a web GUI, and persists state as an immutable distributed event log, versioned and synchronized through Git.

## Why Epiq?

Most issue trackers live outside your workflow. Instead of a centralized, managed service, Epiq keeps project state alongside your repository, where it travels with your code.

These design choices result in a system that is:

- **Simple setup** — no accounts, SaaS, or external services required
- **Repo-native** — your issues can live where your code lives
- **Offline-friendly** — works anywhere, with eventual consistency
- **Speed** — local first, and eventual consistency makes Epiq edits instant
- **Portable** — run on your local machine, on a remote Linux server or your grandma’s connected toaster
- **Command driven** — scriptable and automation-friendly, ready for the agentic era
- **Versioned** — changes are tracked and recoverable through Git

## A Features

- Issue tracking — track work in tickets with name, description, tags, assignees, history log, etc.
- Ergonomics — fast keyboard-driven UX, command line with history, syntax highlighting etc.
- Command palette — press `?` to open a scrollable overview of all available commands and descriptions
- Time travel — inspect the board as it was 1h, 1 week or 1 year ago, or replay its history as an animation
- Linked commits — prefix commits with a ticket ref to browse their diffs from the ticket, quote lines into comments, and see them on the timeline
- Filtering — query issues by description, tags, assignees, etc.
- Autocompletion — minimize typing, stay in flow, reuse previous commands
- Multi-user — collaborative synchronization via Git
- Traceable event log — state is a full history of every change ever made
- Export — write the current board layout to markdown
- Browser GUI — graphical interface powered by the same Git-backed state
- MCP integration — Model Context Protocol support for agent interaction

---

## Installation

### Quick install

Binary:

```bash
curl -fsSL https://raw.githubusercontent.com/ljtn/epiq/main/install.sh | sh
```

Installs to `~/.local/bin` by default. Override with `EPIQ_INSTALL_DIR` (or `XDG_BIN_HOME`); pin a version with `EPIQ_VERSION=v1.0.0`.

### Via npm

```bash
npm install --global epiq
```

### Verify

```bash
epiq --version
```

---

## Getting Started in 2 steps

1. Make sure you're inside a Git repository

```bash
# If needed:
git init
# For collaboration, use a repo with a remote (e.g. clone from GitHub)
```

2. Run:

```bash
epiq
```

If it is your first run, this opens the interactive setup wizard that sets you up in about 30 seconds.

That’s it!

Once your project is set up, you can also launch the browser user interface with:

```bash
epiq gui
```

> Setup wizard creates:
> User config persisted in `~/.epiq-global/config.json`.

> Initialization creates:
>
> - Project definition in `./.epiq/project.json`
> - Authoritative Git state at `~/.epiq-global/worktrees/<id>`
> - Updates your `.gitignore` to ignore local-only `.epiq/log/`
>   Epiq manages a dedicated Git state branch and worktree automatically as the source of truth for synchronization.
> - A local debug log at `.epiq/log/epiq.log` — check it first if sync, boot, or a Git operation is misbehaving.

## Usage Guide (TUI)

### Help

- The first thing to know is that you always can access help with `:help`.
- Press `?` anytime to open the command palette with all available commands and descriptions.

### Navigation

- The second thing to know is that you can navigate with the keyboard using arrow keys or `h` `j` `k` `l`.
- You can enter nodes with `enter`, and navigate out of a context with `q` or `esc`

### Commands

- If you type `:` you are put in command line mode and can now insert commands.
- Commands are context-aware, so for instance `:close` only exists for issues.

### Create nodes: issue | swimlane | board

- Create nodes with `:new issue|swimlane|board <Name of new node>`.

### Comment

- Comment on issues with `:comment <your-input>`. Comments can be edited or deleted with the regular ':edit ...' or ':delete' commands.

### Move nodes

- Move nodes by pressing `m`. This sets you in a move state, after which you can navigate as normal, navigate to the target location, then press m again to confirm new location.

### Filtering

- Apply filters with the `filter` command followed by a target, and a qualifier. So in order to filter all issues with a `prio` tag you can write `:filter tag prio` and hit `enter`. You can build a combination of filters by running several filter commands in succession.

Clear all filters with `:filter clear`

### Time travel

- Inspect the board as it was with `:peek <offset>`, where offset is `<n>h`, `d`, `w`, `mo` or `y` — so `:peek 3d` is the board three days ago. An absolute `YYYY-MM-DD` date works too. Step with `:peek prev|next`, and return with `:peek now`.
- Where `:peek` shows a frozen snapshot, `:replay 1mo` plays history forward from that point as an animation. An optional second argument sets the playback duration, e.g. `:replay 1mo 30s`.
- While peeking or replaying, the board is read-only.

### Close issue

- Close issues with `:close`. This moves the issue to a special board named `Closed` which you can find if you navigate up (press `q`) a few times.

### Reopen

- You can reopen a task by visiting the `Closed` board, selecting an issue and typing command `:reopen`. This will restore the issue to its last previous location.

### Reuse command

- Pro tip: just like in any terminal - if you need to do repeating tasks over and over again, you can just put yourself in the command mode, and then press arrow up, in order to access the last executed command. This helps a lot when you create tasks with similar names, or add the same tag to many tickets and so on.

---

## MCP & Agent Compatibility

Epiq provides a MCP (Model Context Protocol) server for agents to interact with, making it easy to plug into modern agent frameworks. The server is exposed by the `epiq-mcp` binary that ships with the package.

### Claude Code

The reliable way to register the server is with the `claude mcp add` command — it writes to the correct config file for you, so you don't have to hand-edit JSON:

```bash
# Available everywhere (recommended)
claude mcp add --scope user epiq -- npx -y -p epiq epiq-mcp

# Or only in the current project
claude mcp add epiq -- npx -y -p epiq epiq-mcp
```

Use `--scope user` to make Epiq available in every directory; omit it to register Epiq only for the current project. Verify the connection with `claude mcp list` (it should report `epiq … ✔ Connected`). MCP servers are loaded at startup, so **restart Claude Code** after adding the server before its tools become available.

### Setting up a board from an agent

An agent can initialize a repository without anyone opening the TUI. `epiq_project_init` runs the same steps as `:init` — state branch, default board, `.epiq/project.json` — in the repository at `repoRoot` (default: the current directory), which must have no uncommitted changes. It tries to push both branches and reports a push that fails as a warning rather than an error, so a repository without a remote still works.

On a machine with no `~/.epiq-global/config.json` yet, the tool also records the user's setup. Called without the answers it fails, naming what it still needs, so the agent asks the user and calls again:

- `userName` — how the user wants to appear on the board
- `preferredEditor` — the command that opens a file, e.g. `vim` or `code --wait`
- `autoSync` — whether the TUI and GUI sync with the remote on their own

Whatever was given is kept between calls. The name recorded is the user's, not the agent's: an agent running under its own identity (see below) is refused if it passes that name here.

### Skills

Find skill at `.claude/skills/epiq/SKILL.md` that documents a recommended workflow for working the Epiq board. `epiq_skill_install` writes the same file into any repository that lacks it, so a project set up from an agent gets the rules too; it leaves an identical copy alone and refuses to overwrite a differing one unless told to with `force`.

### Agent identity

Every process — your TUI, your GUI, each agent's MCP server — writes as the user in `~/.epiq-global/config.json`, so by default the board cannot tell one agent from another. Name an agent's server and it gets its own identity:

```bash
claude mcp add --scope user epiq -- npx -y -p epiq epiq-mcp claude
```

Or, in a hand-written config, as the argument after the command:

```json
{
	"mcpServers": {
		"epiq": {
			"command": "npx",
			"args": ["-y", "-p", "epiq", "epiq-mcp", "claude"]
		}
	}
}
```

That agent then shows up in the contributor list, assigns itself rather than you, and authors its own events. The id is derived from the name, so one name is one contributor on every machine — reuse names instead of inventing one per session, or the registry fills with single-run identities. Naming yourself changes nothing.

`EPIQ_USER_NAME` does the same thing through the environment, for a client whose config sets variables more readily than arguments:

```json
{
	"mcpServers": {
		"epiq": {
			"command": "npx",
			"args": ["-y", "-p", "epiq", "epiq-mcp"],
			"env": {"EPIQ_USER_NAME": "claude"}
		}
	}
}
```

Setting both is an error unless they agree, rather than one quietly winning. `EPIQ_USER_ID` pins the id explicitly (26 characters of Crockford base32) if you would rather choose it, and stays environment-only.

The TUI and GUI take the same name as `--as`, since their first argument is already the command:

```bash
epiq --as claude
epiq gui --as claude
```

### Other MCP clients

For clients that are configured by hand, add the following to the client's MCP config file — note this is **not** the same as Claude Code's `~/.claude.json`; Claude Desktop uses `claude_desktop_config.json`:

```json
{
	"mcpServers": {
		"epiq": {
			"command": "npx",
			"args": ["-y", "-p", "epiq", "epiq-mcp"]
		}
	}
}
```

Once registered, agents can interact with your local Epiq instance through the MCP.

### Sandboxed or network-restricted environments

`npx -y -p epiq epiq-mcp` resolves the package against the npm registry **every time it starts**, even if it's already cached locally. In agent sandboxes with restricted network access, this can make the MCP server appear to hang — `npx` retries DNS resolution instead of failing fast, and there's no MCP-level error to explain why.

If you're running Epiq's MCP server in such an environment, install it globally once and point your MCP config at the resolved executable directly, bypassing `npx` (and the registry lookup) entirely on every subsequent start:

```bash
npm install --global epiq
which epiq-mcp   # use this absolute path in your MCP config
```

```json
{
	"mcpServers": {
		"epiq": {
			"command": "/absolute/path/to/epiq-mcp"
		}
	}
}
```

`npx` remains the simpler option for normal, network-connected setups.

---

## How Epiq is synchronized

Epiq uses Git in the background - no manual Git commands are required. Running `:sync` synchronizes changes between your local state (persisted at `~/.epiq-global/worktrees/<id>/`) and the remote state. By utilizing Git worktrees, synchronization stays isolated from your regular development workflow. Project tracking metadata is stored in `.epiq/project.json`.

## Conflict Avoidance & Data Integrity

Epiq is designed to provide robustness in a distributed, Git-backed environment where multiple users may update state concurrently. Instead of mutating shared files, Epiq uses an event-sourced model to prevent merge conflicts and make concurrent changes predictable.

### Event-sourced state

All changes are stored as **append-only events** in user-scoped files, rather than modifying a shared state file. This avoids in-place edits to the same lines and significantly reduces the likelihood of Git conflicts.

State is reconstructed in-memory by replaying a merge of all user logs.

### Deterministic materialization

The current state is derived by replaying events in a deterministic order.

Events use a composite of time-sortable IDs (ULIDs) and a reference to the last known event ("edge"). On creation, events are appended relative to the last known event. If multiple events share the same reference point, their relative order is resolved using their time-based IDs.

This approach:

- Provides stable and reproducible ordering across machines
- Limits the impact of potential clock drift to small local ordering differences
- Ensures that concurrent updates converge to the same state

### Conflict handling model

Epiq resolves concurrent changes at the event level:

- Events are designed to be **idempotent** where possible
- Later events take precedence when conflicts occur
- Each user writes to their own event log file
- Git merges become trivial combinations of changes in independent files

### Local-first with eventual consistency

Epiq follows a **local-first** model:

- All operations apply instantly on the local machine
- Synchronization happens explicitly (`:sync`) or automatically
- When histories diverge, merging event logs and replaying them leads to a consistent state

> Frequent synchronization reduces divergence and keeps the system predictable

---

[![GitHub Sponsors](https://img.shields.io/badge/Sponsor-Epiq-pink?logo=github)](https://github.com/sponsors/ljtn)

🫡 Never leave your editor!
