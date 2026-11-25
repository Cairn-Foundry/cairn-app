// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
	Container,
	PublishedPort,
} from "#lib/services/containers-service";

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
	key: "name" | "uptime";
	/** Against the key's natural order: Z to A, or most recently started first. */
	reversed: boolean;
}

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
): number {
	const byRunning = Number(isRunning(b)) - Number(isRunning(a));
	if (byRunning) return byRunning;
	const sign = sort.reversed ? -1 : 1;
	if (sort.key === "uptime" && isRunning(a)) {
		const byStart = startedMs(a) - startedMs(b);
		if (byStart) return sign * byStart;
	}
	return (sort.key === "name" ? sign : 1) * a.name.localeCompare(b.name);
}

/**
 * Running containers come first in a group, and groups with something running
 * before the others; the standalone containers always close the list, whatever
 * the sort. Under the uptime sort a group ranks by its first running container,
 * so the stack up the longest (or, reversed, started last) leads.
 */
export function groupContainers(
	containers: Container[],
	query: string,
	showStopped: boolean,
	sort: ContainerSort = DEFAULT_SORT,
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
		g.containers.sort((a, b) => compareContainers(a, b, sort));
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
		return (
			(sort.key === "name" ? sign : 1) * a.project.localeCompare(b.project)
		);
	});
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
