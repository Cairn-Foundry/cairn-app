// The commit form's sticky options, per instance. Only this layer calls invoke().

import { invoke } from "@tauri-apps/api/core";

/** Commit toggles remembered between commits; mirrors the Rust `CommitState`. */
export interface CommitState {
	noVerify: boolean;
	signOff: boolean;
	allowEmpty: boolean;
	selectedProfileId: string;
	appendTicketId: boolean;
}

/** Null when the instance never committed yet - the caller falls back to its defaults. */
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

/** Fire and forget: losing a toggle must never block the commit itself. */
export function saveCommitState(
	projectId: string,
	instanceId: string,
	state: CommitState,
): void {
	invoke("save_commit_state", { projectId, instanceId, state }).catch(() => {});
}
