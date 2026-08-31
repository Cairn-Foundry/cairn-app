// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Navigation state restored on launch, in ui-state.json.
// Only this layer calls invoke().

import { invoke } from "@tauri-apps/api/core";
import { persist } from "$lib/utils/persist-error";

/**
 * What one project reopens on. Every view that takes over the main area needs
 * its own flag here, or the app forgets where the user was.
 */
export interface ProjectUiState {
	activeStep: string;
	gitLeftTab: string;
	terminalActive: boolean;
	commandsActive: boolean;
	envActive: boolean;
	formattingActive: boolean;
	/** The CLI the Agent step last started a conversation with; empty until one has been. */
	lastCli: string;
	gitChangesSearch: string;
	gitLogSearch: string;
	gitStagedSearch: string;
	referencesPanelOpen: boolean;
	referencesQuery: string;
}

/** App-wide navigation plus one entry per project; mirrors the Rust `UiState`. */
export interface UiState {
	screen: "home" | "workspace";
	activeProjectId: string | null;
	openTabOrder: string[];
	homeSection: string;
	homeSettingsTab: string;
	projectStates: Record<string, ProjectUiState>;
}

/** Fallback for a first launch and for fields a saved file predates. */
const DEFAULTS: UiState = {
	screen: "home",
	activeProjectId: null,
	openTabOrder: [],
	homeSection: "projects",
	homeSettingsTab: "general",
	projectStates: {},
};

/** Merged with DEFAULTS, so a missing field is not an error; falls back whole on a read failure. */
export async function getUiState(): Promise<UiState> {
	try {
		const saved = await invoke<UiState>("get_ui_state");
		return { ...DEFAULTS, ...saved };
	} catch {
		return DEFAULTS;
	}
}

/** Fire and forget: called on every navigation, a lost write only costs the restore point. */
export function saveUiState(state: UiState): void {
	persist("the navigation state", invoke("save_ui_state", { state }));
}
