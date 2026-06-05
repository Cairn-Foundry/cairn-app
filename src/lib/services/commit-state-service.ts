import { invoke } from "@tauri-apps/api/core";

export interface CommitState {
	noVerify: boolean;
	signOff: boolean;
	allowEmpty: boolean;
	selectedProfileId: string;
}

export async function getCommitState(
	projectId: string,
	instanceId: string,
): Promise<CommitState | null> {
	try {
		return await invoke<CommitState | null>("get_commit_state", {
			projectId,
			instanceId,
		});
	} catch {
		return null;
	}
}

export function saveCommitState(
	projectId: string,
	instanceId: string,
	state: CommitState,
): void {
	invoke("save_commit_state", { projectId, instanceId, state }).catch(() => {});
}
