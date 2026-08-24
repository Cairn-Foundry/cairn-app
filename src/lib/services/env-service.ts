// Environment variables at three scopes, and the `.env` file they are rendered
// into inside a worktree.

import { invoke } from "@tauri-apps/api/core";

/** The three levels, each one overriding the one before it. */
export type EnvScope = "global" | "project" | "instance";

/** A declared variable. `perInstance` makes each instance carry its own value. */
export interface EnvVariable {
	id: string;
	key: string;
	value: string;
	perInstance: boolean;
	/** Prefilled into a new instance override, then freely editable. */
	defaultValue: string;
	secret: boolean;
	enabled: boolean;
}

/** What one scope stores: its own variables plus overrides of inherited ones. */
export interface EnvFile {
	variables: EnvVariable[];
	/** Keyed by the inherited variable's id, not by its key. */
	overrides: Record<string, string>;
	writeEnvFile: boolean;
	envFileName: string;
}

/** State of the `.env` on disk. `managed` means Cairn wrote it and may rewrite it. */
export interface EnvFileStatus {
	exists: boolean;
	managed: boolean;
}

export const DEFAULT_ENV_FILE_NAME = ".env";

/** The state a scope starts from before anything is stored for it. */
export function emptyEnvFile(): EnvFile {
	return {
		variables: [],
		overrides: {},
		writeEnvFile: false,
		envFileName: DEFAULT_ENV_FILE_NAME,
	};
}

/** Variables every project inherits. */
export async function getGlobalEnv(): Promise<EnvFile> {
	return await invoke("get_global_env");
}

/** Replaces the global scope wholesale. */
export async function saveGlobalEnv(state: EnvFile): Promise<void> {
	await invoke("save_global_env", { state });
}

/** The project's own layer, without the global one merged in. */
export async function getProjectEnv(projectId: string): Promise<EnvFile> {
	return await invoke("get_project_env", { projectId });
}

/** Replaces the project scope wholesale. */
export async function saveProjectEnv(
	projectId: string,
	state: EnvFile,
): Promise<void> {
	await invoke("save_project_env", { projectId, state });
}

/** The instance's own layer, mostly overrides of inherited variables. */
export async function getInstanceEnv(
	projectId: string,
	instanceId: string,
): Promise<EnvFile> {
	return await invoke("get_instance_env", { projectId, instanceId });
}

/** Replaces the instance scope wholesale. */
export async function saveInstanceEnv(
	projectId: string,
	instanceId: string,
	state: EnvFile,
): Promise<void> {
	await invoke("save_instance_env", { projectId, instanceId, state });
}

/** Whether a `.env` sits there and whether Cairn owns it. The command is `env_file_status`. */
export async function getEnvFileStatus(
	worktreePath: string,
	fileName: string,
): Promise<EnvFileStatus> {
	return await invoke("env_file_status", { worktreePath, fileName });
}

/** Raw text of the file, so an unmanaged one can be imported before being taken over. */
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

/** Only removes a file Cairn generated; false when it is absent or not managed. */
export async function deleteEnvFile(
	worktreePath: string,
	fileName: string,
): Promise<boolean> {
	return await invoke("delete_env_file", { worktreePath, fileName });
}

/** Adds the file to `.gitignore` if missing; false when it was already covered. */
export async function ensureEnvIgnored(
	worktreePath: string,
	fileName: string,
): Promise<boolean> {
	return await invoke("ensure_env_ignored", { worktreePath, fileName });
}
