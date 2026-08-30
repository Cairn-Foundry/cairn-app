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

/** Open tool taking over the main area. Set these through showTool(), never directly. */
export const terminalActive = writable(false);
export const commandsActive = writable(false);
export const envActive = writable(false);
export const formattingActive = writable(false);

/**
 * The agent whose thread is open in the Agent view. An agent's thread takes over
 * the main area exactly like a conversation does, so which one is open is view
 * state and survives a restart.
 */
export const openAgentId = writable("");

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
