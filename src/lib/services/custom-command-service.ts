// User-defined commands of the Commands view, in both scopes, plus the port
// allocation they run with. Only this layer calls invoke().

import { invoke } from "@tauri-apps/api/core";

/** Where the steps run: the instance worktree, or the shared project checkout. */
export type CommandCwd = "worktree" | "projectRoot";

/** Stored with the project, or in the global list shared by every project. */
export type CommandScope = "project" | "global";

/** One command and its steps; `source` marks the ones imported from package.json scripts. */
export interface CustomCommand {
	id: string;
	name: string;
	icon: string;
	color?: string;
	steps: string[];
	stopOnError: boolean;
	cwd: CommandCwd;
	pinned: boolean;
	autoClose: boolean;
	confirm: boolean;
	source?: "manual" | "package.json";
}

/** On-disk shape of a command list; wrapped in an object so fields can be added later. */
export interface CommandsFile {
	commands: CustomCommand[];
}

/** Per-instance runtime state: the port each command was last given, keyed by command id. */
export interface InstanceCommandState {
	ports: Record<string, number>;
}

/** Commands stored with the project, package.json imports included. */
export async function getProjectCommands(
	projectId: string,
): Promise<CommandsFile> {
	return await invoke("get_project_commands", { projectId });
}

/** Rewrites the project list wholesale; there is no per-command write. */
export async function saveProjectCommands(
	projectId: string,
	state: CommandsFile,
): Promise<void> {
	await invoke("save_project_commands", { projectId, state });
}

/** The command list shared by every project. */
export async function getGlobalCommands(): Promise<CommandsFile> {
	return await invoke("get_global_commands");
}

/** Rewrites the global list wholesale. */
export async function saveGlobalCommands(state: CommandsFile): Promise<void> {
	await invoke("save_global_commands", { state });
}

/** The ports this instance last ran its commands on. */
export async function getCommandState(
	projectId: string,
	instanceId: string,
): Promise<InstanceCommandState> {
	return await invoke("get_command_state", { projectId, instanceId });
}

/** Persists the port map so the same command comes back on the same port. */
export async function saveCommandState(
	projectId: string,
	instanceId: string,
	state: InstanceCommandState,
): Promise<void> {
	await invoke("save_command_state", { projectId, instanceId, state });
}

/** Shells out to `whoami`; empty string rather than a throw when it fails. */
export async function getSystemUser(): Promise<string> {
	const result = await invoke<{ stdout: string; success: boolean }>(
		"run_shell_command",
		{ program: "whoami", args: [], cwd: null },
	);
	return result.success ? result.stdout.trim() : "";
}

/**
 * Keeps `preferred` when it is free and not excluded, otherwise scans upwards
 * from `base`. The port is only tested, never held: a caller that waits before
 * binding can still lose the race.
 */
export async function allocatePort(
	base: number,
	preferred: number | null,
	exclude: number[],
): Promise<number> {
	return await invoke("allocate_port", { base, preferred, exclude });
}
