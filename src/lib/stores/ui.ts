import { writable } from "svelte/store";
import type { WorkflowStep } from "$lib/types/instance.ts";

export const activeStep = writable<WorkflowStep>("files");
export const activeScreen = writable<"home" | "workspace">("home");
export const terminalActive = writable(false);
export const quickOpenVisible = writable(false);
export const commandPaletteVisible = writable(false);
export const pendingGitAction = writable<"createProfile" | null>(null);
export const gitLeftTab = writable<"changes" | "log" | "graph" | "stash">(
	"changes",
);
