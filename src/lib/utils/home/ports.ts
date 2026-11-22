// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// The listening sockets of the machine, gathered by the process holding them:
// stopping a process frees every port it holds, so the process is what the
// Ports screen lists and acts on.

import type { ListeningPort } from "#lib/services/ports-service";

/** One port a process holds, with every address it is bound on. */
export interface HeldPort {
	port: number;
	addresses: string[];
	/** Bound on every interface, so another machine of the network can reach it. */
	isExposed: boolean;
}

export interface ProcessPorts {
	pid: number;
	process: string;
	command: string;
	user: string;
	isOwned: boolean;
	ports: HeldPort[];
}

const ANY_ADDRESS = new Set(["*", "0.0.0.0", "::", "[::]"]);

/**
 * The absolute path of the binary is noise - it repeats the process name and
 * pushes the arguments, which is what tells one `node` from another, out of
 * view. Each path-looking token is reduced to its basename, and a command that
 * then says no more than the process name is dropped.
 */
export function shortCommand(process: string, command: string): string {
	if (!command) return "";
	const short = command
		.split(" ")
		.map((token) =>
			token.startsWith("/") ? (token.split("/").pop() ?? token) : token,
		)
		.join(" ");
	return short === process ? "" : short;
}

/** Sockets grouped by PID, the caller's own processes first, then by lowest port. */
export function groupByProcess(sockets: ListeningPort[]): ProcessPorts[] {
	const byPid = new Map<number, ProcessPorts>();
	for (const socket of sockets) {
		const entry = byPid.get(socket.pid) ?? {
			pid: socket.pid,
			process: socket.process,
			command: socket.command,
			user: socket.user,
			isOwned: socket.isOwned,
			ports: [],
		};
		const held = entry.ports.find((p) => p.port === socket.port);
		if (held) {
			if (!held.addresses.includes(socket.address))
				held.addresses.push(socket.address);
			held.isExposed ||= ANY_ADDRESS.has(socket.address);
		} else {
			entry.ports.push({
				port: socket.port,
				addresses: [socket.address],
				isExposed: ANY_ADDRESS.has(socket.address),
			});
		}
		byPid.set(socket.pid, entry);
	}
	const groups = [...byPid.values()];
	for (const group of groups) group.ports.sort((a, b) => a.port - b.port);
	return groups.sort(
		(a, b) =>
			Number(b.isOwned) - Number(a.isOwned) ||
			a.ports[0].port - b.ports[0].port,
	);
}

/** Whether a process answers a search on its ports, name, command or PID. */
export function matchesProcess(group: ProcessPorts, query: string): boolean {
	const q = query.trim().toLowerCase();
	if (!q) return true;
	return (
		group.ports.some((p) => String(p.port).includes(q)) ||
		group.process.toLowerCase().includes(q) ||
		group.command.toLowerCase().includes(q) ||
		String(group.pid).includes(q)
	);
}
