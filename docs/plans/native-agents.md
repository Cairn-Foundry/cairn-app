# Native agents

## Implementation status

Implemented (2026-08-09): all phases.

- Registry: `agent_roots` / `agent_providers_at` / `agent_reach` in
  `cli_providers.rs`, Claude Code only. `agent_capable_providers` says which
  providers have a roster at all, so the picker disables the rest with a reason.
- `commands/native_agents.rs` holds the read, the write and the migration.
  `skills.rs` gave up `split_manifest` (now taking the known-key set),
  `parse_scalar`, `write_scalar`, `write_tool_list` and `slugify` rather than
  having them copied.
- `CustomAgent`, `DiscoveredAgent`, `ExportedAgent`, their commands and their
  modals are gone; so are `utils/agent/agent-resolution.ts` and
  `utils/agent/agent-context.ts` with their tests.
- `--forward-subagent-text` is passed, `parent_agent()` attributes each event,
  and the `system` / `task_*` events drive `agent_start` / `agent_status` /
  `agent_result`.
- `AgentRun` lost `delivered` and `handedOverFrom`; `AgentThreadView` lost its
  composer and its context reset.
- The modelled frontmatter is `name`, `description`, `tools`, `model`, `effort`,
  `permissionMode`, `memory`, `skills` and `color` - the keys the definitions the
  CLI actually loads are made of. `permissionMode` is the spelling the CLI
  writes; keys canonicalise to lowercase, so the hyphenated form alone left
  every real file unparsed. Model, effort and permission mode are offered from
  what each targeted provider reports through `discover_provider`, unioned when
  a definition targets several.
- `markIdOf` became `catalogueIdOf`: the same map now reaches provider
  capabilities, not only brand marks.

Cairn stops keeping agents of its own. An agent becomes what it already is on disk for the
CLIs - a markdown definition with frontmatter, in the directory each agent reads - and Cairn
becomes the place where those definitions are listed, edited and pointed at several agents at
once, exactly as it already does for skills and MCP servers.

Cairn also stops *running* agents. It never spawns an agent process of its own, never routes a
prompt to one, never hands an answer back to a conversation. Delegation belongs to the provider:
the prompt names the agents it wants, the provider decides what to start, and Cairn watches.

What Cairn adds is therefore no longer control, it is sight:

- a subagent the provider starts is followed live, with its tools, its reasoning and its
  permission requests, instead of being a single opaque `Task` line;
- whatever that subagent hands back to its caller is rendered in the agent answer style the
  conversation already uses;
- a prompt can name several agents at once, which the old one-mention-one-run model could not
  express at all.

The persona model - `CustomAgent` in `~/.cairn/agents.json`, its provider binding, its
generation parameters, and the runs Cairn started from it - is removed, not migrated forward.

## Why

`AgentsTab` imports from `.claude/agents` and exports back to `.claude/agents`. A feature that
ships a round trip is a feature whose real artifact lives elsewhere and whose store is a copy.
The copy silently forks - `SkillsSection` has a divergence flag for exactly this and the agents
list has nothing - and it asks the user to adopt a Cairn-shaped object to get something their CLI
already offers. Every other part of Cairn reads and writes what the tools already use.

## What is deliberately lost

- `overrideParams`, `temperature`, `maxTokens`. No definition format carries them, and keeping
  them would rebuild the parallel store this change exists to delete. The provider decides.
- One agent tuned differently per provider. A definition lives in a directory; two directories
  holding different text is a divergence, reported as such, not a supported configuration.
- Import and export. Reading the files *is* the import; there is nothing left to export to.
- **Deterministic invocation.** Naming an agent used to guarantee it ran. It now expresses an
  intent the provider is free to act on, ignore, or satisfy with a different agent. This is the
  price of handing delegation back, and it is paid knowingly.
- **Agents on API providers.** A raw API provider has no delegation mechanism, so a name in the
  prompt reaches nothing. Agents become a CLI-provider feature, and the autocomplete does not
  open on a conversation talking to an API provider - offering a completion nothing consumes is
  worse than offering none.
- **Talking to an agent thread.** `AgentThreadView`'s composer goes: there is no channel into a
  subagent the provider owns.

## Phase 0 - the ground, confirmed

Answered against the installed CLIs before any code was written. The results changed three of the
assumptions below, so they are recorded here rather than left implicit.

**Which providers have a subagent roster.** One: Claude Code, `~/.claude/agents` and
`<project>/.claude/agents`, one `.md` per agent.

Vibe looks like a second and is not. Its `--agent NAME` reads `~/.vibe/agents/NAME.toml` and
selects a *permission profile* - the builtins are `default`, `plan`, `accept-edits`,
`auto-approve` - which is the same word for a different thing: it governs how the one agent asks
for approval, it is not a roster the agent delegates to. Modelling it here would put two concepts
in one list. Codex, Copilot and Antigravity are not installed on this machine and are left out
until their roster is confirmed to exist; `agent_roots` returns an empty vector for them, so they
simply never appear in the picker.

The section therefore ships for one provider, with the registry shaped for more. That is a
smaller feature than skills or MCP, and the UI must not pretend otherwise.

**Attribution.** Confirmed, and richer than expected. `--forward-subagent-text` is required -
without it the subagent's text never leaves the CLI - and with it the stream carries a full
lifecycle. From a real delegating run:

- `system` / `task_started`: `task_id`, `tool_use_id`, `subagent_type`, `description`, `prompt`,
  `task_type`. Everything a run needs to be created.
- `assistant` and `user` events produced inside the subagent carry `parent_tool_use_id` **at the
  top level of the event**, not inside `message`.
- `system` / `task_updated`: a `patch` with `status` and `end_time`.
- `system` / `task_notification`: `status`, `summary`, `output_file`, and a `usage` object with
  `total_tokens`, `tool_uses` and `duration_ms` - so a run is costed without any bookkeeping of
  our own.
- the closing `tool_result` carries the returned text.

The delegation tool is named **`Agent`**, not `Task`, and its input carries `subagent_type`,
`description`, `prompt` and `run_in_background`.

Phase 6 is therefore built on the `system` / `task_*` events rather than on sniffing the tool_use
block: they give status, usage and summary directly, and `tool_use_id` links them to the row shown
in the conversation.

The `system` / `init` event already lists the roster the CLI actually loaded (`agents`), which
`claude_cli.rs` forwards today. That is a free cross-check for the config section: a definition
Cairn shows but the CLI did not load is a definition with a problem.

**The mention text.** `@greeter say hello` delegates correctly - the CLI reads the bare `@name`
as a request for that subagent. No prose scaffolding is needed and `@` can stay in the prompt,
which is also what makes it decorable in the composer. The insertion still goes through one
`mentionInsert(agent)` function so a provider spelling it differently later is a switch.

## Data model

### Backend

`NativeAgent` mirrors `Skill` (`skills.rs:35`), for the same reasons - one entry per name, the
copies folded together, the providers that read each copy attached to it:

```rust
pub struct NativeAgentLocation {
    pub path: String,          // the .md file itself
    pub providers: Vec<String>,
    pub read_only: bool,
}

pub struct NativeAgent {
    pub id: String,            // "{scope}:{project_id}:{slug}"
    pub name: String,          // the file stem, which is what the roster invokes
    pub description: String,
    pub model: String,
    pub effort: String,
    pub permission_mode: String,
    pub color: String,
    pub tools: Vec<String>,
    pub extra_frontmatter: String,
    pub system_prompt: String, // the body
    pub scope: String,         // "global" | "project"
    pub project_id: String,
    pub project_name: String,
    pub path: String,          // the location the editor reads
    pub locations: Vec<NativeAgentLocation>,
    pub providers: Vec<String>,
    pub divergent: bool,
    pub read_only: bool,
}
```

`extra_frontmatter` carries the same contract as `Skill`: every key Cairn does not model is
re-emitted verbatim, so a field one CLI understands survives an edit made for another.

`icon` has no place in any definition. Either it goes - the color plus the name is enough for the
dot in the mention popup and the panel row - or it is written as an extra key and Cairn accepts
that a definition edited elsewhere loses it. Phase 0 answers this too: if the CLIs reject unknown
frontmatter keys, the choice is made for us. Default to dropping it.

Removed from `config.rs`: `CustomAgent`, `AgentProviderRow`, `migrate_agent`, `get_custom_agents`,
`save_custom_agents`, `DiscoveredAgent`, `list_claude_agents`, `ExportedAgent`, `ExportOutcome`,
`export_claude_agents`. `render_claude_agent`, `agent_slug`, `color_name_for_hex`,
`hex_for_color_name`, `split_frontmatter` and `parse_tool_list` survive as the write and read
halves of the new commands.

### Frontend

`stores/native-agents.ts` and `services/native-agent-service.ts`, shaped on `stores/skills.ts`
and `services/skill-service.ts`. `CustomAgent` disappears from `ai-provider-service.ts`,
`stores/ai-providers.ts` and `AgentView.svelte`.

`utils/agent/agent-resolution.ts` is deleted rather than reworked. Once Cairn does not run agents,
nothing is resolved at send time: a run uses the conversation's provider, model, effort and
permission mode, and the definition is only ever read by the provider.

The definitions are still loaded on the frontend, for one purpose - the autocomplete list and the
color and name shown on an observed run.

## Phase 1 - registry and reading

`cli_providers.rs` gains `agent_roots(provider, scope, project_path) -> Vec<PathBuf>` and
`agent_providers_at(path, scope, project_path)`, following `skill_roots` / `skill_providers_at`
exactly: index 0 is where Cairn writes, the rest are read. `reached_providers` gains an `"agent"`
kind, and `agent_reach` joins `skill_reach` and `mcp_reach`.

`commands/native_agents.rs` holds the scan: walk every root of every provider, deduplicate roots
by path, group the `.md` files by stem, fold each group into one `NativeAgent` with its locations,
its union of providers and its `divergent` flag. `list_native_agents(projects)` returns the global
scope plus one pass per project, sorted by name.

Frontmatter parsing reuses `split_frontmatter`; the tool list reuses `parse_tool_list`, keeping
`*` as "no restriction"; `permission-mode: default` keeps mapping to an empty string.

Unit tests: a definition present in two providers' roots folds into one entry carrying both; two
copies whose text differs are flagged divergent; an unknown frontmatter key survives a read.

## Phase 2 - writing

`save_native_agent(input)` mirrors `save_skill` (`skills.rs:625`) with files instead of
directories, which makes it simpler - there are no bundled resources to carry:

- resolve the write roots from `targets`, deduplicated;
- render the definition once;
- a location whose root is still a target is renamed to the new slug, a root that is new receives
  the file, a root that is no longer a target has its file removed;
- write the rendered text to every kept path, which is what realigns a divergent entry.

`delete_native_agent(paths)` removes every copy. `duplicate_native_agent(path, name)` copies one.
Both guard the way `ensure_skill_dir` does: the file must sit directly under an `agents`
directory Cairn knows, or the call is refused rather than deleting something else.

The frontmatter writer is `render_claude_agent`, extended to emit `extra_frontmatter` verbatim and
to take the key names from the target provider if phase 0 finds a second dialect. Values are
folded and quoted by `frontmatter_value` as today.

## Phase 3 - migration

`~/.cairn/agents.json` is read exactly once more, at startup, by a migration that:

- writes each agent as a definition into `~/.claude/agents` (global scope, the only root certain
  to exist), skipping any name already there rather than overwriting;
- renames the file to `agents.migrated.json` so the migration never runs twice and the
  original is still recoverable by hand;
- returns the list of names written and the list skipped.

The Agents section shows that outcome once, on its next open: what moved, and what was left alone
because a definition of that name already existed. Generation parameters are dropped in the
process and the notice says so - silently discarding a temperature the user set would be the one
unforgivable part of this change.

## Phase 4 - the Agents section

`components/home/agents/` is rebuilt as a sibling of `SkillsSection.svelte` and
`McpSection.svelte`: a list of definitions grouped by name with their `ProviderChips`, and an
editor pane with name, description, the system prompt body, tools, model, effort, permission
mode, color, the scope selector (home / a project) and `ProviderPicker` as the "Available to"
control - including its line naming the agents a shared root would also reach.

A divergent entry carries the same badge and the same wording as a divergent skill: saving
realigns the copies on what the editor shows.

Deleted: `ImportAgentsModal.svelte`, `ExportAgentsModal.svelte`, and the import and export paths
in `AgentsTab.svelte`. `DeleteAgentModal.svelte` stays, retargeted at every copy.

`ProvidersTab.svelte` is untouched: API providers and their keys are a different subject and keep
their screen.

## Phase 5 - the mention becomes autocompletion, and Cairn stops running agents

The `@` popup stays. Everything behind it goes.

**What it becomes.** `@` opens a list of the definitions available to this conversation - a
project's agents in a conversation working in that project, the global ones everywhere - filtered
as you type, each row showing the name, its color dot and its description, which is the popup
that exists today (`AgentView.svelte:2202`). Choosing one inserts its name into the prompt and
gives the caret back. That is all it does. The text is the message; the message goes to the
provider; the provider decides.

Several names can be inserted, anywhere in the prompt, as many as the user wants. Nothing
deduplicates them and nothing validates them - a prompt naming three agents is a prompt naming
three agents, and what happens next is the provider's business.

**What is deleted.** The consumption machinery, all of it:

- `mentionedAgent`, `consumeTypedMention`, `clearAgentMention`, the "agent chosen" chip in the
  composer and the stripping of the token from the sent text (`AgentView.svelte:427-471`,
  `1168-1173`, `1794-1820`);
- `Run.agentId` and `Run.askedIndex`, and every branch keyed off them - 44 references in
  `AgentView.svelte`;
- `utils/agent/agent-resolution.ts` and its test, entirely. There is nothing left to resolve: the
  conversation's provider, model, effort and permission mode are the only ones, as they were
  before agents existed;
- the delivery path - `undeliveredResults`, `markDelivered`, `AgentRun.delivered` and
  `AgentRun.handedOverFrom`. Cairn no longer hands an agent's answer to a conversation's
  provider, because the provider already has it: the subagent returned it through its own
  `tool_result`;
- `AgentThreadView`'s composer and its `onSend`, and `AgentThreadConfirmModal`'s `reset` kind - a
  thread that cannot be talked to cannot be reset either. The `delete` kind stays.

Mention text is decorated in the composer so an inserted name reads as one, in the agent's color.
That is presentation only: the raw text is what is sent, unchanged.

`buildRunOptions` loses its agent argument. A run is a conversation talking to its provider, and
that is the only kind of run Cairn starts.

## Phase 6 - subagents started by the provider

This is the new capability, and after phase 5 it is the *only* producer of an `AgentRun`. A
subagent the provider starts becomes a first-class run in Cairn, filling the same `AgentRun`
records the persona flow used to fill, so `AgentRunsPanel`, `AgentThreadView` and the answer
styling are inherited rather than rebuilt - they change owner, not shape.

**Backend.** `claude_cli.rs` passes `--forward-subagent-text` and learns to attribute events.
Every `emit_agent*` call gains the `tool_use_id` of the delegation the event belongs to, empty for
the main thread, and:

- `system` / `task_started` emits `agent_start` with `taskId`, `toolUseId`, `subagentType`,
  `description` and `prompt`;
- `assistant` and `user` events carrying a top-level `parent_tool_use_id` are emitted with it, so
  the frontend routes their text, thinking and tools to the subagent's blocks instead of the
  conversation's;
- `system` / `task_updated` emits `agent_status` with the patched status;
- `system` / `task_notification` emits `agent_result` with the status, the summary and the usage
  block, which fills `AgentRun.usage` directly;
- `can_use_tool` already carries `tool_use_id`, so a permission raised inside a subagent is
  attributed the same way and lands on that thread.

`emit_agent`, `emit_agent_tool` and `emit_agent_data` in `agent/mod.rs` take one more optional
field; the frontend ignores it when empty, which is every existing case.

**Frontend.** `AgentRun` gains `parentRunId` and `toolUseId`, and loses `delivered` and
`handedOverFrom` with the persona flow. `agent_start` creates the run through `addAgentRun` with
the `subagent_type` as its name and its color looked up in the definitions when one matches by
name - a subagent with no definition on disk, invented by the model for one task, still gets a
run, with a neutral color. Blocks append through `appendAgentBlock` and `finishAgentToolBlock`
unchanged. `agent_result` closes it and sets its `result`.

A prompt naming three agents produces three runs, and the panel already groups by agent
(`AgentRunsPanel`, "one entry per agent called in this conversation"), so several agents working
on one prompt is what that panel was shaped for.

**In the conversation.** The `Agent` line in `TurnBlocks` stops being a dead tool row. It becomes a
block of its own (`kind: 'agent'`, `utils/agent/delegation.ts`): the provider draws an ordinary
tool call before naming the agent, so that line is rewritten in place rather than followed by a
second one. It reads `Agent - Start <name>` in the agent's colour with a spinner. Finishing is a **second**
block appended at the end of the turn, `Agent - <name> finished`, with the answer behind a
disclosure and a link into its thread - rewriting the first one would date the answer from before
everything the provider wrote while waiting for it.

The answer stays **inside the turn** and is never appended as a message. Doing that put two
writers on one transcript: the run keeps rewriting the message it owns at `answerIndex`, so an
appended message landed above the reply commenting on it, repeated what the provider was already
saying, and left the reply missing after a reload. The block travels with the message through
`commitAnswer`, so it survives a reload with the turn it belongs to.

**What a run does not offer.** No follow-up prompt, and no individual stop - `stop_agent(runId)`
kills the whole run, the provider owns the subagent's lifetime. The thread view is read-only and
says so. What is available: watching it live, expanding its tools and reasoning, answering its
permission requests, and copying its result.

Persistence is unchanged: observed runs are written to the project's agent runs file like any
other, so a completed delegation is still readable after a restart.

## Phase 7 - i18n, changelog, tests

- `en.ts` / `fr.ts`: the Agents section is rewritten against the Skills section's vocabulary;
  `agents.import.*`, `agents.export.*` and the keys of the agent composer chip are removed; new
  keys for the migration notice, the divergence badge, the read-only thread and the `Task` row.
- `changelog.json`: one `changed` entry for agents becoming the definitions the CLIs already read,
  one `changed` for the mention becoming autocompletion that lets a prompt call several agents,
  one `added` for following the provider's own subagents live, one `removed` for the generation
  parameters, in `en` and `fr`.
- Rust tests: the fold, the divergence flag, the write-and-remove cycle of `save_native_agent`,
  the migration writing one definition and skipping a name already present, and the attribution of
  a stream event to its `Task` call.
- TS tests: `agent-resolution.test.ts` is deleted with the module it covers; a new test for
  routing an attributed event to the right run, and one for the autocomplete insertion.

## Order

Phase 0 blocks 1, 5 and 6. 2 depends on 1, 3 on 2, 4 on 2. 5 depends on 1 for the list it
completes from. 6 is independent of 1 to 5. 7 follows whatever it documents.

Phase 5 is the one that must not land early: it deletes the only way Cairn can currently run an
agent, so it goes in after phase 6 gives the provider's own subagents somewhere to be seen.
Landing 5 first would leave a release where naming an agent does nothing visible at all.

## Out of scope

- Per-project agent rosters for providers whose roster is user-wide only.
- Editing a plugin's agents. As with plugin skills, they are listed read-only or not at all.
- Sending a prompt into a subagent the provider owns.
- Making delegation deterministic. If a provider later exposes a flag that forces a named agent,
  that is a new decision, not a return to Cairn spawning the process itself.
