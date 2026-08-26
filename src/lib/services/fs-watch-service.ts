import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** What the backend saw move: the tree itself, or only the git status. */
export interface FsChanged {
	worktree: string;
	gitOnly: boolean;
}

export async function watchWorktree(path: string): Promise<void> {
	return invoke("watch_worktree", { path });
}

export async function unwatchWorktree(path: string): Promise<void> {
	return invoke("unwatch_worktree", { path });
}

export function onFsChanged(
	handler: (change: FsChanged) => void,
): Promise<UnlistenFn> {
	return listen<FsChanged>("fs-changed", (e) => handler(e.payload));
}
