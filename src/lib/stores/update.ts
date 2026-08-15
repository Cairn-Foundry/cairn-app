/** Self-update: the check schedule, the download progress and the modal flag. */
import { derived, get, writable } from "svelte/store";
import {
	checkForUpdate,
	downloadAndInstall,
	restartApp,
	type Update,
} from "$lib/services/update-service";
import { settings } from "$lib/stores/settings";

/** Delay before the first check, so it does not compete with the app opening. */
export const STARTUP_CHECK_DELAY_MS = 5_000;
/** How often the background check runs afterwards. */
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;

/** Where the updater is; only "available" onwards means an update was actually found. */
export type UpdatePhase =
	| "idle"
	| "checking"
	| "available"
	| "downloading"
	| "installing"
	| "error";

/** Everything the update modal renders, including the download progress. */
export interface UpdateState {
	phase: UpdatePhase;
	version: string | null;
	notes: string | null;
	downloaded: number;
	total: number | null;
	error: string | null;
	lastCheckedAt: number | null;
}

/** The state with nothing found and nothing in flight. */
const IDLE: UpdateState = {
	phase: "idle",
	version: null,
	notes: null,
	downloaded: 0,
	total: null,
	error: null,
	lastCheckedAt: null,
};

const { subscribe, set, update } = writable<UpdateState>(IDLE);

/** Read-only updater state; written by checkForUpdates() and installUpdate(). */
export const updateState = { subscribe };
/** Whether the update modal is showing; opened by the user, never automatically. */
export const isUpdateModalOpen = writable(false);

/** Whether an update is waiting or being applied, for the badge in the status bar. */
export const hasPendingUpdate = derived(
	updateState,
	(s) =>
		s.phase === "available" ||
		s.phase === "downloading" ||
		s.phase === "installing",
);

// The Update handle the plugin returned, kept out of the store: it is a Rust resource, not state.
let pending: Update | null = null;

/** Renders an unknown thrown value as a message the modal can show. */
function toMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Each check hands back a new Rust-side resource; drop the previous one. */
async function releasePending(): Promise<void> {
	if (!pending) return;
	const previous = pending;
	pending = null;
	try {
		await previous.close();
	} catch {}
}

/** Checks for a release; `silent` keeps a failed background check from surfacing an error. */
export async function checkForUpdates({ silent = false } = {}): Promise<void> {
	const phase = get(updateState).phase;
	if (phase === "checking" || phase === "downloading" || phase === "installing")
		return;

	update((s) => ({ ...s, phase: "checking", error: null }));
	try {
		const found = await checkForUpdate();
		await releasePending();
		pending = found;
		if (!found) {
			set({ ...IDLE, lastCheckedAt: Date.now() });
			return;
		}
		update((s) => ({
			...s,
			phase: "available",
			version: found.version,
			notes: found.body?.trim() || null,
			lastCheckedAt: Date.now(),
		}));
	} catch (error) {
		await releasePending();
		if (silent) {
			set({ ...IDLE, lastCheckedAt: Date.now() });
			return;
		}
		update((s) => ({
			...s,
			phase: "error",
			error: toMessage(error),
			lastCheckedAt: Date.now(),
		}));
	}
}

/** Downloads and installs the pending update, then restarts the app. */
export async function installUpdate(): Promise<void> {
	if (!pending) return;

	update((s) => ({
		...s,
		phase: "downloading",
		downloaded: 0,
		total: null,
		error: null,
	}));
	try {
		await downloadAndInstall(pending, ({ downloaded, total }) =>
			update((s) => ({ ...s, downloaded, total })),
		);
		update((s) => ({ ...s, phase: "installing" }));
		await restartApp();
	} catch (error) {
		update((s) => ({ ...s, phase: "error", error: toMessage(error) }));
	}
}

/** Opens the update modal. */
export function openUpdateModal(): void {
	isUpdateModalOpen.set(true);
}

/** Closes the update modal; a download in progress keeps running. */
export function closeUpdateModal(): void {
	isUpdateModalOpen.set(false);
}

/**
 * Starts the background schedule and follows the autoCheckUpdates setting.
 * Returns the teardown; call it once, from the app root.
 */
export function startUpdateChecks(): () => void {
	let startupTimer: ReturnType<typeof setTimeout> | null = null;
	let interval: ReturnType<typeof setInterval> | null = null;

	const stopSchedule = () => {
		if (startupTimer) clearTimeout(startupTimer);
		if (interval) clearInterval(interval);
		startupTimer = null;
		interval = null;
	};

	const unsubscribe = settings.subscribe((s) => {
		if (!s.autoCheckUpdates) {
			stopSchedule();
			return;
		}
		if (interval) return;
		startupTimer = setTimeout(
			() => void checkForUpdates({ silent: true }),
			STARTUP_CHECK_DELAY_MS,
		);
		interval = setInterval(
			() => void checkForUpdates({ silent: true }),
			CHECK_INTERVAL_MS,
		);
	});

	return () => {
		unsubscribe();
		stopSchedule();
	};
}
