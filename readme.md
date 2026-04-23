> ⓘ First stable release scheduled for end of April

# Epiq

**CLI-native issue tracker** — powered by Git.
Manage all your projects directly via the command line, edit in your favorite editor.

Epiq stores your issue tracker as event logs inside your Git repository.

```
'███████╗██████╗ ██╗ ██████╗ '
'██╔════╝██╔══██╗██║██╔═══██╗'
'█████╗  ██████╔╝██║██║   ██║'
'██╔══╝  ██╔═══╝ ██║██║▄▄ ██║'
'███████╗██║     ██║╚██████╔╝'
'╚══════╝╚═╝     ╚═╝ ╚═══▀▀╝ '
 🫡 Never leave your editor!
```

## Features

- Issue tracking — tickets with name, description, tags, assignees, and history log
- Filtering — query issues by description, tags, assignees, and so on
- Ergonomics — fast keyboard-driven navigation
- Autocompletion — minimize typing, stay in flow
- Command system — built with ergonomics and automation in mind
- Traceable event log — full history of every change

### Example workflow:

An issue lifecycle as epiq commands:

```
 1.  epiq new issue "Fix login bug"
 2.  epiq assign @john
 3.  epiq tag urgent
 4.  # move with keys to reflect progress
 5.  epiq close
```

## What is epiq?

Epiq is a vim-inspired issue tracker fully integrated in the terminal that brings the tooling to the developers’ fingertips in their comfort zone.

Epiq renders your issue board directly in the terminal using ASCII and stores its state on disk using an event log, versioned and synchronized in Git, resulting in a fast application that can run anywhere, anytime, by anyone with access to Git. It also works without Git for single-user setups.

## Why epiq?

Most issue trackers live outside your workflow. Epiq brings issue tracking into your editor and your repo—where you already work.

These design choices result in a system that is:

- **Zero setup** — no account registration required
- **Repo-native** — your issues live where your code lives
- **Offline-friendly** — works anywhere, with eventual consistency as a promise
- **Speed** — local first, and eventual consistency makes epiq edits instant
- **Portable** — run on your local machine, on a dusty old Linux server or your grandma’s connected toaster
- **Command driven** — scriptable and automation-friendly, ready for the agentic era
- **Versioned** — every change is tracked and recoverable through Git

---

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

Starting the application will launch a wizard that sets you up in 20 seconds.
It will result in settings and state persisted in `~/.epiq/**`

In any folder, run:

```bash
epiq
```

If it is your first run, this opens the interactive setup wizard.

From here, you can start running commands or use keyboard shortcuts to navigate.

## Usage Guide

### Help

- The first thing to know is that you always can access help with `:help`.

### Navigation

- The second thing to know is that you can navigate with the keyboard using arrow keys or `h` `j` `k` `l`.
- You can enter nodes with `enter`, and navigate out of a context with `q` or `esc`

### Commands

- If you type `:` you are put in command line mode and can now insert commands.
- Commands are context-aware, so for instance `:close` only exists for issues.

### :new ...

- Create nodes with `:new issue|swimlane|board <Name of new node>`.

### Move nodes

- Move nodes by pressing `m`. This sets you in a move state, after which you can navigate as normal, navigate to the target location, then press m again to confirm.

### Filtering

- Apply filters with the `filter` command followed by a target, and a qualifier. So in order to filter `prio` tags you can write `:filter tag prio` and hit `enter`. By running several filter commands in succession you add a combination of filters.

Clear filters with `:filter clear`

### Close issue

- Close issues with `:close`. This moves the issue to a special board named `Closed` which you can find if you navigate up (press `q`) a few times.

### Reopen

- You can reopen a task by visiting the `Closed` board, selecting an issue and typing command `:reopen`.

---

## How epiq is synchronized

Epiq uses Git to synchronize state between clients. Running `:sync` pulls and pushes changes between your local state and the remote.

- Your issue data is stored in a dedicated branch managed automatically by epiq
- A local `.epiq/` folder is created in your project as a cache

The `.epiq/` folder:

- Is non-authoritative and used for caching and local tracking
- Can be committed if you want your board state versioned alongside your code
- Is optional — epiq works whether you commit it or not

You generally don’t need to interact with these directly.

> ⓘ The system is designed to avoid merge conflicts.

---
