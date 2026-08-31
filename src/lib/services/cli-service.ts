// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// The `cairn` shell launcher: whether it is symlinked on this machine, and the
// paths the app was started with. Only this layer calls invoke().

import { invoke } from "@tauri-apps/api/core";

/** State of the `cairn` symlink; `target` is the launcher it should point at. */
export interface CliStatus {
	installed: boolean;
	path: string | null;
	target: string | null;
	upToDate: boolean;
	launcherAvailable: boolean;
}

/** Resolves the symlink on disk each call, so an externally removed one shows up. */
export function getCliStatus(): Promise<CliStatus> {
	return invoke<CliStatus>("get_cli_status");
}

/** Symlinks into /usr/local/bin, falling back to ~/.local/bin; returns the new status. */
export function installCli(): Promise<CliStatus> {
	return invoke<CliStatus>("install_cli");
}

/** Removes the symlink and returns the new status. */
export function uninstallCli(): Promise<CliStatus> {
	return invoke<CliStatus>("uninstall_cli");
}

/**
 * What a `cairn` invocation asked for: files to open, a directory to open (or
 * import) as a project, or a repo to clone. At most one of `openDir` /
 * `cloneUrl` is set.
 */
export interface CliRequest {
	paths: string[];
	openDir: string | null;
	cloneUrl: string | null;
}

/**
 * Drains the request the app was launched with, absolutized. Draining is the
 * point: a second call returns nothing, so the same launch is not replayed.
 */
export function takePendingCliPaths(): Promise<CliRequest> {
	return invoke<CliRequest>("take_pending_cli_paths");
}
