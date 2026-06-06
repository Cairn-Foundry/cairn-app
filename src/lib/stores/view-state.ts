import { derived, get, writable } from "svelte/store";
import type { ProjectUiState } from "$lib/services/ui-state-service";
import { activeProjectId } from "$lib/stores/project";
import { activeStep, gitLeftTab } from "$lib/stores/ui";
import type { WorkflowStep } from "$lib/types/instance";

const DEFAULT: ProjectUiState = {
	activeStep: "files",
	gitLeftTab: "changes",
	gitChangesSearch: "",
	gitLogSearch: "",
	gitStagedSearch: "",
};

const _states = writable<Record<string, ProjectUiState>>({});

export const viewStates = { subscribe: _states.subscribe };

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
	_states.update((s) => ({
		...s,
		[id]: {
			...(s[id] ?? DEFAULT),
			activeStep: get(activeStep),
			gitLeftTab: get(gitLeftTab),
		},
	}));
}

export function applyProjectState(id: string): void {
	const ps = get(_states)[id] ?? DEFAULT;
	activeStep.set(ps.activeStep as WorkflowStep);
	gitLeftTab.set(ps.gitLeftTab as "changes" | "log" | "graph");
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
	_states.update((s) => ({
		...s,
		[id]: { ...(s[id] ?? DEFAULT), ...patch },
	}));
}

export function getAllProjectStates(): Record<string, ProjectUiState> {
	return get(_states);
}
