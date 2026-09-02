// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** What the backend saw move: the tree itself, or only the git status. */
export interface FsChanged {
	worktree: string;
	gitOnly: boolean;
}

/** What the backend covers now, and which directories it could not take. */
export interface WatchReport {
	watched: number;
	failed: string[];
}

/**
 * Declares the exact set of directories to watch for a worktree. The root and the
 * git metadata are always covered on top of it.
 *
 * Send the whole set on every change: the backend diffs against what it holds and
 * only moves the difference. The set is what the user is looking at - expanded
 * directories, parents of open tabs - never the whole repository, because on Linux
 * a recursive watch means one inotify watch per directory against a quota shared
 * with every other program on the machine.
 */
export async function watchDirs(
	path: string,
	dirs: string[],
): Promise<WatchReport> {
	return invoke<WatchReport>("watch_dirs", { path, dirs });
}

export async function unwatchWorktree(path: string): Promise<void> {
	return invoke("unwatch_worktree", { path });
}

export function onFsChanged(
	handler: (change: FsChanged) => void,
): Promise<UnlistenFn> {
	return listen<FsChanged>("fs-changed", (e) => handler(e.payload));
}
