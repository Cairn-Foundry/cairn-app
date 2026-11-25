// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
	Container,
	ContainerStats,
	PublishedPort,
} from "#lib/services/containers-service";

export type StatsById = ReadonlyMap<string, ContainerStats>;

export interface ContainerGroup {
	/** The Compose project name, empty for the standalone group. */
	project: string;
	workingDir: string;
	containers: Container[];
	running: number;
}

const isRunning = (c: Container) => c.state === "running";

function matches(c: Container, query: string): boolean {
	return [
		c.name,
		c.image,
		c.composeProject,
		c.composeService,
		c.composeWorkingDir,
	].some((v) => v.toLowerCase().includes(query));
}

export interface ContainerSort {
	key: "name" | "uptime" | "memory" | "cpu";
	/**
	 * Against the key's natural order: Z to A, most recently started first, or
	 * the lightest first (memory and CPU start with the heaviest).
	 */
	reversed: boolean;
}

export interface Usage {
	cpuPercent: number;
	memoryBytes: number;
}

/** What the running containers among these use, as far as the last sample knows. */
export function usageOf(containers: Container[], stats: StatsById): Usage {
	let cpuPercent = 0;
	let memoryBytes = 0;
	for (const c of containers) {
		const s = isRunning(c) ? stats.get(c.id) : undefined;
		if (!s) continue;
		cpuPercent += s.cpuPercent;
		memoryBytes += s.memoryBytes;
	}
	return { cpuPercent, memoryBytes };
}

const usageKey = (key: ContainerSort["key"]) =>
	key === "memory" ? "memoryBytes" : "cpuPercent";

export const DEFAULT_SORT: ContainerSort = { key: "name", reversed: false };

/** Started longest ago first; a container with no start time sorts last. */
function startedMs(c: Container): number {
	const ms = Date.parse(c.startedAt);
	return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}

function compareContainers(
	a: Container,
	b: Container,
	sort: ContainerSort,
	stats: StatsById,
): number {
	const byRunning = Number(isRunning(b)) - Number(isRunning(a));
	if (byRunning) return byRunning;
	const sign = sort.reversed ? -1 : 1;
	if (sort.key === "uptime" && isRunning(a)) {
		const byStart = startedMs(a) - startedMs(b);
		if (byStart) return sign * byStart;
	}
	if ((sort.key === "memory" || sort.key === "cpu") && isRunning(a)) {
		const k = usageKey(sort.key);
		const byUsage = (stats.get(b.id)?.[k] ?? -1) - (stats.get(a.id)?.[k] ?? -1);
		if (byUsage) return sign * byUsage;
	}
	return (sort.key === "name" ? sign : 1) * a.name.localeCompare(b.name);
}

/**
 * Running containers come first in a group, and groups with something running
 * before the others; the standalone containers always close the list, whatever
 * the sort. Under the uptime sort a group ranks by its first running container,
 * so the stack up the longest (or, reversed, started last) leads. Under the
 * memory and CPU sorts a group ranks by what its running containers use together.
 */
export function groupContainers(
	containers: Container[],
	query: string,
	showStopped: boolean,
	sort: ContainerSort = DEFAULT_SORT,
	stats: StatsById = new Map(),
): ContainerGroup[] {
	const q = query.trim().toLowerCase();
	const groups = new Map<string, ContainerGroup>();
	for (const c of containers) {
		if (!showStopped && !isRunning(c)) continue;
		if (q && !matches(c, q)) continue;
		let group = groups.get(c.composeProject);
		if (!group) {
			group = {
				project: c.composeProject,
				workingDir: c.composeWorkingDir,
				containers: [],
				running: 0,
			};
			groups.set(c.composeProject, group);
		}
		group.containers.push(c);
		if (isRunning(c)) group.running++;
	}
	for (const g of groups.values()) {
		g.containers.sort((a, b) => compareContainers(a, b, sort, stats));
	}
	return [...groups.values()].sort((a, b) => {
		if (!a.project !== !b.project) return a.project ? -1 : 1;
		const byRunning = Number(b.running > 0) - Number(a.running > 0);
		if (byRunning) return byRunning;
		const sign = sort.reversed ? -1 : 1;
		if (sort.key === "uptime" && a.running > 0) {
			const byStart = startedMs(a.containers[0]) - startedMs(b.containers[0]);
			if (byStart) return sign * byStart;
		}
		if ((sort.key === "memory" || sort.key === "cpu") && a.running > 0) {
			const k = usageKey(sort.key);
			const byUsage =
				usageOf(b.containers, stats)[k] - usageOf(a.containers, stats)[k];
			if (byUsage) return sign * byUsage;
		}
		return (
			(sort.key === "name" ? sign : 1) * a.project.localeCompare(b.project)
		);
	});
}

/** Docker's CPU share, of one core: one decimal while it is small. */
export function formatCpu(percent: number): string {
	return `${percent.toFixed(percent < 10 ? 1 : 0)} %`;
}

/** The URL a published port answers on, from this machine. */
export function portUrl(port: PublishedPort): string {
	const host =
		port.hostIp === "*" || port.hostIp === "0.0.0.0"
			? "localhost"
			: port.hostIp.includes(":")
				? `[${port.hostIp}]`
				: port.hostIp;
	return `http://${host}:${port.hostPort}`;
}

/** Inside a Compose group the project prefix repeats on every row. */
export function displayName(c: Container): string {
	return c.composeService || c.name;
}

/** Follows a container's output, starting from its last lines. */
export function logsArgv(c: Container): string[] {
	return ["docker", "logs", "--follow", "--tail", "500", c.id];
}

/** An interactive shell in a running container: bash when the image has it, sh otherwise. */
export function shellArgv(c: Container): string[] {
	return [
		"docker",
		"exec",
		"-it",
		c.id,
		"sh",
		"-c",
		"if command -v bash >/dev/null 2>&1; then exec bash; else exec sh; fi",
	];
}
