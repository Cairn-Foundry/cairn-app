import { invoke } from "@tauri-apps/api/core";

export async function createTerminal(
	id: string,
	cwd: string | null,
	cols: number,
	rows: number,
): Promise<void> {
	await invoke("terminal_create", { id, cwd, cols, rows });
}

export async function writeToTerminal(id: string, data: string): Promise<void> {
	await invoke("terminal_write", { id, data });
}

export async function resizeTerminal(
	id: string,
	cols: number,
	rows: number,
): Promise<void> {
	await invoke("terminal_resize", { id, cols, rows });
}

export async function closeTerminal(id: string): Promise<void> {
	await invoke("terminal_close", { id });
}

export async function closeAllTerminals(): Promise<void> {
	await invoke("terminal_close_all");
}

export interface TerminalTab {
	id: string;
	title: string;
}

export interface TerminalLayout {
	terminals: TerminalTab[];
	activeId: string | null;
}

export async function getTerminalState(
	projectId: string,
	instanceId: string,
): Promise<TerminalLayout | null> {
	return await invoke("get_terminal_state", { projectId, instanceId });
}

export async function saveTerminalState(
	projectId: string,
	instanceId: string,
	state: TerminalLayout,
): Promise<void> {
	await invoke("save_terminal_state", { projectId, instanceId, state });
}

export interface ProjectTerminalTab {
	id: string;
	title: string;
	cwd: string | null;
}

export interface ProjectTerminalLayout {
	terminals: ProjectTerminalTab[];
}

export async function getProjectTerminalState(
	projectId: string,
): Promise<ProjectTerminalLayout | null> {
	return await invoke("get_project_terminal_state", { projectId });
}

export async function saveProjectTerminalState(
	projectId: string,
	state: ProjectTerminalLayout,
): Promise<void> {
	await invoke("save_project_terminal_state", { projectId, state });
}
