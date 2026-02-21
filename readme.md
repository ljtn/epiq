# epiq

> **The ultimate productivity tool** — a CLI-based issue tracking client powered by Git as its backend, living directly inside the repository you work in.
> No external services. No context switching. Just tickets - versioned and colocated with your code.

---

## Why epiq?

- **Simplicity** — Skip the additional tooling complexity
- **Repo-native** — Lives inside your project directory
- **Offline-ready** — Works wherever Git works
- **Team-friendly** — Collaborate through normal Git workflows
- **Shareable** — ASCII board exported to `.md`, viewable in the CLI, on GitHub/GitLab, or as your project README.
- **CLI-first** — Fast, scriptable, and developer/agent-friendly

---

## 📦 Installation

Install globally using npm:

```bash
npm install --global epiq
```

Verify installation:

```bash
epiq --version
```

---

## 🚀 Getting Started

### Initialize a project

Create a new epiq workspace inside your current directory:

```bash
epiq --init "Project Name"
```

This sets up epiq in your repository and prepares it for issue tracking.

---

### Open the workspace

Run epiq inside any initialized repository:

```bash
epiq
```

This opens the interactive CLI workspace.

---

## 🛠 Philosophy

epiq keeps issue tracking:

- Close to your code
- Versioned with your commits
- Simple and transparent
- Independent from external platforms

If you use Git, you already have everything you need.

---

Built for developers who live in the terminal.
