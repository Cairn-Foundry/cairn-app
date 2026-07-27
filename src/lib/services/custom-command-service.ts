import { invoke } from "@tauri-apps/api/core";

export type CommandCwd = "worktree" | "projectRoot";

export type CommandScope = "project" | "global";

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

export interface CommandsFile {
	commands: CustomCommand[];
}

export interface InstanceCommandState {
	ports: Record<string, number>;
}

export async function getProjectCommands(
	projectId: string,
): Promise<CommandsFile> {
	return await invoke("get_project_commands", { projectId });
}

export async function saveProjectCommands(
	projectId: string,
	state: CommandsFile,
): Promise<void> {
	await invoke("save_project_commands", { projectId, state });
}

export async function getGlobalCommands(): Promise<CommandsFile> {
	return await invoke("get_global_commands");
}

export async function saveGlobalCommands(state: CommandsFile): Promise<void> {
	await invoke("save_global_commands", { state });
}

export async function getCommandState(
	projectId: string,
	instanceId: string,
): Promise<InstanceCommandState> {
	return await invoke("get_command_state", { projectId, instanceId });
}

export async function saveCommandState(
	projectId: string,
	instanceId: string,
	state: InstanceCommandState,
): Promise<void> {
	await invoke("save_command_state", { projectId, instanceId, state });
}

export async function getSystemUser(): Promise<string> {
	const result = await invoke<{ stdout: string; success: boolean }>(
		"run_shell_command",
		{ program: "whoami", args: [], cwd: null },
	);
	return result.success ? result.stdout.trim() : "";
}

export async function allocatePort(
	base: number,
	preferred: number | null,
	exclude: number[],
): Promise<number> {
	return await invoke("allocate_port", { base, preferred, exclude });
}
