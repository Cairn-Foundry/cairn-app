// PTY lifecycle, plus the persisted terminal layout in both scopes: per
// instance and per project. Only this layer calls invoke().

import { invoke } from "@tauri-apps/api/core";

/**
 * Spawns the PTY; output comes back as events, not from this call. `id` is the
 * handle every later call uses.
 *
 * Three ways to say what runs: nothing at all leaves an interactive login shell,
 * `command` runs a script through that shell, and `args` runs a resolved binary
 * with its argv and no shell at all. An agent CLI takes the `args` route -
 * composing `claude --resume <uuid>` into a shell string would mean quoting an
 * id and a worktree path correctly on every platform.
 */
export async function createTerminal(
	id: string,
	cwd: string | null,
	cols: number,
	rows: number,
	command: string | null = null,
	env: Record<string, string> | null = null,
	args: string[] | null = null,
): Promise<void> {
	await invoke("terminal_create", { id, cwd, cols, rows, command, args, env });
}

/** Raw bytes to the PTY stdin; newlines are not added. */
export async function writeToTerminal(id: string, data: string): Promise<void> {
	await invoke("terminal_write", { id, data });
}

/** Tells the PTY its new size so the running program reflows. */
export async function resizeTerminal(
	id: string,
	cols: number,
	rows: number,
): Promise<void> {
	await invoke("terminal_resize", { id, cols, rows });
}

/**
 * Whether the process on this PTY has a child of its own: a CLI waiting on a
 * build or a test run looks idle from the terminal, but is not. True on any
 * doubt, since the answer decides whether something gets killed.
 */
export async function terminalHasChildren(id: string): Promise<boolean> {
	return await invoke("terminal_has_children", { id });
}

/** Kills the PTY; the saved layout is not updated, the caller does that. */
export async function closeTerminal(id: string): Promise<void> {
	await invoke("terminal_close", { id });
}

/** Kills every PTY of the app, both scopes; used on shutdown. */
export async function closeAllTerminals(): Promise<void> {
	await invoke("terminal_close_all");
}

/** One instance-scoped terminal; `commandId` is set when a custom command spawned it. */
export interface TerminalTab {
	id: string;
	title: string;
	commandId?: string;
	icon?: string;
	port?: number;
}

/** Order and selection restored on reopen; `splitId` is the terminal shown beside the active one. */
export interface TerminalLayout {
	terminals: TerminalTab[];
	activeId: string | null;
	splitId?: string | null;
	splitRatio?: number | null;
}

/** Layout only: the PTYs themselves are gone after a restart and get respawned. */
export async function getTerminalState(
	projectId: string,
	instanceId: string,
): Promise<TerminalLayout | null> {
	return await invoke("get_terminal_state", { projectId, instanceId });
}

/** Writes the instance's terminal-state.json. */
export async function saveTerminalState(
	projectId: string,
	instanceId: string,
	state: TerminalLayout,
): Promise<void> {
	await invoke("save_terminal_state", { projectId, instanceId, state });
}

/** A terminal shared by every instance; `cwd` is persisted so it respawns in the same place. */
export interface ProjectTerminalTab {
	id: string;
	title: string;
	cwd: string | null;
}

/** Project terminals carry no active selection: the instance layout owns that. */
export interface ProjectTerminalLayout {
	terminals: ProjectTerminalTab[];
}

/** The project-scoped terminals, reachable from every instance of the project. */
export async function getProjectTerminalState(
	projectId: string,
): Promise<ProjectTerminalLayout | null> {
	return await invoke("get_project_terminal_state", { projectId });
}

/** Writes the project's own terminal-state.json, next to instances.json. */
export async function saveProjectTerminalState(
	projectId: string,
	state: ProjectTerminalLayout,
): Promise<void> {
	await invoke("save_project_terminal_state", { projectId, state });
}
