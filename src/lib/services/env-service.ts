import { invoke } from "@tauri-apps/api/core";

export type EnvScope = "global" | "project" | "instance";

export interface EnvVariable {
	id: string;
	key: string;
	value: string;
	perInstance: boolean;
	secret: boolean;
	enabled: boolean;
}

export interface EnvFile {
	variables: EnvVariable[];
	overrides: Record<string, string>;
	writeEnvFile: boolean;
	envFileName: string;
}

export interface EnvFileStatus {
	exists: boolean;
	managed: boolean;
}

export const DEFAULT_ENV_FILE_NAME = ".env";

export function emptyEnvFile(): EnvFile {
	return {
		variables: [],
		overrides: {},
		writeEnvFile: true,
		envFileName: DEFAULT_ENV_FILE_NAME,
	};
}

export async function getGlobalEnv(): Promise<EnvFile> {
	return await invoke("get_global_env");
}

export async function saveGlobalEnv(state: EnvFile): Promise<void> {
	await invoke("save_global_env", { state });
}

export async function getProjectEnv(projectId: string): Promise<EnvFile> {
	return await invoke("get_project_env", { projectId });
}

export async function saveProjectEnv(
	projectId: string,
	state: EnvFile,
): Promise<void> {
	await invoke("save_project_env", { projectId, state });
}

export async function getInstanceEnv(
	projectId: string,
	instanceId: string,
): Promise<EnvFile> {
	return await invoke("get_instance_env", { projectId, instanceId });
}

export async function saveInstanceEnv(
	projectId: string,
	instanceId: string,
	state: EnvFile,
): Promise<void> {
	await invoke("save_instance_env", { projectId, instanceId, state });
}

export async function getEnvFileStatus(
	worktreePath: string,
	fileName: string,
): Promise<EnvFileStatus> {
	return await invoke("env_file_status", { worktreePath, fileName });
}

export async function readEnvFile(
	worktreePath: string,
	fileName: string,
): Promise<string> {
	return await invoke("read_env_file", { worktreePath, fileName });
}

/**
 * Resolves to false when a file Cairn does not own already sits there. `force`
 * takes that file over, once the view has imported its content.
 */
export async function writeEnvFile(
	worktreePath: string,
	fileName: string,
	body: string,
	force = false,
): Promise<boolean> {
	return await invoke("write_env_file", {
		worktreePath,
		fileName,
		body,
		force,
	});
}

export async function deleteEnvFile(
	worktreePath: string,
	fileName: string,
): Promise<boolean> {
	return await invoke("delete_env_file", { worktreePath, fileName });
}

export async function ensureEnvIgnored(
	worktreePath: string,
	fileName: string,
): Promise<boolean> {
	return await invoke("ensure_env_ignored", { worktreePath, fileName });
}
