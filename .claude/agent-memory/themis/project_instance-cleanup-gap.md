---
name: instance-cleanup-gap
description: removeInstance does not cascade-clean per-instance resources; check new per-instance features for leaks on deletion
metadata:
  type: project
---

`removeInstance` in `src/lib/stores/instance.ts` only calls `deleteInstance` (backend) and drops the instance from the `instances` store. It does NOT tear down any per-instance in-memory/OS state keyed by instance id.

**Why:** Features increasingly scope state per instance id (agent `conversations` in AgentView.svelte, terminal `terminalSessions` + xterm instances in the `terminal-manager` singleton + backend PTY child processes in Rust `TerminalState`). None of these are cleaned when the instance is deleted, so they leak for the app session. Terminal leak is the worst: orphaned shell subprocesses + PTY fds accumulate.

**How to apply:** When reviewing any change that adds `Record<instanceId, ...>` state or backend state keyed by instance/worktree, check whether `removeInstance` (or a delete hook) tears it down. Absence of cleanup is a real resource leak, not a nit. Sensitive files: stores/instance.ts, stores/terminal.ts, utils/terminal/terminal-manager.ts, commands/terminal.rs, components/agent/AgentView.svelte.
