# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Code style

- Do not add explanatory comments describing what the code is doing. Keep the code self-documenting and only comment when strictly necessary (e.g. a non-obvious gotcha).

## Commands

```bash
bun run dev              # frontend dev server only (no Tauri shell)
bun run tauri dev        # full app with Tauri shell (requires Rust toolchain)
bun run check            # svelte-check + TypeScript
bun run lint             # Biome check --write (auto-fixes)
bun run lint:ci          # Biome CI mode (no writes, exits non-zero on issues)
bun run test             # Vitest run (all tests)
bun run test:coverage    # Vitest with Istanbul coverage
```

Run a single test file: `bun run test -- src/lib/utils/files/files-tree.test.ts`

---

## Architecture

Tauri v2 desktop app: **Rust backend** (`src-tauri/`) + **SvelteKit frontend** (`src/`).

### Data flow

```
Component -> Store -> Service -> invoke() -> Rust command -> ~/.cairn/*.json
```

- **Services** (`src/lib/services/`) are the only place that call `invoke()`. Never call `invoke()` directly from components or stores.
- **Stores** (`src/lib/stores/`) hold reactive Svelte state and call services. They are the single source of truth for the UI.
- **Rust commands** (`src-tauri/src/commands/`) are registered in `lib.rs` and organized by domain: `projects`, `instances`, `settings`, `git`, `files`, `agent`, `shell`, `ui_state`, `file_state`.

### Persistent storage on disk

All app data lives in `~/.cairn/`. The layout is defined in `src-tauri/src/storage.rs`:

```
~/.cairn/
  settings.json                           # global app settings (CairnSettings)
  ui-state.json                           # navigation state (screen, active project, tabs, home section...)
  projects/
    projects.json                         # all registered projects
    listing.json                          # project order + folder groupings
    {project-id}/
      instances.json                      # instances for this project
      worktrees/                          # git worktrees per instance
      instances/
        {instance-id}/
          file-state.json                 # editor tabs, cursor, scroll, recent files per instance
```

Path helpers for every location are centralized in `storage.rs`. Always add new paths there, never inline. The only remaining `localStorage` use is in `src/lib/i18n/index.ts` for the locale preference (`cairn:locale`).

### Adding a new persisted field

1. Add the path helper in `storage.rs` if needed.
2. Add the Rust struct field with a `#[serde(default)]` in the relevant `commands/*.rs` file.
3. Register the command in `lib.rs` and re-export in `commands/mod.rs`.
4. Mirror the type in the corresponding TS service (`src/lib/services/`).
5. The TS service is the only layer that calls `invoke()`.

### Navigation model

Two top-level screens controlled by `screen: 'home' | 'workspace'` in `+page.svelte`:

- **Home** — project list, checkpoints, activity, settings. Active section tracked in `+page.svelte` via `sectionChange` events emitted by `Home.svelte`.
- **Workspace** — per-project view with workflow tabs (files, agent, review, tests, git, cicd). Active tab is `activeStep` from `src/lib/stores/ui.ts`.

### Agent system

`AgentState` (Rust, `src-tauri/src/commands/agent/mod.rs`) holds a `ProviderRegistry` and a `Mutex<AgentSession>`. Claude Code CLI is the v1 provider (`providers/claude_cli.rs`). The provider runs in a spawned thread and emits `claude-output` Tauri events line-by-line to the frontend.

### Settings

`CairnSettings` is defined in both Rust (`commands/settings.rs`) and TypeScript (`services/settings-service.ts`) — keep them in sync when adding fields. Default values must be declared on both sides. The TS store (`stores/settings.ts`) merges loaded values with `DEFAULTS` so new fields never break existing saved configs.

---

## Key conventions

- Svelte 5 with runes is available but the codebase currently uses Svelte 4 store patterns (`writable`, `derived`, `createEventDispatcher`). Match the surrounding style.
- Components dispatch events up with `createEventDispatcher`; they never import stores directly when avoidable.
- All Tauri IPC uses camelCase on the TS side and snake_case on the Rust side — `invoke("some_command", { myParam })` maps to `#[tauri::command] fn some_command(my_param: ...)`.
- i18n keys live in `src/lib/i18n/en.ts` and `fr.ts`. Use `t('key')` from `$lib/i18n` for any user-visible string.
