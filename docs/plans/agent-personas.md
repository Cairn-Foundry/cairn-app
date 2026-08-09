# Agents as personas, and providers that change mid-conversation

> Superseded by `native-agents.md`, which removes the persona model. The
> per-provider sessions and the handoff transcript described here are not
> affected and stay in place.

## Implementation status

Implemented (2026-08-08): all four phases.

- `CustomAgent.rows` replaces the single provider binding; legacy agents migrate
  to one row on read (`migrate_agent`).
- `ConversationMeta.sessions` replaces `sessionId`; a legacy session migrates
  under the conversation's provider (`migrate_index`). Both legacy fields are
  still read and no longer written.
- Resolution lives in `utils/agent/agent-resolution.ts`, the handoff in
  `utils/agent/handoff.ts`, both unit-tested. `Run.foreignProvider` and
  `resolveAgentProvider` are gone.

Goal: stop an agent from being a provider binding, and stop a conversation from
pretending it only ever talked to one provider. An agent becomes a *persona*
that can run anywhere, carrying per-provider settings; a conversation keeps one
session per provider and says so when the provider changes.

## Current state (audit)

- `CustomAgent` pins exactly one `providerId` + `model`. Running the same
  persona on two providers means duplicating the agent.
- Mentioning an agent whose provider differs from the conversation's sends the
  run to another backend. The reply lands in a thread whose history that
  provider never saw.
- `ConversationMeta.sessionId` is a single value. `pickProvider` changes the
  provider and clears the model but *keeps* the session id, so a manual switch
  resumes the previous provider's session on the new one. This is a live bug,
  independent of agents.
- `Run.foreignProvider` currently suppresses session read/write for
  cross-provider mention runs. It is a patch over the single-session model and
  disappears once sessions are per provider.

## Decisions

1. **An agent is a persona with per-provider rows.** Prompt, tools, colour and
   generation params belong to the persona; model, effort and permission mode
   belong to a row, one per provider. Mentioning an agent never changes the
   conversation's provider.
2. **A conversation holds one session per provider.** `sessions` maps a provider
   id to its session id.
3. **A provider taking over mid-thread gets a compact transcript, and the switch
   is visible** as a system line in the conversation.

## Data model

```ts
interface AgentProviderRow {
  providerId: string;
  model: string;          // empty = the provider's own default
  effort: string;         // empty = inherit
  permissionMode: string; // empty = inherit
}

interface CustomAgent {
  id: string;
  name: string;
  description: string;
  color: string;
  icon: string;
  systemPrompt: string;
  allowedTools: string[];
  disallowedTools: string[];
  overrideParams: boolean;
  temperature: number;
  maxTokens: number;
  rows: AgentProviderRow[];
}
```

Removed from `CustomAgent`: `providerId`, `model`, `effort`, `permissionMode`.

**Migration** (Rust, on read, so it happens once): an agent with no `rows` but a
legacy `providerId` gets `rows = [{ providerId, model, effort, permissionMode }]`.
An agent with neither keeps an empty `rows`, which is valid - it runs everywhere
on whatever the conversation is using.

`ConversationMeta`: `sessions: HashMap<String, String>` replaces
`sessionId: Option<String>`. On read, a legacy `session_id` becomes
`sessions[conversation.provider_id]`. The old field stays deserialisable and is
no longer written.

## Resolution at send time

The provider is **always** the conversation's. For a mentioned agent:

| Setting | Source, first non-empty wins |
|---|---|
| provider | conversation (never the agent) |
| model | agent row for that provider, then the conversation's model |
| effort | agent row, then conversation, then provider config |
| permission mode | agent row, then conversation, then provider config |
| system prompt, tools, temperature, max tokens | persona, whatever the provider |

The row wins over the composer's model because choosing a row is an explicit
statement about that provider; a row with an empty model defers to the composer.
Tools are only sent to CLI providers, as today.

An agent with no row for the current provider still runs: it keeps its prompt,
tools and params, and inherits model/effort/permission from the conversation.
Nothing is blocked and nothing is silently ignored.

## Sessions and the switch marker

- Send: `sessionId = conv.sessions[providerId] ?? null`.
- On a `session` event: `sessions[runProviderId] = id`.
- `Run.foreignProvider` is deleted.
- The conversation records the provider of its last run. When the provider for
  this run differs, before sending:
  - push a `role: 'system'` message: "Switched to <Provider>";
  - build the handoff transcript (below) for this one message.

## Context handoff

A compact transcript of the recent exchange, capped so it cannot grow without
bound: the last 20 user/agent messages, truncated to roughly 6000 characters,
oldest dropped first.

- **API providers**: already delivered through `RunOptions.history`; unchanged.
- **CLI providers**: prepended to the first message after a switch as a fenced
  block, since a CLI has no other channel for prior turns.

Only the first message after a switch carries it - afterwards that provider has
its own session and resumes normally.

## UI

**Agent form** (`AgentsTab.svelte`)

- The Provider/Model pair becomes a "Providers" group: one card per row with
  provider, model, effort and permission mode, a remove button, and an "Add
  provider" action offering the providers not yet used. An agent with no rows
  shows an explanatory empty state rather than an error.
- The master list subtitle shows the providers the agent is configured for
  instead of a single "Provider - Model".
- Tools and generation groups are unchanged, minus the per-provider fields.

**Agent view** (`AgentView.svelte`)

- `resolveAgentProvider` is deleted; `buildRunOptions` takes the conversation's
  provider and the matching row.
- The `@` popup can hint which providers a persona is tuned for; it never hides
  an agent, since every agent can now run anywhere.

**Import** creates a single row for `claude-code-cli` from the definition's
model, effort and permission mode.

## Phases

1. Data model and migration: `rows` on `CustomAgent`, `sessions` on
   `ConversationMeta`, both sides, with Rust tests for the two migrations.
2. Send-time resolution: row lookup, per-provider session, switch marker,
   handoff transcript. Delete `foreignProvider`.
3. Agent form UI for rows, master subtitle, import mapping.
4. i18n (en + fr), changelog, tests for the resolution table and the transcript
   cap.

Phase 2 depends on 1; 3 and 4 depend on 2.

## Out of scope

- Per-project agents (agents stay global in `~/.cairn`).
- Running one prompt against several agents or providers at once.
- Carrying tool results, not just messages, across a provider switch.
