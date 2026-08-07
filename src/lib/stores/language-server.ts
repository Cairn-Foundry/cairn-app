import { listen } from "@tauri-apps/api/event";
import { get, writable } from "svelte/store";
import {
	type LanguageServerInfo,
	type LanguageServerStatus,
	type LspDiagnostic,
	type LspDiagnosticsEvent,
	type LspDocRef,
	type LspManagerEvent,
	type LspStatusEvent,
	listLanguageServers,
	startLanguageServer,
	stopLanguageServersFor,
	stopLanguageServersWithId,
} from "$lib/services/lsp-service";
import type {
	CairnSettings,
	LanguageServerSetting,
} from "$lib/services/settings-service";
import { settings } from "$lib/stores/settings";
import { isUnder } from "$lib/utils/files/files-tree";
import {
	LANGUAGE_SERVERS,
	type LanguageServerDef,
	serverForPath,
} from "$lib/utils/languages/servers";

const _infos = writable<LanguageServerInfo[]>([]);
const _statuses = writable<Record<string, LanguageServerStatus>>({});
const _diagnostics = writable<Record<string, LspDiagnostic[]>>({});
const _managerOutput = writable<Record<string, string>>({});

export const languageServerInfos = { subscribe: _infos.subscribe };
export const languageServerStatuses = { subscribe: _statuses.subscribe };
export const lspDiagnostics = { subscribe: _diagnostics.subscribe };
export const managerOutput = { subscribe: _managerOutput.subscribe };

function statusKey(serverId: string, root: string): string {
	return `${serverId}:${root}`;
}

/**
 * The status of a server whatever root it runs on. The catalogue page lists
 * servers, not workspaces, so it reports the one instance that is up.
 */
export function liveStatusFor(
	statuses: Record<string, LanguageServerStatus>,
	serverId: string,
): LanguageServerStatus | null {
	const entry = Object.entries(statuses).find(
		([key, status]) => key.startsWith(`${serverId}:`) && status !== "stopped",
	);
	return entry ? entry[1] : null;
}

export async function refreshLanguageServers(
	root: string | null,
): Promise<void> {
	try {
		_infos.set(await listLanguageServers(root));
	} catch {}
}

let unlisten: (() => void)[] = [];

export function initLanguageServers(): void {
	if (unlisten.length > 0) return;
	void listen<LspStatusEvent>("lsp-status", ({ payload }) => {
		_statuses.update((current) => ({
			...current,
			[statusKey(payload.serverId, payload.root)]: payload.status,
		}));
	}).then((off) => unlisten.push(off));

	void listen<LspManagerEvent>("lsp-manager", ({ payload }) => {
		_managerOutput.update((current) => ({
			...current,
			[payload.serverId]: payload.line,
		}));
	}).then((off) => unlisten.push(off));

	void listen<LspDiagnosticsEvent>("lsp-diagnostics", ({ payload }) => {
		_diagnostics.update((current) => ({
			...current,
			[payload.path]: payload.diagnostics,
		}));
	}).then((off) => unlisten.push(off));
}

export function disposeLanguageServers(): void {
	for (const off of unlisten) off();
	unlisten = [];
}

function settingFor(id: string): LanguageServerSetting | null {
	return get(settings).languageServers.find((s) => s.id === id) ?? null;
}

function isServerEnabled(id: string): boolean {
	return settingFor(id)?.enabled ?? false;
}

/**
 * Turning a server off stops it there and then. Only writing the setting would
 * leave the process running and its diagnostics on screen until a restart -
 * the switch would read as broken.
 */
export function setServerEnabled(id: string, enabled: boolean): void {
	const current = get(settings).languageServers;
	const existing = current.find((s) => s.id === id);
	const next = existing
		? current.map((s) => (s.id === id ? { ...s, enabled } : s))
		: [...current, { id, enabled, command: "", args: [] }];
	settings.save({ languageServers: next });

	if (!enabled) {
		clearDiagnosticsOf(id);
		void stopLanguageServersWithId(id).catch(() => {});
	}
}

/** Drops the diagnostics of every file the server covers. */
function clearDiagnosticsOf(id: string): void {
	const def = LANGUAGE_SERVERS.find((s) => s.id === id);
	if (!def) return;
	_diagnostics.update((current) =>
		Object.fromEntries(
			Object.entries(current).filter(
				([path]) => serverForPath(path)?.id !== def.id,
			),
		),
	);
}

/** Drops the diagnostics of one file, when its last tab closes. */
export function clearDiagnosticsFor(path: string): void {
	_diagnostics.update(({ [path]: _dropped, ...rest }) => rest);
}

export function clearManagerOutput(id: string): void {
	_managerOutput.update(({ [id]: _dropped, ...rest }) => rest);
}

export function dismissServerSuggestion(id: string): void {
	const current = get(settings).dismissedLanguageServers;
	if (current.includes(id)) return;
	settings.save({ dismissedLanguageServers: [...current, id] });
}

/**
 * Whether a file is worth suggesting a server for: covered by the catalogue,
 * not enabled, not dismissed, and suggestions still wanted. Takes the settings
 * rather than reading them so callers stay reactive.
 */
export function shouldSuggestFor(
	path: string,
	config: CairnSettings,
): LanguageServerDef | null {
	if (!config.suggestLanguageServers) return null;
	const def = serverForPath(path);
	if (!def) return null;
	if (config.languageServers.find((s) => s.id === def.id)?.enabled) return null;
	if (config.dismissedLanguageServers.includes(def.id)) return null;
	return def;
}

const starting = new Map<string, Promise<string | null>>();

/**
 * Lazy start: the server for this file comes up on the first file of its
 * language, never at launch. Answers with the document reference every later
 * call needs, or null when no server is enabled for that file.
 */
export async function ensureDocument(
	worktree: string,
	absolutePath: string,
): Promise<LspDocRef | null> {
	const def = serverForPath(absolutePath);
	if (!def || !isServerEnabled(def.id)) return null;

	const setting = settingFor(def.id);
	const key = `${def.id}:${worktree}:${absolutePath}`;
	let pending = starting.get(key);
	if (!pending) {
		pending = startLanguageServer(
			def.id,
			worktree,
			absolutePath,
			setting?.command ?? "",
			setting?.args ?? [],
		).catch(() => null);
		starting.set(key, pending);
		void pending.finally(() => starting.delete(key));
	}

	const root = await pending;
	return root ? { serverId: def.id, root, path: absolutePath } : null;
}

function clearDiagnosticsUnder(worktree: string): void {
	_diagnostics.update((current) => {
		const next: Record<string, LspDiagnostic[]> = {};
		for (const [path, list] of Object.entries(current)) {
			if (!isUnder(path, worktree)) next[path] = list;
		}
		return next;
	});
}

export async function stopServersForWorktree(worktree: string): Promise<void> {
	clearDiagnosticsUnder(worktree);
	await stopLanguageServersFor(worktree).catch(() => {});
}
