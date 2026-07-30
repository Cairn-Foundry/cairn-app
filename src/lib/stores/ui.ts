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
export const quickOpenVisible = writable(false);
export const commandPaletteVisible = writable(false);
export const pendingGitAction = writable<"createProfile" | null>(null);
export const gitLeftTab = writable<
	"changes" | "log" | "graph" | "stash" | "mergerebase"
>("changes");
