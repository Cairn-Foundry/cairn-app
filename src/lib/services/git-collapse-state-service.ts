// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Which file cards the Git view leaves folded, per instance.
// Only this layer calls invoke().

import { invoke } from "@tauri-apps/api/core";

/** File paths folded in the Git view, kept per instance. */
export interface GitCollapseState {
	collapsedUnstaged: string[];
	/** Back-compat only: the staged side is driven by `expandedStaged` and this is written empty. */
	collapsedStaged: string[];
	/** Staged cards start folded, so this lists the ones the user opened. */
	expandedStaged: string[];
}

/** Null when nothing was folded yet for this instance. */
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

/** Fire and forget: called on every fold, a lost write only costs a reopened card. */
export function saveGitCollapseState(
	projectId: string,
	instanceId: string,
	state: GitCollapseState,
): void {
	invoke("save_git_collapse_state", { projectId, instanceId, state }).catch(
		() => {},
	);
}
