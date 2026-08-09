# Skills and MCP management

Two home sections added in v0.14: **Skills** and **MCP servers**. Both manage files that belong to
the coding CLIs, not to Cairn: Cairn reads and writes them where each agent already looks, so a
change made here is a change the agent sees on its next run.

## The five agents

`src-tauri/src/commands/cli_providers.rs` is the single registry: for each agent and scope it
returns the skill directories and the MCP config locations, the first of which is the one Cairn
writes to and the rest of which are read as well.

**Several agents share the same file.** `~/.agents/skills` is honoured by Codex, Copilot and Vibe;
a project's `.agents/skills` by Codex, Antigravity and Vibe; `.mcp.json` by Claude Code and
Copilot. Everything is therefore deduplicated by path before a write: one skill shared by three
agents is one directory, not three, and a file two agents read is written once. The consequence is
visible in the UI - picking one agent can hand the entry to another, which the picker says out
loud rather than explaining afterwards.

An entry is grouped by name across every agent, so the list shows one row per skill or server with
the agents that read it. When two copies disagree, the row is flagged as divergent and saving
realigns them on what the editor shows.

Because one entry can be reached through several paths, provider lists go through
`unique_providers`, which collapses them in registry order. `Vec::dedup` is not enough - it only
drops neighbours - and a repeated id reaches the UI as a duplicate key in a keyed list, which
throws and tears the component down rather than merely looking wrong.

**Only installed agents can be picked.** `is_installed` looks for a file the agent writes on its own
first run (`~/.claude.json`, `~/.codex/config.toml`, `~/.copilot/config.json`,
`~/.gemini/antigravity-cli`, `~/.vibe/config.toml`) or its binary on the PATH. Directories Cairn
itself may have created - a `skills` folder, an MCP config it was asked to write - are deliberately
never markers, or writing once would make an absent agent look installed forever. An agent that is
missing still shows the entries already written for it and can be ticked off, since removal is the
way to clean those up; only adding is refused.

## Skills

A skill is a directory holding a `SKILL.md`, plus any resource files it ships with.

| Agent      | Personal                     | Project                                            |
| ---------- | ---------------------------- | -------------------------------------------------- |
| Claude Code| `~/.claude/skills`           | `.claude/skills`                                   |
| Codex      | `~/.agents/skills`           | `.agents/skills`                                   |
| Copilot    | `~/.copilot/skills`, `~/.agents/skills` | `.github/skills`                        |
| Antigravity| `~/.gemini/config/skills`    | `.agents/skills` (also `.agent`, `_agents`, `_agent`) |
| Vibe       | `~/.vibe/skills`, `~/.agents/skills` | `.vibe/skills`, `.agents/skills`           |

Claude Code plugin skills (`{installPath}/skills/{name}/`) are listed read-only.

`SKILL.md` is markdown with YAML frontmatter, and the format is the same for all five - which is
what makes one skill serve several agents. Cairn edits the fields it knows (`name`, `description`, `when_to_use`, `allowed-tools`, `paths`, `model`, `license`,
`disable-model-invocation`) and **re-emits every other frontmatter line verbatim**, so a field Cairn
does not model - Vibe's `user-invocable`, a plugin's `argument-hint` - is never lost.

`save_skill` takes the list of agents the skill should reach. A directory already in place is
renamed rather than recreated, so the files bundled next to the manifest stay put; a root gaining
the skill receives a copy of those files, taken from the copy the editor was reading; a root that
is no longer a target is removed.

The directory name is what `/name` invokes, so renaming a skill moves every copy of its directory;
the scope selector moves it between your home and a project.

Backend: `src-tauri/src/commands/skills.rs`. Frontend: `services/skill-service.ts`,
`stores/skills.ts`, `components/home/skills/`.

## MCP servers

Three scopes - `user` (every project), `local` (one project, private, Claude Code only) and
`project` (committed with the repository) - across five agents:

| Agent       | User                                | Project                              | Shape        |
| ----------- | ----------------------------------- | ------------------------------------ | ------------ |
| Claude Code | `~/.claude.json` -> `mcpServers`    | `.mcp.json`; local: `projects[path].mcpServers` | JSON map |
| Codex       | `~/.codex/config.toml`              | `.codex/config.toml`                 | TOML table   |
| Copilot     | `~/.copilot/mcp-config.json`        | `.github/mcp.json`, `.mcp.json`      | JSON map     |
| Antigravity | `~/.gemini/config/mcp_config.json`  | `.agents/mcp_config.json`            | JSON map     |
| Vibe        | `~/.vibe/config.toml`               | `.vibe/config.toml`                  | TOML array   |

Three storage shapes and four dialects. `McpStore` says how an entry is held (a JSON object keyed
by name, a `[mcp_servers.<name>]` table, or `[[mcp_servers]]` carrying its own `name`); the dialect
says what its keys are called - `type`/`headers` for Claude and Copilot, `serverUrl` for
Antigravity, `http_headers`/`enabled` for Codex, `transport`/`auth.headers`/`disabled` for Vibe.

A TOML key can be spelled two ways and a config ships with either: Vibe starts life with
`mcp_servers = []`, an empty *inline* array rather than `[[mcp_servers]]`. An empty one is promoted
to the sectioned form both documentations show - by removing and re-adding the key, so the spacing
of `mcp_servers = []` does not survive into the header as `[[mcp_servers ]]`. A collection that
already holds inline tables keeps that style instead.

**Nothing Cairn does not model is ever dropped.** A write reads the existing entry first and keeps
every key outside the managed set, so Codex's `startup_timeout_sec` and Vibe's `sampling_enabled`
survive an edit. `~/.claude.json` is read as a generic JSON value with only the MCP keys replaced,
and the two TOML files go through `toml_edit`, so the comments and layout of a config people write
by hand come back unchanged.

Only Codex and Vibe carry an off switch on the entry itself (`enabled` / `disabled`); the others
load a server as soon as it is declared. Committed Claude servers additionally carry an approval,
which is the one switch Claude Code has: `projects[path].enabledMcpjsonServers` /
`disabledMcpjsonServers` in `~/.claude.json`.

**Testing a server** runs a real MCP handshake, in the same transport the agent would use:

- `stdio`: spawns the command, exchanges `initialize` / `notifications/initialized` /
  `tools/list` / `prompts/list` / `resources/list` over the pipes, kills the process.
- `http`: posts the same JSON-RPC to the URL, following the `mcp-session-id` header and parsing
  either a JSON or an SSE response body.
- `sse`: reachability only - the endpoint is checked for an event stream. Legacy SSE needs a
  long-lived GET to carry the answers, which a one-shot probe cannot hold open.

Backend: `src-tauri/src/commands/mcp.rs`. Frontend: `services/mcp-service.ts`, `stores/mcp.ts`,
`components/home/mcp/`.

## Shared frontend

`components/home/ProviderPicker.svelte` is the "Available to" control both sections use: a tile per
agent, the ones this scope has no place for disabled with the reason, and a line naming the agents a
shared file would reach on top of the ones picked. `ProviderChips.svelte` draws the same agents
compactly on a list row, using the brand marks already in `home/agents/provider-marks.ts` through
the id map in `utils/home/cli-providers.ts`.
