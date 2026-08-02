import { get, writable } from "svelte/store";
import {
	closeAllTerminals,
	closeTerminal as closeTerminalCmd,
	createTerminal,
	getProjectTerminalState,
	getTerminalState,
	saveProjectTerminalState,
	saveTerminalState,
} from "$lib/services/terminal-service";
import * as manager from "$lib/utils/terminal/terminal-manager";
import { insertAt, moveItem } from "$lib/utils/terminal/terminal-order";

export interface TerminalSession {
	id: string;
	title: string;
	commandId?: string;
	icon?: string;
	port?: number;
}

export interface ProjectTerminalSession extends TerminalSession {
	cwd: string | null;
}

export const terminalSessions = writable<Record<string, TerminalSession[]>>({});

export const projectTerminals = writable<
	Record<string, ProjectTerminalSession[]>
>({});

export const activeTerminalId = writable<Record<string, string | null>>({});

export const splitTerminalId = writable<Record<string, string | null>>({});

export const splitTerminalRatio = writable<Record<string, number>>({});

export const DEFAULT_SPLIT_RATIO = 0.5;

const restored = new Set<string>();
const restoredProjects = new Set<string>();

let cleanupDone: Promise<void> | null = null;

export function terminalScope(projectId: string, instanceId: string): string {
	return `${projectId}:${instanceId}`;
}

export function initTerminals(): void {
	if (!cleanupDone) cleanupDone = closeAllTerminals().catch(() => {});
}

function persist(projectId: string, instanceId: string): void {
	const key = terminalScope(projectId, instanceId);
	const terminals = get(terminalSessions)[key] ?? [];
	const activeId = get(activeTerminalId)[key] ?? null;
	const splitId = get(splitTerminalId)[key] ?? null;
	const splitRatio = get(splitTerminalRatio)[key] ?? DEFAULT_SPLIT_RATIO;
	void saveTerminalState(projectId, instanceId, {
		terminals,
		activeId,
		splitId,
		splitRatio,
	}).catch(() => {});
}

function persistProject(projectId: string): void {
	const terminals = get(projectTerminals)[projectId] ?? [];
	void saveProjectTerminalState(projectId, { terminals }).catch(() => {});
}

// Create the xterm sink before spawning the shell so no early output is lost.
async function spawn(
	id: string,
	cwd: string | null,
	command: string | null = null,
	env: Record<string, string> | null = null,
): Promise<void> {
	manager.create(id);
	const { cols, rows } = manager.size(id);
	await createTerminal(id, cwd, cols, rows, command, env);
}

export async function restoreTerminals(
	projectId: string,
	instanceId: string,
	cwd: string | null,
	env: Record<string, string> | null = null,
): Promise<void> {
	const key = terminalScope(projectId, instanceId);
	if (restored.has(key)) return;
	restored.add(key);

	if (cleanupDone) await cleanupDone;

	const saved = await getTerminalState(projectId, instanceId).catch(() => null);
	const tabs = (saved?.terminals ?? []).filter((tab) => !tab.commandId);

	splitTerminalId.update((m) => ({ ...m, [key]: saved?.splitId ?? null }));
	splitTerminalRatio.update((m) => ({
		...m,
		[key]: saved?.splitRatio ?? DEFAULT_SPLIT_RATIO,
	}));

	if (tabs.length === 0) return;

	for (const tab of tabs) {
		await spawn(tab.id, cwd, null, env);
	}

	terminalSessions.update((m) => ({ ...m, [key]: tabs }));
	activeTerminalId.update((m) => ({
		...m,
		[key]: saved?.activeId ?? tabs[0].id,
	}));
}

export async function restoreProjectTerminals(
	projectId: string,
	env: Record<string, string> | null = null,
): Promise<void> {
	if (restoredProjects.has(projectId)) return;
	restoredProjects.add(projectId);

	if (cleanupDone) await cleanupDone;

	const saved = await getProjectTerminalState(projectId).catch(() => null);
	const tabs = saved?.terminals ?? [];
	if (tabs.length === 0) return;

	for (const tab of tabs) {
		await spawn(tab.id, tab.cwd, null, env);
	}

	projectTerminals.update((m) => ({ ...m, [projectId]: tabs }));
}

export async function addTerminal(
	projectId: string,
	instanceId: string,
	cwd: string | null,
	env: Record<string, string> | null = null,
): Promise<void> {
	const key = terminalScope(projectId, instanceId);
	const id = `${instanceId}:${crypto.randomUUID()}`;
	const list = get(terminalSessions)[key] ?? [];
	const title = `Terminal ${list.length + 1}`;

	await spawn(id, cwd, null, env);

	terminalSessions.update((m) => ({
		...m,
		[key]: [...(m[key] ?? []), { id, title }],
	}));
	activeTerminalId.update((m) => ({ ...m, [key]: id }));
	persist(projectId, instanceId);
}

export async function addCommandTerminal(
	projectId: string,
	instanceId: string,
	cwd: string | null,
	tab: Omit<TerminalSession, "id">,
	script: string,
	env: Record<string, string>,
): Promise<string> {
	const key = terminalScope(projectId, instanceId);
	const id = `${instanceId}:${crypto.randomUUID()}`;

	await spawn(id, cwd, script, env);

	terminalSessions.update((m) => ({
		...m,
		[key]: [...(m[key] ?? []), { ...tab, id }],
	}));
	activeTerminalId.update((m) => ({ ...m, [key]: id }));
	persist(projectId, instanceId);
	return id;
}

export async function addProjectTerminal(
	projectId: string,
	instanceId: string,
	cwd: string | null,
	env: Record<string, string> | null = null,
): Promise<void> {
	const id = `${projectId}:${crypto.randomUUID()}`;
	const list = get(projectTerminals)[projectId] ?? [];
	const title = `Terminal ${list.length + 1}`;

	await spawn(id, cwd, null, env);

	projectTerminals.update((m) => ({
		...m,
		[projectId]: [...(m[projectId] ?? []), { id, title, cwd }],
	}));
	activeTerminalId.update((m) => ({
		...m,
		[terminalScope(projectId, instanceId)]: id,
	}));
	persistProject(projectId);
}

export async function removeTerminal(
	projectId: string,
	instanceId: string,
	id: string,
): Promise<void> {
	const key = terminalScope(projectId, instanceId);
	await closeTerminalCmd(id).catch(() => {});
	manager.dispose(id);

	terminalSessions.update((m) => ({
		...m,
		[key]: (m[key] ?? []).filter((t) => t.id !== id),
	}));
	splitTerminalId.update((m) => (m[key] === id ? { ...m, [key]: null } : m));
	activeTerminalId.update((m) => {
		if (m[key] !== id) return m;
		const list = get(terminalSessions)[key] ?? [];
		const splitId = get(splitTerminalId)[key];
		const fallback = list.filter((s) => s.id !== splitId);
		return { ...m, [key]: fallback[fallback.length - 1]?.id ?? null };
	});
	persist(projectId, instanceId);
}

export async function removeProjectTerminal(
	projectId: string,
	id: string,
): Promise<void> {
	await closeTerminalCmd(id).catch(() => {});
	manager.dispose(id);

	projectTerminals.update((m) => ({
		...m,
		[projectId]: (m[projectId] ?? []).filter((t) => t.id !== id),
	}));
	const fallback = get(projectTerminals)[projectId] ?? [];
	splitTerminalId.update((m) => {
		const next = { ...m };
		for (const key of Object.keys(next)) {
			if (next[key] === id) next[key] = null;
		}
		return next;
	});
	activeTerminalId.update((m) => {
		const next = { ...m };
		for (const key of Object.keys(next)) {
			if (next[key] === id)
				next[key] = fallback[fallback.length - 1]?.id ?? null;
		}
		return next;
	});
	persistProject(projectId);
}

export function setActiveTerminal(
	projectId: string,
	instanceId: string,
	id: string,
	pane: 0 | 1 = 0,
): void {
	const key = terminalScope(projectId, instanceId);
	const store = pane === 1 ? splitTerminalId : activeTerminalId;
	store.update((m) => ({ ...m, [key]: id }));
	persist(projectId, instanceId);
}

export function openSplitTerminal(
	projectId: string,
	instanceId: string,
	id: string,
): void {
	const key = terminalScope(projectId, instanceId);
	splitTerminalId.update((m) => ({ ...m, [key]: id }));
	if (get(splitTerminalRatio)[key] === undefined) {
		splitTerminalRatio.update((m) => ({ ...m, [key]: DEFAULT_SPLIT_RATIO }));
	}
	persist(projectId, instanceId);
}

export function closeSplitTerminal(
	projectId: string,
	instanceId: string,
): void {
	const key = terminalScope(projectId, instanceId);
	splitTerminalId.update((m) => ({ ...m, [key]: null }));
	persist(projectId, instanceId);
}

export function setSplitRatio(
	projectId: string,
	instanceId: string,
	ratio: number,
): void {
	const key = terminalScope(projectId, instanceId);
	splitTerminalRatio.update((m) => ({ ...m, [key]: ratio }));
	persist(projectId, instanceId);
}

export function renameTerminal(
	projectId: string,
	instanceId: string,
	id: string,
	title: string,
): void {
	const key = terminalScope(projectId, instanceId);
	terminalSessions.update((m) => ({
		...m,
		[key]: (m[key] ?? []).map((s) => (s.id === id ? { ...s, title } : s)),
	}));
	persist(projectId, instanceId);
}

export function renameProjectTerminal(
	projectId: string,
	id: string,
	title: string,
): void {
	projectTerminals.update((m) => ({
		...m,
		[projectId]: (m[projectId] ?? []).map((s) =>
			s.id === id ? { ...s, title } : s,
		),
	}));
	persistProject(projectId);
}

export function reorderTerminal(
	projectId: string,
	instanceId: string,
	fromIndex: number,
	insertIndex: number,
): void {
	const key = terminalScope(projectId, instanceId);
	terminalSessions.update((m) => ({
		...m,
		[key]: moveItem(m[key] ?? [], fromIndex, insertIndex),
	}));
	persist(projectId, instanceId);
}

export function reorderProjectTerminal(
	projectId: string,
	fromIndex: number,
	insertIndex: number,
): void {
	projectTerminals.update((m) => ({
		...m,
		[projectId]: moveItem(m[projectId] ?? [], fromIndex, insertIndex),
	}));
	persistProject(projectId);
}

export function shareTerminal(
	projectId: string,
	instanceId: string,
	id: string,
	cwd: string | null,
	insertIndex: number,
): void {
	const key = terminalScope(projectId, instanceId);
	const session = (get(terminalSessions)[key] ?? []).find((s) => s.id === id);
	if (!session) return;

	terminalSessions.update((m) => ({
		...m,
		[key]: (m[key] ?? []).filter((s) => s.id !== id),
	}));
	projectTerminals.update((m) => ({
		...m,
		[projectId]: insertAt(m[projectId] ?? [], { ...session, cwd }, insertIndex),
	}));
	persist(projectId, instanceId);
	persistProject(projectId);
}

export function unshareTerminal(
	projectId: string,
	instanceId: string,
	id: string,
	insertIndex: number,
): void {
	const key = terminalScope(projectId, instanceId);
	const session = (get(projectTerminals)[projectId] ?? []).find(
		(s) => s.id === id,
	);
	if (!session) return;

	projectTerminals.update((m) => ({
		...m,
		[projectId]: (m[projectId] ?? []).filter((s) => s.id !== id),
	}));
	terminalSessions.update((m) => ({
		...m,
		[key]: insertAt(
			m[key] ?? [],
			{ id: session.id, title: session.title },
			insertIndex,
		),
	}));
	persist(projectId, instanceId);
	persistProject(projectId);
}

export async function removeInstanceTerminals(
	projectId: string,
	instanceId: string,
): Promise<void> {
	const key = terminalScope(projectId, instanceId);
	const list = get(terminalSessions)[key] ?? [];
	for (const s of list) {
		await closeTerminalCmd(s.id).catch(() => {});
		manager.dispose(s.id);
	}
	restored.delete(key);
	terminalSessions.update((m) => {
		const next = { ...m };
		delete next[key];
		return next;
	});
	const forget = <T>(m: Record<string, T>) => {
		const next = { ...m };
		delete next[key];
		return next;
	};
	activeTerminalId.update(forget);
	splitTerminalId.update(forget);
	splitTerminalRatio.update(forget);
}
