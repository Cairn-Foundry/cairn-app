// Global app settings, in settings.json. CairnSettings is mirrored by the Rust
// struct in commands/settings.rs: a new field has to be added on both sides.

import { invoke } from "@tauri-apps/api/core";
import type { WorkflowStep } from "$lib/types/instance";
import type { ShortcutConfig } from "$lib/types/shortcuts";
import type { ThemeName } from "$lib/utils/editor/editor-theme";
import type { SyntaxTheme } from "$lib/utils/editor/syntax-tokens";

/** An author identity that can be applied to a worktree, instead of git's own config. */
export interface GitProfile {
	id: string;
	label: string;
	name: string;
	email: string;
}

/** A workflow tab as the user arranged it; `order` drives the sidebar, not array position. */
export interface WorkflowTabConfig {
	key: WorkflowStep;
	name: string;
	icon: string;
	enabled: boolean;
	order: number;
}

/** User overrides for a catalogue language server, keyed by its catalogue id. */
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

/**
 * Every global setting. The store merges what it reads with its own DEFAULTS,
 * so a field missing from an older settings.json is not an error.
 */
export interface CairnSettings {
	treePanelWidth: number;
	showMinimap: boolean;
	editorFontSize: number;
	uiScale: number;
	fontFamily: string;
	splitMode: boolean;
	splitLeftWidth: number;
	shortcuts: ShortcutConfig[];
	theme: ThemeName;
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

/** Settings as stored; the store fills in anything the file predates. */
export function getSettings(): Promise<CairnSettings> {
	return invoke<CairnSettings>("get_settings");
}

/** Rewrites settings.json whole and answers with what was stored, so pass a complete object. */
export function updateSettings(
	settings: CairnSettings,
): Promise<CairnSettings> {
	return invoke<CairnSettings>("update_settings", { settings });
}

/** Toggles the native window blur; separate from settings because it acts on the window itself. */
export function setWindowVibrancy(enabled: boolean): Promise<void> {
	return invoke<void>("set_window_vibrancy", { enabled });
}
