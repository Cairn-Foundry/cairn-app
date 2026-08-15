import { invoke } from "@tauri-apps/api/core";

export interface ListeningPort {
	id: string;
	pid: number;
	port: number;
	address: string;
	family: string;
	process: string;
	command: string;
	user: string;
	isOwned: boolean;
}

export async function listListeningPorts(): Promise<ListeningPort[]> {
	return await invoke<ListeningPort[]>("list_listening_ports");
}

export async function killProcess(pid: number, force = false): Promise<void> {
	await invoke("kill_process", { pid, force });
}
