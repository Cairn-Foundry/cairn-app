// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// The registry of external coding CLIs, and which of them read a given
// skill / MCP / agent file. Only this layer calls invoke().

import { invoke } from "@tauri-apps/api/core";

/** The coding CLIs Cairn can configure skills and MCP servers for. */
export type CliProviderId =
	| "claude-code"
	| "codex"
	| "gemini"
	| "opencode"
	| "copilot"
	| "antigravity"
	| "vibe"
	| "cursor"
	| "amp"
	| "goose"
	| "qwen"
	| "droid";

/** One CLI as the registry describes it, including whether it is on this machine. */
export interface CliProviderDef {
	id: CliProviderId;
	label: string;
	/** Only Claude Code keeps a per-project private MCP list. */
	hasLocalScope: boolean;
	/**
	 * Whether the binary is there to be launched. The conversation picker keys
	 * off this one: a card that cannot be launched must not be offered.
	 */
	installed: boolean;
	/**
	 * Whether the agent has run on this machine, which is what makes writing it
	 * a skill or an MCP server worth doing - the file stays useful even when the
	 * binary is invoked from somewhere Cairn cannot see. True on a config
	 * directory an uninstall left behind, where `installed` is false.
	 */
	configured: boolean;
	/** Where the binary was found, so the hub can show which install is used. */
	path: string | null;
	/** What `<bin> --version` printed, when the binary is there. */
	version: string | null;
	/**
	 * Whether a conversation with this CLI can be reopened by its own id. True
	 * for every CLI in the registry; kept so a future one that cannot is reported
	 * rather than silently offering a conversation it would lose.
	 */
	resumable: boolean;
}

/** The CLI the headless assists run on; see `ASSIST_CLI`. */
export const CLAUDE_CODE = "claude-code" satisfies CliProviderId;

/**
 * Every known CLI, installed or not - the caller decides what to grey out.
 *
 * The answer is cached in Rust: detection runs each installed CLI to read its
 * version, which is a visible wait to repeat on every visit to a screen. Pass
 * `refresh` when the user asks for it, or after something may have installed a
 * CLI.
 */
export async function listCliProviders(
	refresh = false,
): Promise<CliProviderDef[]> {
	return await invoke("list_cli_providers", { refresh });
}

/**
 * The id of the conversation a CLI just started in `cwd`, for the CLIs that
 * mint their own rather than taking one imposed at launch.
 *
 * `startedAfter` is when the PTY was spawned, so a session older than the
 * conversation - an earlier one in the same worktree - is never adopted. Null
 * while the user has not spoken yet: the CLI has no session to report, and the
 * caller asks again later.
 */
export async function discoverCliSession(
	cli: CliProviderId,
	cwd: string,
	startedAfter: number,
): Promise<string | null> {
	return await invoke("discover_cli_session", { cli, cwd, startedAfter });
}

/**
 * Whether a CLI already has a session recorded under exactly this id - what
 * `--session-id` collides with when it refuses to create one.
 *
 * Unlike `discoverCliSession`, which answers "what did this CLI most recently
 * write in this cwd" and drifts to whatever else has run there since, an id is
 * unique on its own: this needs neither a cwd nor a time floor.
 */
export async function cliSessionIdExists(
	cli: CliProviderId,
	sessionId: string,
): Promise<boolean> {
	return await invoke("cli_session_id_exists", { cli, sessionId });
}

/**
 * The agents that would end up reading an entry written for `targets` - not the
 * same list, because a write location is often read by agents that were never
 * asked for. Answered by the registry rather than mirrored here, so the two
 * never drift apart.
 */
export async function reachedProviders(
	kind: "skill" | "mcp" | "agent",
	scope: string,
	projectPath: string,
	targets: CliProviderId[],
): Promise<CliProviderId[]> {
	return await invoke("reached_providers", {
		kind,
		scope,
		projectPath,
		targets,
	});
}
