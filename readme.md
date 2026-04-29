> ⓘ First stable release scheduled for end of April 2026

# Epiq

_Distributed CLI based issue tracker TUI_ backed by git.

Issue tracking is a part of the development lifecycle, but it often becomes a painful context switching exercise with poor ergonomics. `Epiq` provides issue tracking as a portable, integrated part of the development environment, with access to all the powerful tooling developers are used to. Epiq is a **CLI-native issue tracker** — powered by Git in which you can manage all your projects directly via the command line in a visual kanban board and edit content in your favorite, personalized editor.

With great attention to user ergonomics, epiq intends to make project management painless and friction free again, and has developer satisfaction as its primary target.

```
'███████╗██████╗ ██╗ ██████╗ '
'██╔════╝██╔══██╗██║██╔═══██╗'
'█████╗  ██████╔╝██║██║   ██║'
'██╔══╝  ██╔═══╝ ██║██║▄▄ ██║'
'███████╗██║     ██║╚██████╔╝'
'╚══════╝╚═╝     ╚═╝ ╚═══▀▀╝ '
 🫡 Never leave your editor!
```

## What is epiq?

Epiq is a vim-inspired issue tracker fully integrated in the terminal that brings the tooling to the developers’ fingertips - in their comfort zone.

Epiq renders your issue board directly in the terminal using ASCII and stores its state as an event log, versioned and synchronized through Git.

![Epiq cli kanban view](https://raw.githubusercontent.com/ljtn/epiq/main/resources/overview.png)
![Epiq cli log view](https://raw.githubusercontent.com/ljtn/epiq/main/resources/log.png)

## Features

- Issue tracking — track work in tickets with name, description, tags, assignees, history log, etc.
- Ergonomics — fast keyboard-driven ux, command line with history, syntax highlighting etc.
- Time travel — inspect your app 1h, 1 week or 1 year ago
- Filtering — query issues by description, tags, assignees, etc.
- Autocompletion — minimize typing, stay in flow
- Multi-user — real-time synchronization of board
- Traceable event log — state is a full history of every change ever made

## Why epiq?

Most issue trackers live outside your workflow. Epiq brings issue tracking into your editor and your repo—where you already work.

These design choices result in a system that is:

- **Zero setup** — no account registration required
- **Repo-native** — your issues can live where your code lives
- **Offline-friendly** — works anywhere, with eventual consistency as a promise
- **Speed** — local first, and eventual consistency makes epiq edits instant
- **Portable** — run on your local machine, on a remote Linux server or your grandma’s connected toaster
- **Command driven** — scriptable and automation-friendly, ready for the agentic era
- **Versioned** — every change is tracked and recoverable through Git

---

## MCP & Agent Compatibility

Epiq provides a MCP (Model Context Protocol) server for agents to interact with, making it easy to plug into modern agent frameworks.

To register Epiq with MCP-compatible clients (e.g. Claude Desktop), add it as a server using the `epiq-mcp` binary. Example configuration:

```json
{
	"mcpServers": {
		"epiq": {
			"command": "epiq-mcp"
		}
	}
}
```

Once registered, agents can interact with your local Epiq instance through the MCP.

---

### Example workflow:

An issue lifecycle as epiq commands:

```
 1.  epiq new issue "Fix login bug"
 2.  epiq assign @john
 3.  epiq tag urgent
 4.  # move with keys to reflect progress
 5.  epiq close
```

## Installation

Install globally via npm:

```bash
npm install --global epiq
```

Verify:

```bash
epiq --version
```

---

## Getting Started

In any folder, run:

```bash
epiq
```

If it is your first run, this opens the interactive setup wizard that sets you up in about 30 seconds.

From here, you can start running commands or use keyboard shortcuts to navigate.

This creates local settings in `~/.epiq/**` and initializes synchronization for your repository. A local `.epiq` folder will also be created in your repository.

> Epiq will execute git commands on your behalf in order to sync your work with a dedicated state branch remotely.

## Usage Guide

### Help

- The first thing to know is that you always can access help with `:help`.

### Navigation

- The second thing to know is that you can navigate with the keyboard using arrow keys or `h` `j` `k` `l`.
- You can enter nodes with `enter`, and navigate out of a context with `q` or `esc`

### Commands

- If you type `:` you are put in command line mode and can now insert commands.
- Commands are context-aware, so for instance `:close` only exists for issues.

### Create nodes: issue | swimlane | board

- Create nodes with `:new issue|swimlane|board <Name of new node>`.

### Move nodes

- Move nodes by pressing `m`. This sets you in a move state, after which you can navigate as normal, navigate to the target location, then press m again to confirm new location.

### Filtering

- Apply filters with the `filter` command followed by a target, and a qualifier. So in order to filter all issues with a `prio` tag you can write `:filter tag prio` and hit `enter`. You can build a combination of filters by running several filter commands in succession.

Clear all filters with `:filter clear`

### Close issue

- Close issues with `:close`. This moves the issue to a special board named `Closed` which you can find if you navigate up (press `q`) a few times.

### Reopen

- You can reopen a task by visiting the `Closed` board, selecting an issue and typing command `:reopen`. This will restore the issue to its last previous location.

### Reuse command

- Pro tip: just like in any terminal - if you need to do repeating tasks over and over again, you can just put yourself in the command mode, and then press arrow up, in order to access the last executed command. This helps a lot when you create tasks with similar names, or add the same tag to many tickets and so on.

Starting the application will launch a wizard that sets you up in 20 seconds.
It will result in settings persisted at `~/.epicrc`

---

## How epiq is synchronized

Epiq uses Git in the background to synchronize state between clients. No manual git commands are required to make it work. Running `:sync` pulls and pushes changes between your local state and the remote state.

- Your issue data is stored in a dedicated branch managed automatically by epiq
- A local `.epiq/` folder is created in your project as a local cache

The `.epiq/` folder is non-authoritative and used for caching and local tracking. It can optionally be committed if you want your board state versioned alongside your code.

> The system is designed to assure robustness and uses a number of techniques and design patterns to avoid merge conflicts.

---

🫡 Never leave your editor!
