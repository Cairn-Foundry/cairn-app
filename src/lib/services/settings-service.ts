import { invoke } from "@tauri-apps/api/core";
import type { WorkflowStep } from "$lib/types/instance";
import type { ShortcutConfig } from "$lib/types/shortcuts";
import type { SyntaxTheme } from "$lib/utils/editor/syntax-tokens";

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

export interface LanguageServerSetting {
	id: string;
	enabled: boolean;
	/** Empty means the binary from the catalogue. */
	command: string;
	/** Empty means the arguments from the catalogue. */
	args: string[];
}

/**
 * A language server the user brought themselves. Cairn runs it exactly as it
 * runs a catalogue one, but never installs, updates or removes it.
 */
export interface CustomLanguageServer {
	id: string;
	name: string;
	binary: string;
	args: string[];
	languageIds: string[];
	extensions: string[];
	rootMarkers: string[];
	docUrl: string;
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
	agentActivityWidth: number;
	quickSearchShowGitignored: boolean;
	autoCheckUpdates: boolean;
	syntaxThemes: SyntaxTheme[];
	activeSyntaxThemeId: string;
	languageServers: LanguageServerSetting[];
	suggestLanguageServers: boolean;
	dismissedLanguageServers: string[];
	customLanguageServers: CustomLanguageServer[];
	agentShowLiveActivity: boolean;
	agentActivityShowTime: boolean;
	agentActivityShowToolArgs: boolean;
	agentActivityAutoScroll: boolean;
	agentShowMessageTime: boolean;
	agentShowThinking: boolean;
	agentShowMessageCopy: boolean;
	agentShowResponseStats: boolean;
	agentResponseStats: string[];
	agentShowContextWindow: boolean;
	agentShowConversationCost: boolean;
	agentShowRateLimit: boolean;
	agentShowModelChip: boolean;
	agentShowEffortChip: boolean;
	agentShowPermissionChip: boolean;
}

export function getSettings(): Promise<CairnSettings> {
	return invoke<CairnSettings>("get_settings");
}

export function updateSettings(
	settings: CairnSettings,
): Promise<CairnSettings> {
	return invoke<CairnSettings>("update_settings", { settings });
}
