# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Plans

Implementation plans live in `docs/plans/` (one kebab-case `.md` per subject). Read the relevant
plan before working on the feature it covers, and keep it updated as the implementation lands.

## Code style

- Do not add explanatory comments describing what the code is doing. Keep the code self-documenting and only comment when strictly necessary (e.g. a non-obvious gotcha).

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

### Text selection

Interface chrome is not selectable. `body` sets `user-select: none` globally in `app.css`; only
meaningful data opts back in via the global `.selectable` class (inputs, `[contenteditable]`,
`.cm-editor`, `.xterm` and `.diff-line .code` are already opted in).

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
the project list, conversations - is built on pointer events instead:

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

### Markdown files

`.md` files render inline in the editor (`utils/editor/editor-markdown-wysiwyg.ts`): headings,
emphasis, links, rules, bullets, task checkboxes, images and tables are decorated and their markup
is hidden, except on the lines the selection touches, where the raw source is revealed for editing.
There is no separate preview pane - the document is always editable.

Links are styled and carry their destination in a `data-cm-md-href` attribute; a plain click stays
an ordinary text click so the document remains editable, and shift-click follows the link.
`parseLinkTarget` decides how: http/https/mailto go to the system browser through `plugin-opener`
(covered by `opener:default`), `#anchor` scrolls to the matching heading in the current document,
and a relative path is resolved against the edited file and opened as a tab by `FilesView`
(`onOpenLink`), jumping to its anchor once the content is loaded. Any other scheme is ignored.

Inline HTML is deliberately limited to `<img>` (parsed by `parseHtmlImage`); every other tag is
left as raw text rather than injected, and an image `src` carrying a scheme outside
http/https/data/blob is dropped. Fence lines of a code block are removed by the block field and
replaced by a language badge, so no empty code-coloured line is left behind.

Two rules matter when touching that file:

- Decorations are collected in an array and sorted by `Decoration.set(ranges, true)`. A
  `RangeSetBuilder` cannot be used: tree iteration yields a parent before its children, so ranges
  arrive unsorted, the builder throws, and CodeMirror silently tears down the plugin - which reads
  as "the markdown rendering randomly disappears".
- Anything replacing a line break (tables) must come from a `StateField`, never from a
  `ViewPlugin`. Inline decorations stay in the plugin so they remain viewport-scoped.

Tables need GFM, so `resolveLanguageExtension` builds markdown on `markdownLanguage`. Local images
resolve against the edited file's directory and are served through Tauri's asset protocol
(`assetProtocol` in `tauri.conf.json`), so `CodeEditor` receives the file path via `docPath`.

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

### Blocking commands must be `async` (or the UI freezes)

A synchronous `#[tauri::command] fn` runs on the **main thread**, which on macOS is also the
webview/UI thread. Any command that blocks for more than a few milliseconds - shelling out to
`git` for `fetch` / `pull` / `push` / `merge` / `rebase`, cloning a repo, creating a worktree,
spawning a process - freezes the whole window while it runs: no repaint, and even a `Spinner` that
was just shown cannot animate. The symptom is "freeze without loading".

Declare any such command `pub async fn` (the body can stay ordinary blocking code - Tauri runs
`async` commands on a worker thread, off the main thread). Reserve plain `fn` for genuinely fast,
in-memory work (reading a small JSON file, string parsing). When a command feels slow in the app,
this is the first thing to check.

### Persistent storage on disk

All app data lives in `~/.cairn/`. The layout is defined in `src-tauri/src/storage.rs`:

```
~/.cairn/
  settings.json                           # global app settings (CairnSettings)
  ui-state.json                           # navigation state (screen, active project, tabs, home section...)
  ai-providers.json                       # provider configuration (no secrets)
  ai-keys.enc                             # provider API keys, encrypted (0600)
  ai-keys.secret                          # the key ai-keys.enc is encrypted with (0600)
  projects/
    projects.json                         # all registered projects
    listing.json                          # project order + folder groupings
    {project-id}/
      instances.json                      # instances for this project
      terminal-state.json                 # terminals shared across every instance of the project
      worktrees/                          # git worktrees per instance
      instances/
        {instance-id}/
          file-state.json                 # editor tabs, cursor, scroll, recent files per instance
          conversations/                  # agent conversations of this instance
            index.json                    # metadata only
            {conversation-id}.json        # messages + activity of one conversation
          terminal-state.json             # terminals of this instance (order + active one)
```

Path helpers for every location are centralized in `storage.rs`. Always add new paths there, never inline.

**API keys never go through the OS keychain.** A keychain read prompts for authorisation on every
launch of an unsigned or rebuilt binary, once per stored item, which turned opening the Providers
screen into a wall of dialogs. Keys live in `ai-keys.enc`, encrypted with ChaCha20-Poly1305 using
the secret in `ai-keys.secret`; both files are `0600`. The secret sits next to the ciphertext, so
this protects against a key leaking through a backup, a synced folder or a stray `grep` - not
against someone who already reads the home directory. Nothing stored locally could. The frontend
only ever learns whether a key exists (`get_api_key_statuses`, one call for every provider), never
the key itself. The only remaining `localStorage` use is in `src/lib/i18n/index.ts` for the locale preference (`cairn:locale`).

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

**Every view must survive a restart on itself.** Whatever the user was looking at when the app was
closed is what the app reopens on: the workflow step, but also any view that takes over the main
area (Terminal, Commands, and whatever comes next). A new view is only finished once its "is it
open" flag is persisted, which means the four layers, all of them:

1. the store flag in `src/lib/stores/ui.ts`;
2. the field on `ProjectUiState` in `src/lib/services/ui-state-service.ts`;
3. the snapshot and the restore in `snapshotCurrentProject()` / `applyProjectState()`
   (`src/lib/stores/view-state.ts`);
4. the `#[serde(default)]` field on the Rust `ProjectUiState` (`commands/ui_state.rs`), plus a
   `subscribe(() => persistUiState())` in `+page.svelte`.

Skipping any one of them reads as "the app forgot where I was".

### Tools panel

The workflow tabs occupy the top of the workspace sidebar; everything that is not a workflow step
lives in the **Tools** button pinned at the bottom. It toggles `ToolsPanel.svelte`
(`src/lib/components/layout/`), a side panel listing the available tools as cards, in the spirit of
an application store. Terminal is the only tool for now.

- Adding a tool: add an entry to the `TOOLS` array in `ToolsPanel.svelte` (id, icon, i18n keys under
  `tools.*`) and handle its id in `selectTool()` in `Workspace.svelte`. Nothing else is wired by id.
- The panel closes on selection, on the close button, on a click in the sidebar (any click that is
  not on `.tools-toggle`) and on a click outside (`clickOutside` on the `.sidebar-wrap` wrapper,
  which is `display: contents` so it stays out of the layout).

Terminals are scoped two ways: per instance (`terminalSessions`, keyed by `projectId:instanceId`)
and per project (`projectTerminals`, keyed by `projectId`). A project terminal is a single shared PTY
reachable from every instance of the project; its `cwd` is the worktree of the instance that created
it and is persisted so it respawns in the same place. Both lists are reorderable by drag, and
dragging across sections moves a terminal from one scope to the other without restarting its PTY
(`shareTerminal` / `unshareTerminal` in `stores/terminal.ts`).

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

Bindings are declared once in `SHORTCUT_DEFS` (`stores/shortcuts.ts`) and grouped. The `app` group
holds what the *workspace* owns rather than the editor: fullscreen, the tools panel, the tools
themselves, going home, reloading. Those ids are listed in `APP_ACTIONS` in `Workspace.svelte` and
handled by `runAction()`, which is also what the command palette calls; anything not in that list
falls through to `FilesView.executeAction()`. A new command therefore needs a `ShortcutId`, a def
with its default binding, the `shortcuts.defs.*` i18n pair, and a case in one of those two switches.

### Agent system

`AgentState` (Rust, `src-tauri/src/commands/agent/mod.rs`) holds a `ProviderRegistry` and a `Mutex<AgentSession>`. Claude Code CLI is the v1 provider (`providers/claude_cli.rs`). The provider runs in a spawned thread and emits `claude-output` Tauri events line-by-line to the frontend.

A run is identified by a `runId` minted by the frontend and passed to `send_message`; every
`claude-output` event carries it, and `AgentState.running` is keyed by it. Several conversations of
the same instance can therefore run at the same time, and `stop_agent(runId)` kills exactly one.
The CLI session id used for `--resume` belongs to the conversation, not to the worktree: it is
emitted back as an event with `source: 'session'`, stored on the conversation, and handed to the
next `send_message`. Rust keeps no session state of its own.

### Conversation history

Conversations are scoped like terminals: per instance and per project (`stores/conversation.ts`,
`ConversationHistoryPanel.svelte` in the Agent view). `AgentView.svelte` keeps the *live*
conversation (draft, busy, error) in component state and mirrors messages and activity into the
store, which debounces the write to disk.

Each scope is a directory: `index.json` holds one metadata entry per conversation (title, dates,
provider, pinned, archived, sessionId, message count, preview) and every transcript lives in its
own `{id}.json`. Opening the panel reads a single small file; a transcript is read only when its
conversation is opened, and a streaming answer rewrites only that one file. Search therefore runs
on title and preview, not on the full transcripts. Moving a conversation between scopes moves both
its index entry and its transcript file.

The panel has two collapsible groups, project first then instance. Archiving is a filter over those
same two groups (Active / Archived), never a third list mixed into them. Each group orders itself:
pinned first, then most recently answered (`lastMessageAt`). That timestamp only moves when the
transcript itself gains something: re-syncing an unchanged conversation - which happens every time
one is opened or left - must never reorder the list, and neither must tool activity on its own. Order is therefore never manual - dragging a conversation only moves it between the two
scopes (see the drag and drop conventions above). Each row shows the last
message under the title, plus the agent status dot: pulsing while that conversation is running,
solid while it has finished and has not been read - the same vocabulary as the instance list.
Drafts are kept per conversation, so switching conversation swaps the input content instead of
carrying it over.

Agent output is routed by a *run* record pinned to the conversation that sent the prompt
(`runs` in `AgentView.svelte`, keyed by instance), never to whatever conversation happens to be
open. The run holds the very arrays the live conversation renders, so switching conversation or
instance mid-answer keeps the reply in its own conversation; reopening a conversation whose run is
still in flight reattaches to those arrays instead of the stale file. Sending is gated per
conversation, not per instance: a conversation that is already answering refuses a second prompt,
while its siblings stay free to start their own run.

Agent status is tracked per conversation, not per instance: `agentBusyConversation` (in memory) and
`agentDoneConversation` (persisted in `agent-activity.json`) both map an instance key to the
conversation id, and the boolean `agentBusy` / `agentDone` stores consumed elsewhere are derived
from them. The done marker therefore only clears when that conversation is the one on screen, not
merely when the Agent step is opened.

### Settings

`CairnSettings` is defined in both Rust (`commands/settings.rs`) and TypeScript (`services/settings-service.ts`) — keep them in sync when adding fields. Default values must be declared on both sides. The TS store (`stores/settings.ts`) merges loaded values with `DEFAULTS` so new fields never break existing saved configs.

---

## Key conventions

- Svelte 5 with runes is available but the codebase currently uses Svelte 4 store patterns (`writable`, `derived`, `createEventDispatcher`). Match the surrounding style.
- Components dispatch events up with `createEventDispatcher`; they never import stores directly when avoidable.
- All Tauri IPC uses camelCase on the TS side and snake_case on the Rust side — `invoke("some_command", { myParam })` maps to `#[tauri::command] fn some_command(my_param: ...)`.
- i18n keys live in `src/lib/i18n/en.ts` and `fr.ts`. Use `t('key')` from `$lib/i18n` for any user-visible string.
