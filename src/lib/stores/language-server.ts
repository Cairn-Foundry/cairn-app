/** Language servers: catalogue, per-root status, diagnostics, and the settings that enable them. */
import { listen } from "@tauri-apps/api/event";
import { get, writable } from "svelte/store";
import {
	checkLanguageServerUpdates,
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
	type UpdateCheck,
} from "$lib/services/lsp-service";
import type {
	CairnSettings,
	CustomLanguageServer,
	LanguageServerSetting,
} from "$lib/services/settings-service";
import { settings } from "$lib/stores/settings";
import { isUnder } from "$lib/utils/files/files-tree";
import {
	allServers,
	type LanguageServerDef,
	serverForPath,
} from "$lib/utils/languages/servers";

/** Catalogue entries with their install state, as the backend reports them. */
const _infos = writable<LanguageServerInfo[]>([]);
/** Status of each running server, keyed by statusKey(): one entry per server and workspace root. */
const _statuses = writable<Record<string, LanguageServerStatus>>({});
/** Diagnostics per absolute file path, as pushed by the servers. */
const _diagnostics = writable<Record<string, LspDiagnostic[]>>({});
/** Last install or update line per server, for the progress shown on its card. */
const _managerOutput = writable<Record<string, string>>({});
/** Result of the last update check, in memory only: see checkForUpdates(). */
const _updateChecks = writable<Record<string, UpdateCheck>>({});

/** Read-only views; every write goes through the functions below. */
export const languageServerInfos = { subscribe: _infos.subscribe };
export const languageServerStatuses = { subscribe: _statuses.subscribe };
export const lspDiagnostics = { subscribe: _diagnostics.subscribe };
export const managerOutput = { subscribe: _managerOutput.subscribe };
export const updateChecks = { subscribe: _updateChecks.subscribe };

/** A server is one process per workspace root, so both make the key. */
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

/** Reloads the catalogue and its install state; a failure leaves the previous list showing. */
export async function refreshLanguageServers(
	root: string | null,
): Promise<void> {
	try {
		_infos.set(await listLanguageServers(root));
	} catch {}
}

/**
 * What the last check found, by server id. Held in memory only: a verdict read
 * from disk would be a claim about a registry nobody has asked since, and the
 * page must never say "up to date" on the strength of yesterday's answer.
 */
export async function checkForUpdates(root: string | null): Promise<void> {
	try {
		const checks = await checkLanguageServerUpdates(root);
		_updateChecks.set(Object.fromEntries(checks.map((c) => [c.serverId, c])));
	} catch {}
}

/** Drops what the check knew about one server, once it has been acted on. */
export function clearUpdateCheck(id: string): void {
	_updateChecks.update(({ [id]: _dropped, ...rest }) => rest);
}

let unlisten: (() => void)[] = [];

/** Subscribes to the backend LSP events, once; call disposeLanguageServers() to unsubscribe. */
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

/** Detaches the event listeners. */
export function disposeLanguageServers(): void {
	for (const off of unlisten) off();
	unlisten = [];
}

/** The user setting for a server, or null when it has never been configured. */
function settingFor(id: string): LanguageServerSetting | null {
	return get(settings).languageServers.find((s) => s.id === id) ?? null;
}

/** A server with no setting counts as disabled: nothing starts unless the user asked for it. */
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

/**
 * A user server is stored as a definition of its own, plus the same enabled
 * flag every catalogue server has. Its id is derived from its name so it reads
 * as something in `settings.json`, and kept unique against everything already
 * there - a duplicate id would be dropped by the backend without a word.
 */
export function customServerId(name: string, taken: string[]): string {
	const base =
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "server";
	let id = base;
	for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
	return id;
}

/**
 * Adds or replaces a user server, matched on its id. Awaits the write: the
 * backend builds its catalogue from `settings.json`, so listing before the file
 * lands would answer without the server that was just declared.
 */
export async function saveCustomServer(
	server: CustomLanguageServer,
): Promise<void> {
	const current = get(settings).customLanguageServers;
	const next = current.some((s) => s.id === server.id)
		? current.map((s) => (s.id === server.id ? server : s))
		: [...current, server];
	await settings.save({ customLanguageServers: next });
}

/**
 * Removes a user server: the process goes down, its diagnostics with it, and
 * the enabled flag it left behind goes too, so re-adding the same id later does
 * not come back mysteriously switched on.
 */
export async function removeCustomServer(id: string): Promise<void> {
	const config = get(settings);
	clearDiagnosticsOf(id);
	void stopLanguageServersWithId(id).catch(() => {});
	await settings.save({
		customLanguageServers: config.customLanguageServers.filter(
			(s) => s.id !== id,
		),
		languageServers: config.languageServers.filter((s) => s.id !== id),
	});
}

/** Drops the diagnostics of every file the server covers. */
function clearDiagnosticsOf(id: string): void {
	const def = allServers().find((s) => s.id === id);
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

/** Clears the progress line of a server once its install is over. */
export function clearManagerOutput(id: string): void {
	_managerOutput.update(({ [id]: _dropped, ...rest }) => rest);
}

/** Silences the suggestion for a server for good. */
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

/** Drops the diagnostics of every file inside a worktree. */
function clearDiagnosticsUnder(worktree: string): void {
	_diagnostics.update((current) => {
		const next: Record<string, LspDiagnostic[]> = {};
		for (const [path, list] of Object.entries(current)) {
			if (!isUnder(path, worktree)) next[path] = list;
		}
		return next;
	});
}

/** Shuts down every server running on a worktree, typically when its instance is deleted. */
export async function stopServersForWorktree(worktree: string): Promise<void> {
	clearDiagnosticsUnder(worktree);
	await stopLanguageServersFor(worktree).catch(() => {});
}
