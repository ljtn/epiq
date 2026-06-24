# epiq — `ghpages` (website only)

This branch holds **only the published website** served at
<https://ljtn.github.io/epiq/> from the [`docs/`](./docs) folder. It is *not*
the application source.

```
docs/
├── index.html   # landing page
├── docs.html    # documentation page
├── styles.css   # shared styles
└── assets…      # images / video / favicon / og image
```

## ⚠️ For anyone (human or AI) editing the docs

The documentation describes how the epiq CLI behaves — its commands, modifiers,
keyboard shortcuts, and config. **The source of truth for all of that lives on
the `main` branch, not here.** This branch deliberately contains no application
code so that stale copies can't be mistaken for current behavior.

When writing or correcting docs content, verify every claim against `main`, e.g.:

- Commands & descriptions — `source/lib/command-line/commands.ts`
- Command keywords — `source/lib/command-line/cmd-keywords.ts`
- Modifiers (e.g. `:config`, `:filter`, `:peek`) — `source/lib/command-line/command-modifiers.ts`
- Keyboard shortcuts — `source/lib/actions/default/default-actions.ts`, `source/lib/actions/move/move-actions.ts`
- Installation / overview — `readme.md` on `main`

Read those from `main` (e.g. `git show origin/main:<path>`) rather than trusting
anything on this branch.
