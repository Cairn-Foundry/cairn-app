# AI Providers, Configuration and Interactions (v0.14.0)

Goal: make the whole AI layer real and configurable. Today only the Claude Code CLI
is wired (hardcoded `claude -p` spawn), the Providers / Agents settings pages are
non-persisted mockups, and a conversation exposes no model, effort, usage, cost or
context information. v0.14.0 turns this into an operational multi-provider system
with a full UI/UX pass on both the Home configuration side and the workspace Agent
view.

## Implementation status

Implemented (2026-08-08): phases 1 to 5, plus a v2 fidelity-and-polish pass.

The v2 pass drives the Claude CLI through its stream-json control protocol
(`--input-format stream-json --permission-prompt-tool stdio`), verified against
the installed CLI (2.1.226):

- Interactive tool permissions in-app: `can_use_tool` control requests render as
  a card (Allow / Always allow / Deny); the answer goes back through stdin via
  the `respond_permission` command. `ExitPlanMode` is special-cased as a plan
  approval card.
- Effort uses the CLI's real `--effort` flag (low / medium / high / xhigh /
  max); permission modes mirror the CLI's real choices (auto, acceptEdits,
  plan, manual, dontAsk, bypassPermissions).
- Subscription quota comes from the CLI's `rate_limit_event` stream events and
  is shown near the composer only when the limit is hit (with reset time).
- `@` completes both custom agents and worktree files (quick_search).
- UI pass: composer options are discreet chips with popover menus, per-answer
  telemetry is a single muted line, the context gauge is a chip next to the
  input.

The remaining CLI agents landed after it (2026-08-10): Codex CLI, Copilot CLI,
Antigravity CLI and Mistral Vibe each have a provider in the registry, so all
five agentic CLIs are drivable. They are shipped `available` rather than
`active`: enabling one is a deliberate act in Settings > Agents > Providers,
since offering an agent that is not installed would only produce a "not found"
the first time it is picked.

Each is driven through its own headless protocol, and the differences are real:

| | resume | stream | effort | permissions |
|---|---|---|---|---|
| Claude Code | `--resume <id>` | stream-json + control protocol | `--effort` | `--permission-mode`, answered in-app |
| Codex | `exec resume <id>` | `--json` thread items | `-c model_reasoning_effort` | `--sandbox` |
| Antigravity | `--conversation <id>` | `--output-format stream-json` | `--effort` | `--dangerously-skip-permissions` |
| Mistral Vibe | `--resume <id>` | `--output streaming` | none | `--agent` profile |
| GitHub Copilot | none | plain text | none | `--allow-all-tools` / tool lists |

Consequences that shaped the code:

- Only Claude Code can be asked mid-run whether a tool may proceed, so the
  permission card stays its own. The others are told up front what they may do.
- Copilot exposes no session id and no structured output: its conversation is
  replayed into the prompt (`keepsSession: false` in the catalogue, and
  `cli_common::with_transcript` in Rust), and its answer streams as plain text
  with no tool activity.
- Vibe prints no session id in programmatic mode, so the id is read back from
  the session directory the run created under `~/.vibe/logs/session`.
- The new CLIs ship no model list. The ids move faster than Cairn releases and a
  wrong one is a failed run, so `--model` is only passed once the user pins a
  model - by hand, or from whatever the provider reports.

Remaining deviations:

- The Linux no-secret-service fallback stores the key in `~/.cairn/ai-keys.json`
  with 0600 permissions, not encrypted; the UI shows a warning when the fallback
  is in use.
- `init` events (tool and agent inventory of a run) are emitted by the backend
  but not yet surfaced in the UI (reserved).
- `@`-agent mentions and `/`-command completion still resolve against
  `.claude/` only, so they stay a Claude Code affordance.

## Current state (audit)

- `src-tauri/src/commands/agent/`: one provider trait (`AgentProvider::send`) taking
  only message / cwd / session / env. `ClaudeCliProvider` spawns
  `claude -p <msg> --output-format stream-json --verbose [--resume id]`. It parses
  only `assistant` events (text + tool_use); `system`/`result` events - which carry
  model, cost, token usage, duration, permission denials - are discarded. No
  model/effort/agents/permission-mode flags are passed. Errors from stderr are lost
  (`Stdio::null()`).
- `src/lib/components/home/agents/ProvidersTab.svelte`: full config UI (API key,
  base URL, model, temperature, max tokens, timeout, streaming) but state is local
  to the component - nothing saved, nothing read anywhere else.
- `src/lib/components/home/agents/AgentsTab.svelte`: custom agents mockup, same
  situation (in-memory only).
- `src/lib/components/home/agents/providers-data.ts`: static catalog of 9 providers
  with stale model lists (Claude 4.x, GPT-4o era) and hardcoded context windows.
- `src/lib/components/agent/AgentView.svelte`: per-conversation provider picker
  exists and `providerId` is persisted on the conversation, but every id resolves to
  the same CLI behaviour; unknown ids fail in Rust.
- No secret storage: API keys have nowhere safe to live today.

## Scope decisions

- **Provider tiers.** Two kinds of providers, treated explicitly:
  - *CLI agent providers* (Claude Code CLI first-class; Codex CLI, Copilot CLI,
    Mistral Vibe as follow-ups): full agentic loop, tools, sessions. These are the
    real workhorses.
  - *API providers* (Anthropic, OpenAI, Mistral, Gemini, Ollama): direct chat
    completion, no tools in v1 - useful for quick Q&A on the codebase. Marked as
    "chat only" in the UI so expectations are clear.
  Providers whose integration does not land in 0.14.0 stay visible but flagged
  `coming-soon` (no fake toggles).
- **Claude Code CLI is the reference integration**: it gets the deepest feature
  set (model, effort, permission mode, agents/commands mention, usage, context
  window, cost).

## Phase 1 - Configuration model and persistence

New storage + settings plumbing; everything later builds on it.

1. **Rust: `ai-providers.json`** in `~/.cairn/` (path helper in `storage.rs`).
   Struct `AiProvidersConfig` in a new `commands/agent/config.rs`:
   - `providers: HashMap<String, ProviderSettings>` with `enabled`, `baseUrl`,
     `model`, `customModel`, `temperature`, `maxTokens`, `timeout`, `streaming`,
     plus CLI-specific: `binaryPath` (override), `effort`, `permissionMode`,
     `extraArgs`.
   - `defaultProviderId: String` (used for new conversations).
   - All fields `#[serde(default)]`.
   Commands `get_ai_providers_config` / `save_ai_providers_config` (async),
   registered in `lib.rs` + `commands/mod.rs`.
2. **API key storage.** Keys never go into the JSON in clear. Use the OS keychain
   via the `keyring` crate (`service = "cairn"`, `account = provider id`).
   Commands: `set_provider_api_key`, `has_provider_api_key`,
   `delete_provider_api_key`. The UI only ever knows "a key is set", never reads
   it back.
3. **TS: `ai-provider-service.ts`** mirroring the types; new store
   `stores/ai-providers.ts` (load once, merge with defaults from
   `providers-data.ts`, debounced save). `providers-data.ts` stays the static
   catalog (defs) but its model lists are refreshed to current models (Claude 4.5/5
   family, GPT-5.x, Gemini 2.5/3, current Mistral) and each CLI provider gains
   `kind: 'cli' | 'api'`, `binaryName`, and a probe hint.
4. **Provider availability probe.** Command `probe_provider(provider_id)`:
   - CLI providers: `which <binary>` + `--version` (async, cached in the store).
   - API providers: key present + optional lightweight endpoint ping.
   - Ollama: GET `/api/tags` to list actually installed models (replaces the
     hardcoded list when reachable).
   Result drives status badges ("Installed 2.1.12", "Not found", "Key missing").

## Phase 2 - Backend provider layer

1. **Extend `AgentProvider` trait.** Replace the positional args with a
   `SendRequest` struct: message, working_dir, session_id, run_id, env, plus
   `options: ProviderRunOptions { model, effort, permission_mode, system_prompt,
   temperature, max_tokens, timeout, streaming, base_url, extra_args }`. `send_message`
   loads the persisted config, merges per-conversation overrides sent from the
   frontend, and passes the result down.
2. **Richer event protocol.** Rename nothing wire-visible yet, but extend
   `AgentOutputEvent` with `kind` payloads (still one `claude-output` channel):
   - `usage`: input/output/cache tokens, context window used, model - parsed from
     Claude CLI `result` and `system:init` events.
   - `cost`: total cost USD, duration, num_turns - from the `result` event.
   - `error`: structured (spawn failure vs CLI error vs non-zero exit), including
     captured stderr (switch to `Stdio::piped()` with a drain thread).
   - `thinking`: thinking blocks (parsed but collapsible in UI).
   - `tool_result`: tool completion status so the UI can close the activity row.
3. **Claude CLI provider upgrades** (`claude_cli.rs`):
   - Pass `--model`, `--permission-mode`, `--append-system-prompt` when set.
   - Effort via env/flag when the CLI supports it.
   - Parse `system:init` (session id, model, tools, agents list), `result`
     (usage + cost), and stream deltas if `--include-partial-messages` is enabled
     (streaming toggle).
   - `binaryPath` override instead of relying on PATH.
4. **Generic API provider** (`providers/api_chat.rs`): one implementation for
   OpenAI-compatible endpoints (OpenAI, Mistral, Ollama, custom base URL) +
   Anthropic Messages + Gemini. Streaming SSE, emits `assistant` deltas and a
   final `usage` event. Chat only: no tool execution in v1. Uses the keychain for
   the key, `reqwest` for HTTP.
5. **Quota / subscription visibility.** For Claude Code: run `claude usage`-style
   introspection if available, otherwise surface the rate-limit / overage info the
   CLI emits in `result` events. Command `get_provider_quota(provider_id)` with a
   best-effort result (`unsupported` is a valid answer, UI hides the block).
6. **Registry.** `ProviderRegistry::new()` builds from the catalog: CLI providers
   with their binary, API providers through `api_chat`. Unknown id error remains.

## Phase 3 - Home configuration UI/UX pass

1. **ProvidersTab becomes real**: bind to the `ai-providers` store; save on change
   (debounced); API key field writes to keychain and then shows a "key set"
   masked state with a Replace / Remove action; status badge from the probe
   (Installed / Not found / Key missing / Chat only / Coming soon); a "Test"
   button running the probe on demand with `Spinner`; "Default provider" star in
   the list. Remove fake toggles on providers that cannot work yet.
2. **Per-provider layout cleanup**: group fields into "Connection", "Model",
   "Generation" sections; CLI providers show binary path + detected version +
   permission mode default + effort default instead of temperature/streaming
   when not applicable. Context window hint stays, driven by catalog data.
3. **AgentsTab becomes real (custom agents)**: persist to `~/.cairn/agents.json`
   (`get_custom_agents` / `save_custom_agents`); an agent = name, description,
   color, provider, model, system prompt, optional param overrides. These agents
   become mentionable in the Agent view (Phase 4). Empty state with a proper CTA.
4. **QoL on the whole settings area**: consistent section headers, keyboard-safe
   toggles (already ok), unsaved-state never exists (autosave), i18n for every
   new string in `en.ts` / `fr.ts`.

## Phase 4 - Agent view (workspace) UI/UX pass

1. **Composer toolbar.** Under the input: provider picker (existing), plus
   - model picker (models of the selected provider; "default" = provider config),
   - effort picker (low / medium / high) where supported,
   - permission mode picker for Claude CLI (default / acceptEdits / plan /
     bypassPermissions) with a warning style on bypass.
   Selections are per conversation and persisted on its metadata (like
   `providerId` today).
2. **Mentions and commands in the input.**
   - `@agent-name` mentions a custom agent (from Phase 3): injects its system
     prompt / provider override for that message; autocomplete popup on `@`.
   - `/command` autocomplete: list the project's Claude commands
     (`.claude/commands/*.md`, plus global `~/.claude/commands`), send as-is to
     the CLI which resolves them. Popup on `/` at start of input.
3. **Run telemetry.** Each assistant answer gets a footer chip row: model used,
   duration, input/output tokens, cost when known. Data comes from the `usage` /
   `cost` events keyed by `runId`, stored on the conversation message so it
   survives restart.
4. **Context window gauge.** Per conversation: small bar or percentage near the
   header showing tokens used vs the model's context window (from `usage` events;
   window size from catalog or `system:init`). Warning color above ~80%.
5. **Quota display.** When `get_provider_quota` supports the provider, show the
   subscription usage (e.g. 5h window / weekly limits for Claude) in a popover on
   the provider chip.
6. **Error surfacing.** Structured `error` events render as a distinct error
   bubble with the real stderr message and a Retry action - no more silent
   `[error: ...]` lines.
7. **QoL pass**: collapsible thinking blocks; tool activity rows that resolve
   (spinner -> check) using `tool_result`; copy button on code blocks and on the
   whole answer; stop button state per conversation (exists) reviewed; draft and
   scroll behaviour reviewed; empty conversation state with provider/model summary
   and quick tips.

## Phase 5 - Wrap-up

- Changelog entries (en/fr) for every user-visible item, added with each commit.
- i18n complete in `en.ts` / `fr.ts`; no "loading" keys (spinners/skeletons only).
- Tests: config merge (TS store defaults), Rust serde defaults round-trip, CLI
  event parsing (`system:init`, `result`, tool_use) with fixture lines, mention /
  command autocomplete parsing.
- Update this plan as implementation lands.

## Ordering and dependencies

1. Phase 1 (storage) -> 2 (backend) -> 3 and 4 can then proceed in parallel.
2. Inside Phase 2, Claude CLI upgrades (2.3) come before the generic API provider
   (2.4); quota (2.5) is last and best-effort.
3. Mentions/commands (4.2) depend on custom agents persistence (3.3).

## Cross-platform requirements (macOS / Windows / Linux)

Cairn ships on all three platforms; every item above must hold on each.

- **API key storage.** The `keyring` crate abstracts the three backends: macOS
  Keychain, Windows Credential Manager, Linux secret-service (GNOME Keyring /
  KWallet via DBus). Linux fallback: if no secret-service is available (headless
  or minimal WM), degrade to an encrypted-at-rest file under `~/.cairn/` with a
  clear warning in the UI rather than failing key storage entirely.
- **Binary discovery.** No shelling out to `which`: resolve CLI binaries with the
  `which` crate (or manual PATH walk) so it works on Windows too, and account for
  Windows launcher shims (`claude.cmd` / `.exe`, npm shims). `binaryPath`
  override is the escape hatch everywhere.
- **Process spawning.** On Windows, add `CREATE_NO_WINDOW` creation flags so CLI
  spawns never flash a console window; `.cmd` shims must go through `cmd /C`.
  Kill on stop must terminate the whole process tree (CLI providers spawn
  children): use a job object on Windows, process group + SIGTERM on Unix,
  instead of the current bare `child.kill()`.
- **Paths.** All config paths already flow through `storage.rs` (`~/.cairn/`
  resolved via the home dir API - works on Windows). Command discovery (4.2)
  resolves `~/.claude/commands` with the same home-dir helper, never a literal
  `~`, and joins paths with `PathBuf`.
- **Env inheritance.** CLI providers rely on the user's PATH; on macOS GUI apps
  get a reduced PATH - keep the existing env passthrough and extend the probe to
  check common install locations (`~/.local/bin`, `/opt/homebrew/bin`,
  `%APPDATA%\npm`) when plain PATH lookup fails.
- **Testing.** Probe, spawn and keychain paths get per-OS `#[cfg]` code kept in
  one module (`agent/platform.rs`) so platform differences stay in one place;
  CI builds at least compile-check the three targets.

## Out of scope for 0.14.0

- Tool execution for API providers (function calling loop) - future version.
- MCP server management UI.
- Multi-key profiles per provider, org/team accounts.
- Cost budgets / alerts (only display, no limits).
