# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Cairn** is a Tauri desktop IDE built for AI-augmented development. The core philosophy: "the human supervises, the agent produces." It organizes work around task *instances* (one ticket = one git worktree = one isolated environment) rather than files.

Tech stack: **Tauri 2 + SvelteKit 2 + Svelte 5 + TypeScript** (frontend), **Rust** (backend).

## Commands

```bash
# Install dependencies
bun install

# Start full Tauri app in dev mode (preferred)
bun run tauri dev

# Frontend only (Vite dev server on port 1420)
bun run dev

# Type-check
bun run check
bun run check:watch   # watch mode

# Build
bun run tauri build   # full release build
bun run build         # frontend only
```

No lint or test scripts exist yet.

## Architecture

### Data Model

```
Project → Instance (ticket + git worktree) → TimelineEvents
```

- **Project**: a local repo with metadata
- **Instance**: one ticket being worked on, isolated in a git worktree with its own branch
- **TimelineEvent**: checkpoints and activity log entries for an instance

### Frontend (`src/lib/`)

**Routing** — SPA with two screens: `Home` (project browser) and `Workspace` (active development). Screen is toggled in `src/routes/+page.svelte`.

**Workspace tabs** map to the 6 workflow steps (in order):
1. `files/` — File explorer + CodeMirror editor
2. `agent/` — AI agent chat + live activity feed
3. `review/` — Diff viewer with AI annotations
4. `tests/` — Test runner
5. `git/` — Staging, commit, push
6. `cicd/` — Pipeline status

**Stores** (`src/lib/stores/`):
- `ui.ts` — `activeStep` (which tab is shown)
- `project.ts` — current project
- `instance.ts` — active instance

**Agent Bridge** (`src/lib/bridge/`):
- `agent-bridge.ts` — abstract `AgentDriver` interface (start, stop, send, onEvent)
- `drivers/claude-code.ts` — concrete driver invoking Claude Code CLI via Tauri IPC

The bridge decouples the UI from any specific AI provider. All agent interaction goes through this abstraction.

### Backend (`src-tauri/src/lib.rs`)

Minimal Rust — primarily IPC bridges:
- `run_shell_command()` — runs arbitrary CLI commands (git, npm, etc.)
- `run_agent_command()` — invokes the Claude Code CLI (currently stubbed)

### Data Flow

```
UI Component → Svelte Store → Tauri invoke() → Rust command → System process → Event → UI
```

### Key Types (`src/lib/types/`)

```typescript
Instance    { id, projectId, ticket, branch, worktreePath, status, createdAt }
AgentIntent { instruction, profile, contextFiles }
AgentEvent  { id, timestamp, type, content, filePath }
AgentDriver { start(), stop(), send(), onEvent() }
```

`AgentProfile` = `'default' | 'refactor' | 'debug' | 'documentation' | 'review'`
