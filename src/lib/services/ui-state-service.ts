import { invoke } from "@tauri-apps/api/core";

export interface UiState {
	screen: "home" | "workspace";
	activeProjectId: string | null;
	openTabOrder: string[];
	activeStep: string;
	homeSection: string;
	homeSettingsTab: string;
}

const DEFAULTS: UiState = {
	screen: "home",
	activeProjectId: null,
	openTabOrder: [],
	activeStep: "files",
	homeSection: "projects",
	homeSettingsTab: "general",
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
