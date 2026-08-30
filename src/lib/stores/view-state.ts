/**
 * Per-project view state: snapshots the ui stores on project switch and restores
 * them on the way back, so every project reopens exactly where it was left.
 */
import { derived, get, writable } from "svelte/store";
import type { ProjectUiState } from "$lib/services/ui-state-service";
import { activeProjectId } from "$lib/stores/project";
import { onProjectRemoved } from "$lib/stores/project-teardown";
import {
	activeStep,
	commandsActive,
	envActive,
	formattingActive,
	gitLeftTab,
	openAgentId,
	referencesPanelOpen,
	referencesQuery,
	showTool,
	terminalActive,
} from "$lib/stores/ui";
import type { WorkflowStep } from "$lib/types/instance";
import { dropProjectKeys } from "$lib/utils/project-scope";

/** The state a project that has never been opened starts from. */
const DEFAULT: ProjectUiState = {
	activeStep: "files",
	gitLeftTab: "changes",
	terminalActive: false,
	commandsActive: false,
	envActive: false,
	formattingActive: false,
	openAgentId: "",
	gitChangesSearch: "",
	gitLogSearch: "",
	gitStagedSearch: "",
	referencesPanelOpen: false,
	referencesQuery: "",
};

/** View state of every project, keyed by project id. */
const _states = writable<Record<string, ProjectUiState>>({});

/** Read-only view of the whole map; write through the functions below. */
export const viewStates = { subscribe: _states.subscribe };

const KEYS = Object.keys(DEFAULT) as (keyof ProjectUiState)[];

/** Field-by-field comparison; every value is a scalar, so `===` is enough. */
function isSameState(a: ProjectUiState, b: ProjectUiState): boolean {
	return KEYS.every((k) => a[k] === b[k]);
}

/**
 * Writing an unchanged state would notify the subscribers, which persist the ui
 * state, which snapshots again: the store must therefore stay silent whenever
 * the snapshot brings nothing new, or the app rewrites its state file forever.
 */
function commit(id: string, next: ProjectUiState): void {
	const states = get(_states);
	const prev = states[id] ?? DEFAULT;
	if (states[id] && isSameState(prev, next)) return;
	_states.set({ ...states, [id]: next });
}

/** View state of the active project, falling back to DEFAULT. */
export const currentProjectViewState = derived(
	[_states, activeProjectId],
	([$s, $pid]) => ($pid ? ($s[$pid] ?? DEFAULT) : DEFAULT),
);

/** Seeds the map from disk, filling in fields a state saved by an older version lacks. */
export function initViewStates(states: Record<string, ProjectUiState>): void {
	const normalized: Record<string, ProjectUiState> = {};
	for (const [id, ps] of Object.entries(states)) {
		normalized[id] = { ...DEFAULT, ...ps };
	}
	_states.set(normalized);
}

/** Copies the live ui stores into the active project's state; call before leaving it. */
export function snapshotCurrentProject(): void {
	const id = get(activeProjectId);
	if (!id) return;
	commit(id, {
		...(get(_states)[id] ?? DEFAULT),
		activeStep: get(activeStep),
		gitLeftTab: get(gitLeftTab),
		terminalActive: get(terminalActive),
		commandsActive: get(commandsActive),
		envActive: get(envActive),
		formattingActive: get(formattingActive),
		openAgentId: get(openAgentId),
		referencesPanelOpen: get(referencesPanelOpen),
		referencesQuery: get(referencesQuery),
	});
}

/** Pushes a project's saved state back into the ui stores; the mirror of snapshotCurrentProject(). */
export function applyProjectState(id: string): void {
	const ps = get(_states)[id] ?? DEFAULT;
	activeStep.set(ps.activeStep as WorkflowStep);
	gitLeftTab.set(
		ps.gitLeftTab as
			| "changes"
			| "log"
			| "graph"
			| "stash"
			| "tag"
			| "mergerebase"
			| "gitignore",
	);
	referencesPanelOpen.set(ps.referencesPanelOpen);
	referencesQuery.set(ps.referencesQuery);
	openAgentId.set(ps.openAgentId);
	showTool(
		ps.terminalActive
			? "terminal"
			: ps.commandsActive
				? "commands"
				: ps.envActive
					? "env"
					: ps.formattingActive
						? "formatting"
						: null,
	);
}

/** Patches the fields no ui store owns (the git search boxes) on the active project. */
export function updateProjectViewState(
	patch: Partial<
		Pick<
			ProjectUiState,
			"gitChangesSearch" | "gitLogSearch" | "gitStagedSearch"
		>
	>,
): void {
	const id = get(activeProjectId);
	if (!id) return;
	commit(id, { ...(get(_states)[id] ?? DEFAULT), ...patch });
}

/** Non-reactive read of the whole map, for the persistence layer. */
export function getAllProjectStates(): Record<string, ProjectUiState> {
	return get(_states);
}

/** Forgets the view state of a removed project. */
export function forgetProject(projectId: string): void {
	_states.update((m) => dropProjectKeys(m, projectId));
}

onProjectRemoved(forgetProject);
