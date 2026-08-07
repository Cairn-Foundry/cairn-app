import { invoke } from "@tauri-apps/api/core";

export interface ProjectUiState {
	activeStep: string;
	gitLeftTab: string;
	terminalActive: boolean;
	commandsActive: boolean;
	envActive: boolean;
	gitChangesSearch: string;
	gitLogSearch: string;
	gitStagedSearch: string;
	referencesPanelOpen: boolean;
	referencesQuery: string;
}

export interface UiState {
	screen: "home" | "workspace";
	activeProjectId: string | null;
	openTabOrder: string[];
	homeSection: string;
	homeSettingsTab: string;
	projectStates: Record<string, ProjectUiState>;
}

const DEFAULTS: UiState = {
	screen: "home",
	activeProjectId: null,
	openTabOrder: [],
	homeSection: "projects",
	homeSettingsTab: "general",
	projectStates: {},
};

export async function getUiState(): Promise<UiState> {
	try {
		const saved = await invoke<UiState>("get_ui_state");
		return { ...DEFAULTS, ...saved };
	} catch {
		return DEFAULTS;
	}
}

export function saveUiState(state: UiState): void {
	invoke("save_ui_state", { state }).catch(() => {});
}
