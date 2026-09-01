// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

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
 * Which provider serves one AI feature. An empty `providerId` or `model` means
 * "whatever the default provider is", so an untouched install needs no entry at
 * all; an empty `promptTemplate` falls back to the feature's own default.
 */
export interface AiFeatureAssignment {
	providerId: string;
	model: string;
	promptTemplate: string;
}

/**
 * Every global setting. The store merges what it reads with its own DEFAULTS,
 * so a field missing from an older settings.json is not an error.
 */
export interface CairnSettings {
	treePanelWidth: number;
	showMinimap: boolean;
	stickyScroll: boolean;
	lineWrap: boolean;
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
	workspaceSidebarPosition: "left" | "right";
	showPinnedCommandsSidebar: boolean;
	transparencyEffects: boolean;
	iconAnimations: boolean;
	showWhitespace: boolean;
	saveOn:
		| "blur"
		| "windowChange"
		| "projectChange"
		| "instanceChange"
		| "manual";
	gitProfiles: GitProfile[];
	quickSearchShowGitignored: boolean;
	autoCheckUpdates: boolean;
	/** Master switch: false hides every AI surface and disables every assist. */
	aiEnabled: boolean;
	integrationsPollSeconds: number;
	/** Branch name built from a ticket: `{{key}}`, `{{slug}}`, `{{kind}}`. */
	branchTemplate: string;
	syntaxThemes: SyntaxTheme[];
	activeSyntaxThemeId: string;
	languageServers: LanguageServerSetting[];
	suggestLanguageServers: boolean;
	dismissedLanguageServers: string[];
	customLanguageServers: CustomLanguageServer[];
	/** Keyed by `AiFeatureId`; a feature with no entry runs on the default provider. */
	aiFeatures: Record<string, AiFeatureAssignment>;
	/** False until the welcome tour has been closed once. */
	onboardingSeen: boolean;
}

/**
 * Which build this is and where it keeps its data. A beta or dev build owns its
 * own directory, so anything naming that directory on screen has to ask rather
 * than spell `~/.cairn` out.
 */
export interface ChannelInfo {
	/** Null on the release build, which announces nothing. */
	label: string | null;
	/** Absolute path of the data root. */
	dir: string;
	/** The same path with the home directory written back as `~`. */
	displayDir: string;
}

/** Read once on launch; nothing about it changes while the app runs. */
export function getChannel(): Promise<ChannelInfo> {
	return invoke<ChannelInfo>("get_channel");
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
