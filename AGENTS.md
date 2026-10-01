# AGENTS.md

This file provides guidance when working with code in this repository.

## Code style

- Do not add explanatory comments describing what the code is doing. Keep the code self-documenting and only comment when strictly necessary (e.g. a non-obvious gotcha).
- Every source file starts with the license header (an HTML comment in `.svelte` files):

```rust
// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
```

## Commands

```bash
bun run dev              # frontend dev server only (no Tauri shell)
bun run tauri:dev        # full app with Tauri shell (requires Rust toolchain)
bun run check            # svelte-check + TypeScript
bun run lint             # Biome check --write (auto-fixes)
bun run lint:ci          # Biome CI mode (no writes, exits non-zero on issues)
bun run test             # Vitest run (frontend tests)
bun run test:rust        # cargo test (Rust unit tests, run from src-tauri/)
bun run test:all         # frontend + Rust tests
bun run test:coverage    # Vitest with Istanbul coverage
```

Run a single frontend test file: `bun run test -- src/lib/stores/git.test.ts`.

`bun run tauri:dev` exports `.env` to the processes Tauri spawns (a bare `bun run` keeps it to
bun's own runtime). Copy `env.example` to `.env` to pick a data directory (see "The data
directory depends on the channel").

## Architecture

Tauri v2 desktop app: **Rust backend** (`src-tauri/`) + **SvelteKit frontend** (`src/`, SPA with
`ssr = false`). The Rust crate is `cairn_lib` with a small `cli/` workspace member beside it.

### Target platforms

Cairn runs on **Linux first**, then macOS, then Windows, in that order of installed
base. Linux is the majority platform, so it is the one a change has to be right on -
not the one it is ported to afterwards. Two consequences worth keeping in mind:

- The filesystem watcher uses inotify on Linux, where watches are a per-user quota
  (`fs.inotify.max_user_watches`) shared with every other process. Watching a large
  repository can fail with `ENOSPC` on a machine that is otherwise healthy. macOS
  (FSEvents, one recursive watch) and Windows have no equivalent ceiling, so a
  watcher bug that only shows under quota pressure is invisible on a Mac.
- Paths, line endings and process spawning differ on Windows; anything shelling out
  or building a path by hand needs a thought for it even though it comes last.

### Data flow

```
Component -> Store -> Service -> invoke() -> Rust command -> ~/.cairn/*.json
```

- **Services** (`src/lib/services/`) are the only place that call `invoke()`. Never call `invoke()` directly from components or stores.
- **Stores** (`src/lib/stores/`) hold reactive Svelte state and call services. They are the single source of truth for the UI.
- **Rust commands** (`src-tauri/src/commands/`) are one module per domain, re-exported flat by `commands/mod.rs` and registered in one `generate_handler!` in `lib.rs` (~230 commands).

Known exceptions to the service boundary: `utils/terminal/terminal-manager.ts` pipes PTY data
through the Tauri event API directly, `stores/language-server.ts` subscribes to Tauri events,
and components may use plugin APIs (dialog, window, webview) for native dialogs, zoom and window
dragging. Opening a URL or a file goes through `opener-service.ts` (`open_external`), never a
plugin: the spawned opener must get the environment `child_env` cleans. Everything else goes through a service.

Every child process is built through `child_env::command` (or `child_env::scrub` /
`scrub_pty` on a command built elsewhere), never a bare `Command::new`: in an AppImage the app's
environment and working directory lead into its temporary mount, and a child inheriting them
breaks (python3, language servers, GTK applications).

The boundary is enforced by `src/test/ipc-contract.test.ts`: it statically confronts every TS
`invoke("name", {args})` with the Rust `#[tauri::command]` signatures, so a renamed command or
argument fails the suite.

### Blocking commands must be `async` (or the UI freezes)

A synchronous `#[tauri::command] fn` runs on the **main thread**, which on macOS is also the
webview/UI thread. Any command that blocks for more than a few milliseconds - shelling out to
`git`, spawning a process, formatting a document, probing a language server - freezes the whole
window while it runs: no repaint, and even a `Spinner` that was just shown cannot animate. The
symptom is "freeze without loading".

Declare any such command `pub async fn` (the body can stay ordinary blocking code - Tauri runs
`async` commands on a worker thread, off the main thread). Reserve plain `fn` for genuinely fast,
in-memory work (reading a small JSON file, string parsing). When a command feels slow in the app,
this is the first thing to check.

### Persistent storage on disk

All app data lives in `~/.cairn/`. The layout is defined in `storage.rs`, which holds the only
path helpers (28 of them, all hanging off `cairn_dir()`):

```
~/.cairn/
  settings.json                           # global app settings (CairnSettings)
  ui-state.json                           # navigation state (screen, active project, tabs...)
  commands.json                           # global custom commands
  env.json                                # global env vars
  integrations.json                       # integration connections
  ai-keys.enc                             # provider API keys + integration tokens, encrypted (0600)
  ai-keys.secret                          # the key ai-keys.enc is encrypted with (0600)
  agent-signals/{conversation-id}         # turn state written by a running CLI's hooks, wiped at startup
  projects/
    projects.json                         # all registered projects
    listing.json                          # project order + folder groupings
    {project-id}/
      instances.json                      # instances for this project
      terminal-state.json                 # terminals shared across every instance of the project
      conversations/                      # project-scoped conversations (index.json)
      formatting.json                     # per-project formatter config
      commands.json / env.json / integrations.json   # project-scoped overrides
      worktrees/                          # git worktrees per instance
      instances/
        {instance-id}/
          conversations/                  # instance-scoped conversations (index.json)
          file-state.json                 # editor tabs, panes, cursor, recent files
          terminal-state.json             # terminals of this instance
          commit-state.json               # commit dialog options
          git-collapse-state.json         # folded file groups in the git view
          review-state.json               # review guide position, seen hunks, comments
          test-state.json                 # test tree state
          command-state.json / env.json   # per-instance command runs, env vars
```

Writes go through `write_json_atomic` (temp file, then rename).

### The data directory depends on the channel

`APP_ENVIRONMENT` picks which root the app owns: unset (or anything unrecognized)
is `~/.cairn`, `beta` is `~/.cairn-beta`, `dev` is `~/.cairn-dev`. This is what
lets a development build run beside the installed one - they would otherwise write
the same settings, the same project list and the same worktrees, and since every
store debounces its writes, the loser of that race loses silently.

```bash
cp env.example .env      # sets APP_ENVIRONMENT=dev
bun run tauri:dev        # runs on ~/.cairn-dev
```

`storage::channel()` reads it and `cairn_dir()` is the only caller; every other
path helper hangs off `cairn_dir()`, so nothing else needs to know. Two rules
follow:

- **Never spell `~/.cairn` out in a user-visible string.** It is wrong on a beta
  or dev build. The `get_channel` command answers with the real path, the
  `channel` store (`src/lib/stores/channel.ts`) holds it, and `displayDir` is the
  form with `~` written back for display.
- **The single-instance lock only applies to the release channel** (`lib.rs`). It
  is keyed on the bundle identifier, which every channel shares, so a dev build
  left inside it would fold into the running release app instead of opening its
  own window. A non-release build owns a different directory, so the invariant
  the lock protects - one writer per data root - still holds without it. On the
  release channel a second launch does not start a new process: its `cairn`
  arguments are forwarded to the running app as a `cli-open` event (see "The
  cairn CLI").

**API keys never go through the OS keychain.** A keychain read prompts for authorisation on every
launch of an unsigned or rebuilt binary, once per stored item, which turned opening the Providers
screen into a wall of dialogs. Keys live in `ai-keys.enc`, encrypted with ChaCha20-Poly1305 using
the secret in `ai-keys.secret`; both files are `0600`. The same store holds integration tokens.
The frontend only ever learns whether a key exists (`get_api_key_statuses`, one call for every
provider), never the key itself. The only remaining `localStorage` use is in `src/lib/i18n/index.ts` for the locale preference (`cairn:locale`).

### Adding a new persisted field

1. Add the path helper in `storage.rs` if needed.
2. Add the Rust struct field with a `#[serde(default)]` in the relevant `commands/*.rs` file.
3. Register the command in `lib.rs` (it is re-exported flat by `commands/mod.rs`).
4. Mirror the type in the corresponding TS service (`src/lib/services/`).
5. The TS service is the only layer that calls `invoke()`.

`CairnSettings` specifically is mirrored in both Rust (`commands/settings.rs`) and TypeScript
(`services/settings-service.ts`) - defaults must be declared on both sides, and the TS store
(`stores/settings.ts`) merges loaded values with its `DEFAULTS` so new fields never break saved
configs.

### Navigation model

Two top-level screens controlled by `screen: 'home' | 'workspace'` in `+page.svelte`:

- **Home** - project list, tickets, integrations, providers, language servers, AI features,
  agents, skills, MCP servers, ports, changelog, settings. The active section is persisted
  (`homeSection`).
- **Workspace** - per-project view with workflow tabs (files, agent, review, tests, git, cicd).

Workspace is lazily imported on first entry and, once loaded, stays mounted behind the home
screen so terminals and open files survive round trips. Within the workspace, the step and tool
views are hidden, not unmounted (they keep their state), and the heavier ones (review, tests,
git, cicd, terminal, commands, env, formatting) are code-split through `LazyView` and prewarmed
on idle. Both screens are wrapped in `withViewTransition()` for switches.

Persistence mechanics: `+page.svelte` subscribes a dozen stores to `persistUiState()` (debounced
300 ms, fire-and-forget) and flushes synchronously on window close (`onCloseRequested` -
`beforeunload` is explicitly not used because writes are async IPC).

**Every view must survive a restart on itself.** Whatever the user was looking at when the app was
closed is what the app reopens on: the workflow step, but also any tool view that takes over the
main area (Terminal, Commands, Env, Formatting, and whatever comes next). A new view is only
finished once its "is it open" flag is persisted, which means the four layers, all of them:

1. the store flag in `src/lib/stores/ui.ts`;
2. the field on `ProjectUiState` in `src/lib/services/ui-state-service.ts`;
3. the snapshot and the restore in `snapshotCurrentProject()` / `applyProjectState()`
   (`src/lib/stores/view-state.ts`);
4. the `#[serde(default)]` field on the Rust `ProjectUiState` (`commands/ui_state.rs`), plus a
   `subscribe(() => persistUiState())` in `+page.svelte`.

Skipping any one of them reads as "the app forgot where I was".

The one deliberate exception is the detached editor windows (below): they are a comfort for a
second screen, and they are not reopened on the next launch.

### Workflow tabs and tools

The workflow tabs are **user-configurable data**, not a hardcoded list: `settings.workflowTabs`
(order + enabled per tab, defaults in `DEFAULT_WF_TABS`, `src/lib/utils/home/workflow-tabs.ts`),
rendered by `Workspace.svelte`. The agent tab is hidden entirely when `settings.aiEnabled` is
false (the AI master switch).

The sidebar bottom has two buttons: a dedicated **Terminal** toggle and a **Tools** button that
opens `ToolsPanel.svelte` (`src/lib/components/layout/`), listing the non-terminal tools as
cards. The tool that takes over the main area is one of terminal, commands, env, formatting -
four mutually exclusive flags in `stores/ui.ts`, set through `showTool()`, never directly (a
write-silent wrapper keeps unchanged values from notifying, which would tear xterm instances
down for nothing).

- Adding a tool: an entry in the `TOOLS` array in `ToolsPanel.svelte` (id, icon, i18n keys under
  `tools.*`), a flag in `stores/ui.ts` with the persistence layers above, and a case in
  `selectTool()` in `Workspace.svelte`.

The panel closes on selection, on the close button, and on a click outside.

### Agent system

Cairn does not run agents and keeps no agent engine. The Agent step **launches an external
coding CLI, as-is, in an embedded PTY terminal**, and remembers only what is needed to relaunch
it. There is no message sending, no model selection, no transcript storage.

- **Providers** are the 12 CLIs of the registry `CLI_PROVIDERS` (`commands/cli_providers.rs`,
  mirrored by `cli-provider-service.ts`): claude-code, codex, gemini, opencode, copilot,
  antigravity, vibe, cursor, amp, goose, qwen, droid. Each carries its binary name, its resume
  argv shape, and `installed`/`configured` flags; `installed` gates the picker cards.
- **A run is a terminal.** The frontend mints the terminal id and calls `terminal_create` with
  `args` (the resolved binary launched directly, never through a shell). Output arrives as
  `terminal-output` / `terminal-exit` events like any terminal. Stopping means killing the
  terminal; because a CLI spawns children, the UI first asks `terminal_has_children` and confirms.
- **Conversations are metadata only** (`commands/conversations.rs`): an `index.json` per scope
  (instance or project) with id, title, cli, sessionId, sessionConfirmed, cwd, pinned, archived.
  The transcript lives wherever the CLI itself keeps it; Cairn never reads it.
- **Resume** relaunches the CLI with its resume argv (`utils/agent/cli-launch.ts`). Some CLIs
  accept a session id imposed at launch; the rest mint their own, and `discover_cli_session`
  finds it afterwards by reading the CLI's own session store (for Claude Code:
  `~/.claude/projects/<slug>/*.jsonl` matching the cwd, newer than the PTY spawn).
  `sessionConfirmed` in the index means the session was seen on disk.
- `lastCli` (per project, persisted) is the CLI the Agent step last started, so the picker
  offers it first. Restoring the app never auto-spawns a CLI.
- **AI assists** (commit message, test fix, MR description, CI fix, review guide, review
  comment, ticket plan) are the exception: headless one-shot model calls with a JSON schema
  (`commands/oneshot.rs`, `run_oneshot`), only for CLIs that can force a schema (claude-code,
  codex). The assist CLI is hardcoded to `CLAUDE_CODE` in `utils/home/ai-features.ts`; prompts
  are editable templates in the Features settings. The agent-draft store lets other steps hand a
  composed prompt to the Agent step without pressing Enter.

### MCP, skills and native agents

Cairn edits the configuration files and directories the CLIs themselves read - it keeps none of
its own:

- **MCP** (`commands/mcp.rs`): CRUD of MCP server declarations across each CLI's own config
  file (JSON and TOML dialects), scopes user / local (Claude Code only) / project (committed
  with the repo), plus import/export and a probe (`test_mcp_server`).
- **Skills** (`commands/skills.rs`): `SKILL.md` files in each provider's skill roots
  (`~/.claude/skills`, `~/.agents/skills`, project `.claude/skills`, ...). A skill shared by
  several roots is written once, deduplicated.
- **Native agents** (`commands/native_agents.rs`): subagent markdown files with frontmatter in
  the directories CLIs read (`~/.claude/agents`, project `.claude/agents`, ...).

`reached_providers(kind, scope, project_path, targets)` answers "which CLIs read this path" and
powers the reach display in the UI.

### Conversation history

Conversations are scoped like terminals: per instance and per project
(`stores/conversation.ts`, `ConversationHistoryPanel.svelte` in the Agent view). Each scope is
an `index.json`; opening the panel reads that one small file.

The panel has two collapsible groups, project first then instance. Archiving is a filter over
those same two groups (Active / Archived), never a third list mixed into them. Each group
orders itself: pinned first, then most recently opened (`lastOpenedAt`, falling back to
`createdAt`). Order is never manual - dragging a
conversation only moves it between the two scopes (see the drag and drop conventions above).

Liveness is derived, not stored: a conversation is live while a PTY terminal is attached to it
(`conversationTerminals` in the store), busy per launch counter (`conversationRuns`), and a CLI
that exited on its own is caught by the terminal manager's exit event and shown as an "exited
with code N" banner with Restart / Archive. There is no persisted busy/done state - the old
`agent-activity.json` is gone.

What a live conversation is *doing* comes from the CLI itself, never from its output. Claude Code
is launched with an extra `--settings` layer of hooks (`statusArgv` in `cli-launch.ts`, merged with
the user's settings, never written to them). A hook runs in its own session without the PTY as
controlling terminal, so it cannot print into the conversation: it writes `working` / `waiting` /
`done` into the file named by `CAIRN_AGENT_SIGNAL`, which `terminal_create` sets for every
`conversation:*` terminal. `commands/agent_signals.rs` keeps one non-recursive watch on that
directory and emits `agent-signal`. `stores/agent-status.ts` turns signals, keystrokes, output
silence and exits into a status per conversation (transitions in `utils/agent/agent-status.ts`),
clears the user's turn once that conversation is on screen in a focused window, and sends an OS
notification (`agentNotifications` setting) when the window is not focused. Window focus comes from
Tauri's `onFocusChanged`: WebKitGTK fires no DOM `blur` when another application takes the focus.

Notifications go through `notify_agent`, not the notification plugin's `sendNotification`: on Linux
the plugin's JS relies on replacing `window.Notification`, which WebKitGTK ignores, and its Rust
side sends over a D-Bus connection it drops at once - GNOME Shell withdraws a notification tied to
an application (any process with a window) as soon as its sender leaves the bus. `notify_agent`
holds the connection with notify-rust until the notification is clicked or closed; a click focuses
the window and emits `agent-notification-opened`, which lands on that conversation. The plugin is
still used for the permission checks, and for sending on macOS and Windows.
The status is in memory only - a restart relaunches no CLI. It feeds the home Activity section, the
project card badge and the dots of the conversation list. A CLI without hooks only shows "running"
and "exited".

### Terminal system

`commands/terminal.rs` wraps `portable-pty`. Sessions are keyed by the frontend's session id in
`TerminalState`.

- `terminal_create(id, cwd, cols, rows, command, args, env)`: with `args`, a resolved binary is
  launched directly (this is how agent CLIs are started - no shell quoting); with `command`, a
  script runs through the login shell (`$SHELL -lc`). `TERM=xterm-256color` and a UTF-8 locale
  are forced.
- Output is read on a thread, decoded UTF-8-safely, batched (16 KB or 16 ms) and emitted as
  `terminal-output` `{id, data}`; `terminal-exit` `{id, exitCode}` on exit.
- Terminals are scoped per instance (`terminalSessions`, keyed `projectId:instanceId`) and per
  project (`projectTerminals`). A project terminal is a single shared PTY reachable from every
  instance; its `cwd` is the worktree of the instance that created it. Both scopes have a main
  pane and one split. Agent terminals live outside both lists - they never appear in
  `terminal-state.json` or the Terminal tool.
- Dragging between scopes moves a terminal from one scope to the other without restarting its
  PTY (`shareTerminal` / `unshareTerminal` in `stores/terminal.ts`).
- On launch `initTerminals()` closes everything once; command terminals (spawned by custom
  commands) are not restored. On app exit `shutdown` kills all children by process group.

### Detached editor windows

An editor tab can be taken out into a window of its own (`editor-<n>`, route `src/routes/editor`),
from the tab menu, the button beside the file path, the `detachTab` shortcut, or by dragging the
tab out of the app. Such a window runs `DetachedEditor.svelte`: one pane of tabs, no split, where
each tab carries its own scope (`TabScope`: project, instance, worktree), so tabs of several
projects and external files sit side by side. The main editor stays single-scope.

- **The route runs nothing of `+page.svelte`.** `initTerminals()` there kills every PTY of the
  app, and the main page also writes `ui-state.json` and watches integrations. The route loads
  settings, projects and the language-server listeners only, and removes `#boot-splash` itself.
- **A file lives in one window.** `commands/editor_windows.rs` keeps a registry of what each window
  holds (synced by every window, main included) and focuses the owner instead of opening a file
  twice. Tabs move whole, unsaved buffer included (`TabPayload`, `utils/files/tab-transfer.ts`),
  never written on the way; a tab moving into the main window switches it to the tab's project.
- **Dragging a tab out** (`utils/files/tab-window-drag.ts`): the source window keeps the pointer
  outside its bounds, and `editor_window_at_cursor` finds the window under it. Wayland exposes no
  window or cursor positions, so there the drag is handed to GTK carrying a `cairn-tab:<token>`
  URI - never the real file, which a file manager would copy - and the tab only moves when a Cairn
  window claims the token. The HTML5 drag and drop rule above still holds: this is the OS drag.
- **Shared backend state is per window.** The LSP counts the holders of an open document
  (`claim_doc` / `release_doc`), and `watch_dirs` keeps one directory set per window and watches
  their union. Settings saved in one window are broadcast (`settings-changed`) and reloaded by the
  others. `cli-open` goes to `main` only.
- **Closing.** Closing the main window asks once about every unsaved buffer of every window, then
  closes the detached ones; a detached window closed on its own writes its tabs first, and closes
  itself once its last tab is gone.

### Filesystem watcher

`commands/fs_watch.rs` watches **per directory, not per repository**: only the directories
expanded in the file tree and the parents of open tabs. Events are debounced 300 ms in one
background thread and classified - a change under `.git` to index/HEAD/refs/rebase-* is a
git-only change, anything else is a tree change; other `.git` noise is dropped. One event:
`fs-changed` `{worktree, gitOnly}`.

### Language servers

`commands/lsp/` installs, updates and starts language servers from a catalogue
(`registry.rs`); one server process serves every worktree of a repository. The frontend talks
to it through `lsp_did_open` ... `lsp_rename` commands and receives `lsp-status`,
`lsp-manager` and `lsp-diagnostics-batch` (diagnostics coalesced into one event per 16 ms
frame by `commands/coalesce.rs`). An idle reaper shuts unused servers down. Custom servers the
user brings themselves are run but never installed or updated. `commands/toolchain.rs` is the
shared plumbing for package-manager-installed binaries (locate, owning manager, version
compare) - used by LSP and formatting alike.

### Formatters

`commands/formatting/` mirrors the LSP design: a formatter catalogue (`catalog.rs`), adapters,
per-project config in `formatting.json`, `format_document`, repo formatter detection, and
install/update/uninstall through package managers.

### Integrations

`commands/integrations/` connects GitLab, GitHub and Jira behind capability-named commands
(`tracker_*`, `forge_*`, `ci_*`) over a normalized model mirrored in `src/lib/types/integrations.ts`.
Connections and their tokens live per scope (global / project); tokens are stored encrypted
(`secrets.rs`). A watcher polls the MRs and pipelines of watched instances
(`integrationsPollSeconds` setting) and emits one `integration-update` event the frontend
funnels through `stores/integrations.ts`.

### Test runners

`commands/tests/` runs a project's test suite inside a worktree. The frontend composes the
command; Rust parses its output through a runner adapter (`runners/{cargo,go,jest,pytest,vitest}.rs`)
chosen by `runner_id`. Runs are keyed by a frontend-minted `run_id`, so two instances can test
concurrently; results stream as `test-output`. State persists in `test-state.json`.

### The cairn CLI

The app ships a `cairn` shell command: `cli/` is a tiny launcher that resolves and execs the
app binary; `scripts/build-cli-launcher.sh` builds it per target into `src-tauri/binaries/`
(declared as `externalBin` in `tauri.conf.json`). `commands/cli.rs` installs it as a symlink in
`/usr/local/bin` (fallback `~/.local/bin`), parses `cairn <paths>` / `cairn clone <url>` /
`cairn .` into a `CliRequest`, and hands it to the running app - through the `cli-open` event
when a second launch hits the single-instance lock, otherwise through `PendingCliPaths` until
the frontend drains it.

### Changelog

**Every user-visible change is logged in the changelog, in the same commit that makes it.** A new
feature, a changed behaviour, a fixed bug, a removed capability: each one adds a change to the entry
of the version being developed (the topmost one, the one whose `date` is still empty), in both `en`
and `fr`. A feature is not finished until its line is there. Only work the user cannot perceive -
refactors, internal plumbing, CI, tests, docs - stays out.

The content lives in `src/lib/data/changelog.json`, pure data with no code around it;
`src/lib/data/changelog.ts` only holds the types, `CHANGE_KINDS` and `localized()`, and re-exports the
JSON as `CHANGELOG`. The home screen renders it in a **What's new** section
(`home/ChangelogSection.svelte`): the left panel is a timeline of versions, the right one shows the
selected release. Every release adds one entry at the top of the JSON, newest first, with a flat
`changes` list; each change carries its kind (`added` / `changed` / `fixed` / `removed`) and the view
groups them into sections following `CHANGE_KINDS` - an empty kind renders no section, so never add a
placeholder entry to fill one. Entry text is not in `en.ts` / `fr.ts`: it
carries its own `{ en, fr }` pair resolved by `localized()`, so a release note never leaves a dangling
i18n key behind. Leave `date` empty while the version is still in development - the UI shows it as
"In development", and the entry whose `version` matches `__APP_VERSION__` is flagged as installed.

### Shortcuts

Bindings are declared once in `SHORTCUT_DEFS` (`stores/shortcuts.ts`) - around 60 ids in six
groups (files, editor, tabs, tree, app, view), with user overrides stored in settings. The `app`
group holds what the *workspace* owns rather than the editor: fullscreen, the tools panel, the
tools themselves, going home, reloading. Those ids are listed in `APP_ACTIONS` in `Workspace.svelte`
and handled by `runAction()`, which is also what the command palette calls; anything not in that
list falls through to `FilesView.executeAction()`. A new command therefore needs a `ShortcutId`, a
def with its default binding, the `shortcuts.defs.*` i18n pair, and a case in one of those two switches.

### Settings

`CairnSettings` is defined in both Rust (`commands/settings.rs`) and TypeScript
(`services/settings-service.ts`) - keep them in sync when adding fields. Default values must be
declared on both sides. The TS store (`stores/settings.ts`) merges loaded values with `DEFAULTS`
and back-fills missing workflow tabs, so new fields never break existing saved configs.
Notable fields: `aiEnabled` (master switch that hides the whole Agent step), `workflowTabs`
(user-arranged workflow tabs), `gitProfiles` (author identities applied to a worktree),
`languageServers` / `customLanguageServers` (catalogue overrides and user-brought servers).

## Tests

- **Frontend**: Vitest (jsdom), 200+ files in two places. Colocated `*.test.ts` next to the code
  in `src/lib` (stores, services, utils, a few components) and behaviour suites in `src/test/`:
  `parcours.test.ts` drives whole user paths through the real invoke() frontier against a
  `fake-backend.ts` (an in-memory `~/.cairn`), `ipc-contract.test.ts` pins the IPC boundary,
  `view-persistence` tests pin the restore behaviour. Shared stubs live in `src/test/stubs/`.
- Coverage thresholds (statements 72 / branches 58 / functions 69 / lines 70) run with
  `bun run test:coverage`.
- **Rust**: `cargo test` from `src-tauri/`, unit tests inline in the same file under
  `#[cfg(test)] mod tests` - nearly every commands file has them. There is no integration-test
  target.
- `src/lib/i18n/parity.test.ts` fails the suite when `en.ts` and `fr.ts` drift apart.

## CI

`.github/workflows/release.yml` builds a tag into a five-target release matrix (linux x86_64
and aarch64, macOS universal, Windows x86_64 and aarch64) after checking the version against
`package.json`. `.github/workflows/warm-cache.yml` runs the same matrix on `main` to keep the
Rust caches warm - its matrix must stay identical to release's.

## Key conventions

- Svelte 5 with runes is available and newer components (Agent view, Home) use it
  (`$props()`, `$state()`); the bulk of the codebase still uses Svelte 4 store patterns
  (`writable`, `derived`, `createEventDispatcher`). Match the file you are in.
- Components dispatch events up with `createEventDispatcher`; they never import stores directly when avoidable.
- All Tauri IPC uses camelCase on the TS side and snake_case on the Rust side - `invoke("some_command", { myParam })` maps to `#[tauri::command] fn some_command(my_param: ...)`.
- i18n keys live in `src/lib/i18n/en.ts` and `fr.ts`. Use `t('key')` from `$lib/i18n` for any user-visible string. Keys are typed, so a bad key fails `svelte-check`.

## UI conventions

### Loading states

Never render a textual loading message ("Loading...", "Chargement...", "saving..."). Pending
states are always shown with an animation:

- **Inline / action pending** (buttons, list rows, tree nodes, status bar): `Spinner.svelte`.
  Size it to the surrounding text (`size={10}`-`{13}`). When the spinner replaces a label, put
  the meaning back with `title` / `aria-label`.
- **Content placeholder** (file tree, editor body, lists, panels that load a block of content):
  `Skeleton.svelte` (`lines`, `height`, `gap`), wrapped in a container that supplies the padding.
- **Blocking modal work**: `Spinner.svelte` centered over the dimmed body (see `CreateInstance.svelte`).

No new `loading` / `treeLoading` style i18n keys - if a key only exists to say "loading", it does
not belong in `en.ts` / `fr.ts`.

### AI generate buttons

Every button that fills a field from a model looks and behaves the same, the reference being the
commit message in the git panel (`GitView.svelte`, also `MergeRequestForm.svelte`):

- **Label**: `t('git.generateWithAi')` ("Generate" / "Générer") with the `sparkles` icon, and
  `t('git.aiCancel')` while it runs, the same button cancelling. No feature-specific wording
  ("Name with AI", "Write with AI"...).
- **Button**: the global `ai-btn` class from `app.css`, plus `is-busy` while running. No local
  button style and no `Spinner` - `is-busy` is the pending animation.
- **Field**: the target field is wrapped in `<div class="ai-field" class:is-generating={...}>`,
  disabled with `aria-busy` during the run, with an `ai-sweep` layer (and `ai-ghost` lines while it
  is still empty). The start and the result are announced through an `sr-only` live region.
- **Master switch**: the whole surface sits behind `$settings.aiEnabled`; a feature with no
  provider leaves the button disabled with a `title` saying why.

### Text selection

Interface chrome is not selectable. `body` sets `user-select: none` globally in `app.css`; only
meaningful data opts back in via the global `.selectable` class (inputs, `[contenteditable]`,
`.cm-editor` are already opted in; the terminal is deliberately not).

- Labels, buttons, tabs, headings, menu entries, counts: leave them non-selectable. Never add a
  local `user-select: none` - it is already the default.
- Useful data (commit hash, blame hash, stash name, file/worktree path, branch name, IDs, code and
  diff content): add `class="selectable"`, and place a `CopyButton.svelte` next to it whenever the
  value is a single discrete token the user would want to copy.

### Dropdowns

**Never use a native `<select>`.** Its popup is drawn by the OS, so it ignores the app's theme,
its own colours and fonts, and it cannot be positioned - inside a scrolling panel it detaches from
its trigger. Use `Select.svelte` (`src/lib/components/`) instead:

```svelte
<Select
  value={current}
  options={items.map((i) => ({ value: i.id, label: i.label }))}
  ariaLabel={t('some.label') as string}
  on:change={(e) => apply(e.detail)}
/>
```

It brings its own trigger styling, keyboard navigation and a panel positioned in fixed coordinates
so it escapes overflow containers, and it dispatches `change` with the value in `e.detail` (it also
supports `bind:value`). A wrapper around it must not redraw the border or the background - size it
with `:global(.select)` and leave the chrome alone.

A free-text field with suggestions is the exception: an `<input list=...>` with a `<datalist>` is
not a dropdown and stays native, because the value must remain anything the user types.

### Drag and drop

**Never use the HTML5 drag and drop API** (`draggable`, `dragstart`, `dragover`, `drop`,
`dataTransfer`). The webview starts its own native drag on the gesture and swallows it, so the
handlers either never fire or fire inconsistently. Every drag in the app - editor tabs, terminals,
the project list, conversations, workflow tabs - is built on pointer events instead:

- `pointerdown`: bail out on interactive children (`closest('.some-button, input')`), record the
  start position, `setPointerCapture(e.pointerId)`, and `preventDefault()`.
- `pointermove`: do nothing until the pointer travelled past a ~6px threshold, then flag the drag
  as active and add `document.body.classList.add('dragging')` for the `grabbing` cursor.
- `pointerup`: commit the move, clear the state, remove the `dragging` class.
- Guard the click handler with a `didDrag` flag so a drag never doubles as a selection, and reset
  that flag inside the click handler.

**The element that calls `setPointerCapture` must be the one carrying `onclick`.** While a pointer
is captured, WebKit dispatches the compatibility mouse events to the capturing element, so a click
handler sitting on a *child* (a nested `<button>`, for instance) never fires - the row looks dead.
Put `role="button"`, `tabindex="0"`, `onclick` and `onkeydown` on the same element as the pointer
handlers, and keep inner buttons for their own actions only (they stop propagation).

Shared helpers exist and should be reused: `utils/files/files-tab-drag.ts` (`computeTabInsertIndex`,
used by terminal, workspace and editor tab drags), `utils/files/files-drag-ghost.ts` (the drag
image), `utils/files/files-editor-drop.ts` (pane drop resolution).

### Markdown files

`.md` files render inline in the editor (`utils/editor/editor-markdown-wysiwyg.ts`): headings,
emphasis, links, rules, bullets, task checkboxes, images and tables are decorated and their markup
is hidden, except on the lines the selection touches, where the raw source is revealed for editing.
There is no separate preview pane - the document is always editable. Mermaid blocks render through
`editor-mermaid-doc.ts`. HTML outside the editor (review guide, discussions) goes through
`utils/integrations/markdown.ts`, which renders `marked` output through `sanitizeHtml`.

Links are styled and carry their destination in a `data-cm-md-href` attribute; a plain click stays
an ordinary text click so the document remains editable, and shift-click follows the link.
`parseLinkTarget` decides how: http/https/mailto go to the system browser through `opener-service`,
`#anchor` scrolls to the matching heading in the current document, and a relative path is resolved
against the edited file and opened as a tab by `FilesView`, jumping to its anchor once the content
is loaded. Any other scheme is ignored.

Inline HTML is deliberately limited to `<img>` (parsed by `parseHtmlImage`); every other tag is
left as raw text rather than injected, and an image `src` carrying a scheme outside
http/https/data/blob is dropped. Fence lines of a code block are removed by the block field and
replaced by a language badge, so no empty code-coloured line is left behind.

Tables need GFM, so `resolveLanguageExtension` builds markdown on `markdownLanguage`. Local images
resolve against the edited file's directory and are served through Tauri's asset protocol
(`convertFileSrc`), so `CodeEditor` receives the file path via `docPath`. The editor's file
content itself is served by the custom `cairn://` scheme (`commands/file_protocol.rs`): raw bytes
with an ETag, so versioned writes can refuse to overwrite a file that changed on disk
(`SaveConflict.svelte`).

Two rules matter when touching that file:

- Decorations are collected in an array and sorted by `Decoration.set(ranges, true)`. A
  `RangeSetBuilder` cannot be used: tree iteration yields a parent before its children, so ranges
  arrive unsorted, the builder throws, and CodeMirror silently tears down the plugin - which reads
  as "the markdown rendering randomly disappears".
- Anything replacing a line break (tables) must come from a `StateField`, never from a
  `ViewPlugin`. Inline decorations stay in the plugin so they remain viewport-scoped.