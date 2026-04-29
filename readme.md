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

Never leave your favorite editor!

- **Zero setup** — no dashboards, no setup overhead
- **Repo-native** — your issues live where your code lives
- **Offline-first** — works anywhere Git works
- **Portable** — your entire project state travels with the repo
- **CLI-first** — fast, scriptable, and automation-friendly

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

In any folder, run:

```bash
epiq
```

This opens the interactive CLI workspace.

Starting the application will launch a wizard that sets you up in 20 seconds.
It will result in settings persisted at `~/.epicrc`

---

## Philosophy

What epiq brings:

- **Speed** — event sourcing to the file system keeps operations fast
- **Editor-level productivity** — stay in the environment you already use
- **Repo-native issues** — tickets live alongside your code
- **Built-in versioning** — Git is the backend
- **Seamless collaboration** — leverage Git’s distributed workflow
- **Fully distributed** — no central configuration or registration required

---

## Features

- Issue tracking — lightweight, structured tickets
- Event log — full history of every change
- Filtering — query issues by tags, assignees, and more
- Navigation-first UI — fast keyboard-driven workflow
- Markdown descriptions — shareable, human-readable boards
- Extensible command system — built with automation in mind
