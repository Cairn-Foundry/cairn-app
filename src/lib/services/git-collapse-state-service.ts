import { invoke } from "@tauri-apps/api/core";

export interface GitCollapseState {
	collapsedUnstaged: string[];
	collapsedStaged: string[];
}

export async function getGitCollapseState(
	projectId: string,
	instanceId: string,
): Promise<GitCollapseState | null> {
	try {
		return await invoke<GitCollapseState | null>("get_git_collapse_state", {
			projectId,
			instanceId,
		});
	} catch {
		return null;
	}
}

export function saveGitCollapseState(
	projectId: string,
	instanceId: string,
	state: GitCollapseState,
): void {
	invoke("save_git_collapse_state", { projectId, instanceId, state }).catch(
		() => {},
	);
}
