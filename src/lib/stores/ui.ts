import { writable } from "svelte/store";
import type { WorkflowStep } from "$lib/types/instance.ts";

export const activeStep = writable<WorkflowStep>("files");
export const activeScreen = writable<"home" | "workspace">("home");
export const terminalActive = writable(false);
export const commandsActive = writable(false);
export const envActive = writable(false);

/**
 * Tools take over the main area, so exactly one of them can be open at a time.
 * Always go through here rather than setting the flags by hand: two flags left
 * on at once stack two views on top of each other.
 */
export function showTool(tool: "terminal" | "commands" | "env" | null): void {
	terminalActive.set(tool === "terminal");
	commandsActive.set(tool === "commands");
	envActive.set(tool === "env");
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
export const quickOpenVisible = writable(false);
export const commandPaletteVisible = writable(false);
export const pendingGitAction = writable<"createProfile" | null>(null);
export const gitLeftTab = writable<
	"changes" | "log" | "graph" | "stash" | "mergerebase"
>("changes");
