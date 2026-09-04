# Cairn Foundry

Cairn Foundry is a desktop workspace for developing with an AI coding agent. It puts the
editor, the terminal, git, and the agent conversation in the same window, and it
isolates each piece of work in its own git worktree so several tasks can run at
the same time without stepping on each other.

Built with [Tauri v2](https://tauri.app) (Rust backend) and
[SvelteKit](https://kit.svelte.dev) (frontend). Licensed under AGPL-3.0-only.

## What it does

- **Projects and instances.** A project is a git repository. An instance is a
  unit of work inside it, backed by its own worktree, with its own editor tabs,
  terminals, and agent conversations.
- **Agent.** Runs Claude Code as a provider, streaming its output into the
  conversation. Several conversations of the same instance can run at once, each
  one resuming its own CLI session. Conversations are scoped per instance or
  shared across the whole project, and can be pinned or archived.
- **Files.** CodeMirror 6 editor with per-language support, a minimap, diff
  view, and inline WYSIWYG rendering for Markdown (headings, links, tables,
  images, task lists) with no separate preview pane.
- **Terminals.** Real PTYs, scoped per instance or shared at project level, and
  movable between the two scopes by drag without restarting the process.
- **Workflow steps.** Files, agent, review, tests, git and CI/CD, each as a tab
  of the workspace.
- **Everything comes back.** Whatever view was open at close is what reopens at
  launch: step, tabs, cursor and scroll positions, terminals, conversations.

## Requirements

- [Bun](https://bun.sh) 1.2 or newer, which is what reads the committed
  `bun.lock`; older versions silently ignore it and install unpinned versions
- A Rust toolchain (for the Tauri shell)
- The [Claude Code](https://claude.com/claude-code) CLI on your `PATH` for the
  agent features
- Platform dependencies listed in the
  [Tauri prerequisites](https://tauri.app/start/prerequisites/)

## Getting started

```bash
bun install
bun run tauri dev        # full app with the Tauri shell
```

`bun run dev` starts the frontend alone on `http://localhost:1420`; anything
that calls into Rust is unavailable there.

To build a release bundle:

```bash
bun run tauri build
```

## Commands

```bash
bun run dev              # frontend dev server only (no Tauri shell)
bun run tauri dev        # full app with Tauri shell
bun run check            # svelte-check + TypeScript
bun run lint             # Biome check --write (auto-fixes)
bun run lint:ci          # Biome CI mode (no writes)
bun run test             # Vitest run (all tests)
bun run test:coverage    # Vitest with Istanbul coverage
```

Run a single test file:

```bash
bun run test -- src/lib/utils/files/files-tree.test.ts
```

## Architecture

```
Component -> Store -> Service -> invoke() -> Rust command -> ~/.cairn/*.json
```

- `src/lib/components/` - views, grouped by workflow step (`agent`, `files`,
  `git`, `review`, `tests`, `cicd`, `terminal`, `home`, `layout`).
- `src/lib/stores/` - reactive state, the single source of truth for the UI.
- `src/lib/services/` - the only layer allowed to call `invoke()`.
- `src-tauri/src/commands/` - Rust commands by domain (`projects`, `instances`,
  `settings`, `git`, `files`, `agent`, `shell`, `ui_state`, `file_state`),
  registered in `lib.rs`.

All application data lives under `~/.cairn/`: settings, UI state, projects,
per-instance worktrees, editor state, and conversations. The layout is defined
in `src-tauri/src/storage.rs`, which centralizes every path helper.

Provider API keys never go through the OS keychain. They are stored in
`~/.cairn/ai-keys.enc`, encrypted with ChaCha20-Poly1305 using the secret in
`~/.cairn/ai-keys.secret`; both files are `0600`. The frontend only ever learns
whether a key exists, never its value.

## Internationalization

Every user-visible string goes through `t('key')` from `$lib/i18n`, with the
pairs declared in `src/lib/i18n/en.ts` and `fr.ts`. English and French are both
first-class.

## Changelog

User-visible changes are recorded in `src/lib/data/changelog.json` and rendered
in the app's *What's new* section, in English and French.

## License

[AGPL-3.0-only](LICENSE).

## Trademark

Cairn Foundry(TM) is a trademark of Benjamin Bonneton. The AGPL-3.0 license
covers the source code, not the name or the logo. See [TRADEMARK.md](TRADEMARK.md).

## Copyright

Copyright (C) 2026 Benjamin Bonneton. See [AUTHORS](AUTHORS).
