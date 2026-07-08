import { get, writable } from "svelte/store";
import {
	closeAllTerminals,
	closeTerminal as closeTerminalCmd,
	createTerminal,
	getTerminalState,
	saveTerminalState,
} from "$lib/services/terminal-service";
import * as manager from "$lib/utils/terminal/terminal-manager";

export interface TerminalSession {
	id: string;
	title: string;
}

export const terminalSessions = writable<Record<string, TerminalSession[]>>({});

export const activeTerminalId = writable<Record<string, string | null>>({});

const restored = new Set<string>();

let cleanupDone: Promise<void> | null = null;

export function initTerminals(): void {
	if (!cleanupDone) cleanupDone = closeAllTerminals().catch(() => {});
}

function persist(projectId: string, instanceId: string): void {
	const terminals = get(terminalSessions)[instanceId] ?? [];
	const activeId = get(activeTerminalId)[instanceId] ?? null;
	void saveTerminalState(projectId, instanceId, { terminals, activeId }).catch(
		() => {},
	);
}

export async function restoreTerminals(
	projectId: string,
	instanceId: string,
	cwd: string | null,
): Promise<void> {
	if (restored.has(instanceId)) return;
	restored.add(instanceId);

	if (cleanupDone) await cleanupDone;

	const saved = await getTerminalState(projectId, instanceId).catch(() => null);
	const tabs = saved?.terminals ?? [];
	if (tabs.length === 0) return;

	for (const tab of tabs) {
		manager.create(tab.id);
		const { cols, rows } = manager.size(tab.id);
		await createTerminal(tab.id, cwd, cols, rows);
	}

	terminalSessions.update((m) => ({ ...m, [instanceId]: tabs }));
	activeTerminalId.update((m) => ({
		...m,
		[instanceId]: saved?.activeId ?? tabs[0].id,
	}));
}

export async function addTerminal(
	projectId: string,
	instanceId: string,
	cwd: string | null,
): Promise<void> {
	const id = `${instanceId}:${crypto.randomUUID()}`;
	const list = get(terminalSessions)[instanceId] ?? [];
	const title = `Terminal ${list.length + 1}`;

	// Create the xterm sink before spawning the shell so no early output is lost.
	manager.create(id);
	const { cols, rows } = manager.size(id);
	await createTerminal(id, cwd, cols, rows);

	terminalSessions.update((m) => ({
		...m,
		[instanceId]: [...(m[instanceId] ?? []), { id, title }],
	}));
	activeTerminalId.update((m) => ({ ...m, [instanceId]: id }));
	persist(projectId, instanceId);
}

export async function removeTerminal(
	projectId: string,
	instanceId: string,
	id: string,
): Promise<void> {
	await closeTerminalCmd(id).catch(() => {});
	manager.dispose(id);

	terminalSessions.update((m) => ({
		...m,
		[instanceId]: (m[instanceId] ?? []).filter((t) => t.id !== id),
	}));
	activeTerminalId.update((m) => {
		if (m[instanceId] !== id) return m;
		const list = get(terminalSessions)[instanceId] ?? [];
		return { ...m, [instanceId]: list[list.length - 1]?.id ?? null };
	});
	persist(projectId, instanceId);
}

export function setActiveTerminal(
	projectId: string,
	instanceId: string,
	id: string,
): void {
	activeTerminalId.update((m) => ({ ...m, [instanceId]: id }));
	persist(projectId, instanceId);
}

export function renameTerminal(
	projectId: string,
	instanceId: string,
	id: string,
	title: string,
): void {
	terminalSessions.update((m) => ({
		...m,
		[instanceId]: (m[instanceId] ?? []).map((s) =>
			s.id === id ? { ...s, title } : s,
		),
	}));
	persist(projectId, instanceId);
}

export async function removeInstanceTerminals(
	instanceId: string,
): Promise<void> {
	const list = get(terminalSessions)[instanceId] ?? [];
	for (const s of list) {
		await closeTerminalCmd(s.id).catch(() => {});
		manager.dispose(s.id);
	}
	restored.delete(instanceId);
	terminalSessions.update((m) => {
		const next = { ...m };
		delete next[instanceId];
		return next;
	});
	activeTerminalId.update((m) => {
		const next = { ...m };
		delete next[instanceId];
		return next;
	});
}
