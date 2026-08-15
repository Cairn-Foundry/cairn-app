import { invoke } from "@tauri-apps/api/core";

export interface CliStatus {
	installed: boolean;
	path: string | null;
	target: string | null;
	upToDate: boolean;
	launcherAvailable: boolean;
}

export function getCliStatus(): Promise<CliStatus> {
	return invoke<CliStatus>("get_cli_status");
}

export function installCli(): Promise<CliStatus> {
	return invoke<CliStatus>("install_cli");
}

export function uninstallCli(): Promise<CliStatus> {
	return invoke<CliStatus>("uninstall_cli");
}

export function takePendingCliPaths(): Promise<string[]> {
	return invoke<string[]>("take_pending_cli_paths");
}
