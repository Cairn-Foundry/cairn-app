// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

export interface PublishedPort {
	hostIp: string;
	hostPort: number;
	containerPort: number;
	protocol: string;
}

export type ContainerHealth = "healthy" | "unhealthy" | "starting" | "";

export interface Container {
	id: string;
	name: string;
	image: string;
	state: string;
	health: ContainerHealth;
	exitCode: number | null;
	status: string;
	startedAt: string;
	finishedAt: string;
	ports: PublishedPort[];
	composeProject: string;
	composeService: string;
	composeWorkingDir: string;
}

export type DockerStatus =
	| "ok"
	| "notInstalled"
	| "daemonDown"
	| "permissionDenied"
	| "error";

export interface ContainersReport {
	status: DockerStatus;
	containers: Container[];
	message: string;
}

export async function listContainers(): Promise<ContainersReport> {
	return await invoke<ContainersReport>("list_containers");
}

export type ContainerAction = "start" | "stop" | "restart" | "remove";

export async function containerAction(
	ids: string[],
	action: ContainerAction,
): Promise<void> {
	await invoke("container_action", { ids, action });
}

export async function composeDown(project: string): Promise<void> {
	await invoke("compose_down", { project });
}
