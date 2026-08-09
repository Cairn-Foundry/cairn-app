import { derived, get, writable } from "svelte/store";
import type { ProjectUiState } from "$lib/services/ui-state-service";
import { activeProjectId } from "$lib/stores/project";
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

const _states = writable<Record<string, ProjectUiState>>({});

export const viewStates = { subscribe: _states.subscribe };

const KEYS = Object.keys(DEFAULT) as (keyof ProjectUiState)[];

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

export const currentProjectViewState = derived(
	[_states, activeProjectId],
	([$s, $pid]) => ($pid ? ($s[$pid] ?? DEFAULT) : DEFAULT),
);

export function initViewStates(states: Record<string, ProjectUiState>): void {
	const normalized: Record<string, ProjectUiState> = {};
	for (const [id, ps] of Object.entries(states)) {
		normalized[id] = { ...DEFAULT, ...ps };
	}
	_states.set(normalized);
}

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

export function applyProjectState(id: string): void {
	const ps = get(_states)[id] ?? DEFAULT;
	activeStep.set(ps.activeStep as WorkflowStep);
	gitLeftTab.set(ps.gitLeftTab as "changes" | "log" | "graph");
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

export function getAllProjectStates(): Record<string, ProjectUiState> {
	return get(_states);
}
