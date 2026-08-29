/** Formatter configuration and detection, per project. */
import { derived, get, writable } from "svelte/store";
import {
	DEFAULT_FORMATTING,
	type FormatterStatus,
	type FormattingConfig,
	getProjectFormatting,
	listFormatters,
	listStyleOptions,
	type StyleOptionInfo,
	saveProjectFormatting,
} from "$lib/services/formatting-service";
import { onProjectRemoved } from "$lib/stores/project-teardown";
import { reportPersistError } from "$lib/utils/persist-error";
import { dropProjectKeys } from "$lib/utils/project-scope";

/** Per-project formatting config, keyed by project id, only for projects read from disk. */
const projectConfigs = writable<Record<string, FormattingConfig>>({});
/** The style options the backend exposes; the catalogue, loaded once. */
const styleOptions = writable<StyleOptionInfo[]>([]);
/** Formatter binaries found on the last scan, with their version and origin. */
const formatters = writable<FormatterStatus[]>([]);
/** True while scan() is walking the toolchain. */
const scanning = writable(false);

/** Loads the option catalogue once; later calls are no-ops. */
async function loadStyleOptions() {
	if (get(styleOptions).length > 0) return;
	try {
		styleOptions.set(await listStyleOptions());
	} catch {}
}

/**
 * Rescans the formatters. `root` is the worktree, so a binary the project ships
 * in its own toolchain is found - and reported as the project's, not as a
 * global install that could be updated out from under the repository.
 */
async function scan(root?: string) {
	scanning.set(true);
	try {
		formatters.set(await listFormatters(root));
	} catch {
		formatters.set([]);
	} finally {
		scanning.set(false);
	}
}

/** Projects whose config was actually read from disk. */
const loaded = new Set<string>();

/** Reads a project's config and marks it loaded, so saveProject can safely merge onto it. */
async function loadProject(projectId: string) {
	try {
		const config = await getProjectFormatting(projectId);
		projectConfigs.update((all) => ({ ...all, [projectId]: config }));
		loaded.add(projectId);
	} catch {}
}

/**
 * A patch is merged onto the config that is on disk, never onto the defaults.
 * Saving before the project was read would write the catalogue answer over
 * everything the project had set - the one edit survives and the rest is lost.
 */
async function saveProject(
	projectId: string,
	patch: Partial<FormattingConfig>,
) {
	if (!loaded.has(projectId)) await loadProject(projectId);
	if (!loaded.has(projectId)) return;
	const current = get(projectConfigs)[projectId] ?? DEFAULT_FORMATTING;
	const next = { ...current, ...patch };
	projectConfigs.update((all) => ({ ...all, [projectId]: next }));
	await saveProjectFormatting(projectId, next).catch((e) =>
		reportPersistError("the formatting configuration", e),
	);
}

/** The project's config, or null when the project has never been configured. */
function projectConfig(projectId: string | null): FormattingConfig | null {
	if (!projectId) return null;
	return get(projectConfigs)[projectId] ?? null;
}

/** Facade over the private stores: read-only subscriptions plus the actions. */
export const formatting = {
	projects: { subscribe: projectConfigs.subscribe },
	options: { subscribe: styleOptions.subscribe },
	formatters: { subscribe: formatters.subscribe },
	scanning: { subscribe: scanning.subscribe },
	loadStyleOptions,
	loadProject,
	saveProject,
	scan,
	projectConfig,
};

/**
 * Whether format-on-save is on for a project. Formatting belongs to a project,
 * so a document opened outside one is never reformatted behind the user's back.
 */
export const formatOnSave = derived(
	projectConfigs,
	($projects) => (projectId: string | null) => {
		const config = projectId ? $projects[projectId] : null;
		if (!config?.enabled) return false;
		return config.formatOnSave;
	},
);

/** Forgets the formatting config cached for a removed project. */
export function forgetProject(projectId: string): void {
	projectConfigs.update((m) => dropProjectKeys(m, projectId));
}

onProjectRemoved(forgetProject);
