import { invoke } from "@tauri-apps/api/core";
import type { WorkflowStep } from "$lib/types/instance";
import type { ShortcutConfig } from "$lib/types/shortcuts";

export interface GitProfile {
	id: string;
	label: string;
	name: string;
	email: string;
}

export interface WorkflowTabConfig {
	key: WorkflowStep;
	name: string;
	icon: string;
	enabled: boolean;
	order: number;
}

export interface CairnSettings {
	treePanelWidth: number;
	showMinimap: boolean;
	editorFontSize: number;
	fontFamily: string;
	splitMode: boolean;
	splitLeftWidth: number;
	shortcuts: ShortcutConfig[];
	theme: "dark" | "light" | "high-contrast";
	accentColor: string;
	workflowTabs: WorkflowTabConfig[];
	sidebarPosition: "left" | "right";
	showWhitespace: boolean;
	saveOn:
		| "blur"
		| "windowChange"
		| "projectChange"
		| "instanceChange"
		| "manual";
	gitProfiles: GitProfile[];
}

export function getSettings(): Promise<CairnSettings> {
	return invoke<CairnSettings>("get_settings");
}

export function updateSettings(
	settings: CairnSettings,
): Promise<CairnSettings> {
	return invoke<CairnSettings>("update_settings", { settings });
}
