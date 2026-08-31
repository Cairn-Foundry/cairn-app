// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * View state of the workspace: which screen, step and tool are open.
 * Most flags here are persisted per project (see the four-layer rule in CLAUDE.md).
 */
import { writable } from "svelte/store";
import type { WorkflowStep } from "$lib/types/instance.ts";

/** Workflow tab of the workspace sidebar; persisted per project so a restart reopens on it. */
export const activeStep = writable<WorkflowStep>("files");

/** Top-level screen, driven by +page.svelte. */
export const activeScreen = writable<"home" | "workspace">("home");

/**
 * Open tool taking over the main area. Set these through showTool(), never directly.
 *
 * A plain writable notifies on every set, even an identical one, and switching
 * project rewrites all four. The terminal view tears its xterm instances down
 * and rebuilds them whenever its flag notifies, so an unchanged value must stay
 * silent or terminals get disposed and replayed for nothing.
 */
function toolFlag() {
	const store = writable(false);
	let current = false;
	return {
		subscribe: store.subscribe,
		set(value: boolean) {
			if (value === current) return;
			current = value;
			store.set(value);
		},
	};
}

export const terminalActive = toolFlag();
export const commandsActive = toolFlag();
export const envActive = toolFlag();
export const formattingActive = toolFlag();

/**
 * The CLI the Agent step last started a conversation with, per project. The
 * picker offers it first, so a restart does not send the user hunting for the
 * one they always use.
 */
export const lastCli = writable("");

/**
 * Tools take over the main area, so exactly one of them can be open at a time.
 * Always go through here rather than setting the flags by hand: two flags left
 * on at once stack two views on top of each other.
 */
export function showTool(
	tool: "terminal" | "commands" | "env" | "formatting" | null,
): void {
	terminalActive.set(tool === "terminal");
	commandsActive.set(tool === "commands");
	envActive.set(tool === "env");
	formattingActive.set(tool === "formatting");
}
/**
 * The References panel sits beside the file tree rather than over the editor,
 * so it is not a tool: it stays open across steps and survives a restart on its
 * own flag.
 */
export const referencesPanelOpen = writable(false);

/**
 * The lookup the panel is showing, as JSON, so a reload can ask it again. A
 * flat string on purpose: the persisted project state is compared key by key
 * with `===`, and an object would never look equal to itself.
 */
export const referencesQuery = writable("");
/** Overlays, transient by design: they are not part of the persisted project state. */
export const quickOpenVisible = writable(false);
export const commandPaletteVisible = writable(false);

/** An action requested elsewhere that the Git view performs once it is mounted, then clears. */
export const pendingGitAction = writable<"createProfile" | null>(null);

/** Selected tab of the Git view left pane; persisted with the rest of the project state. */
export const gitLeftTab = writable<
	"changes" | "log" | "graph" | "stash" | "tag" | "mergerebase" | "gitignore"
>("changes");

/** True while the welcome tour is on screen; set from the first launch or from Settings. */
export const showWelcomeTour = writable(false);
