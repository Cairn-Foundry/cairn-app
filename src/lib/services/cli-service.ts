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
 * Drains the paths the app was launched with, absolutized. Draining is the
 * point: a second call returns nothing, so the same file is not reopened.
 */
export function takePendingCliPaths(): Promise<string[]> {
	return invoke<string[]>("take_pending_cli_paths");
}
