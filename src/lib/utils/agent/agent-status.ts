// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What a running conversation is doing, as far as Cairn actually knows.
 *
 * `working`, `waiting` and `done` come from the CLI itself, through the hooks
 * it was launched with (`statusArgv`); a CLI without hooks never gets them.
 * `exited` is the PTY ending on its own, known for every CLI. No status at all
 * means nothing worth showing: nothing was reported, or it has been seen.
 */
export type AgentStatus = "working" | "waiting" | "done" | "exited";

/**
 * What can move a status: a signal from the CLI, a keystroke from the user,
 * the terminal going quiet, the PTY exiting, the conversation being looked at.
 */
export type AgentEvent =
	| "working"
	| "waiting"
	| "done"
	| "input"
	| "quiet"
	| "exit"
	| "seen";

/**
 * `seen` is true while the conversation is on screen in a focused window: a
 * turn that ends under the user's eyes is not news.
 *
 * A keystroke answers a pending permission prompt, but nothing reports the
 * answer, so it counts as the turn resuming. A turn that was refused rather
 * than answered never reports its end either, which is what `quiet` covers: a
 * CLI at work keeps redrawing its spinner, one that stays silent is not.
 */
export function nextStatus(
	prev: AgentStatus | undefined,
	event: AgentEvent,
	seen: boolean,
): AgentStatus | undefined {
	switch (event) {
		case "working":
			return prev === "exited" ? prev : "working";
		case "waiting":
		case "done":
			if (prev === "exited") return prev;
			return seen ? undefined : event;
		case "input":
			return prev === "waiting" ? "working" : prev;
		case "quiet":
			return prev === "working" ? undefined : prev;
		case "exit":
			return "exited";
		case "seen":
			return needsAttention(prev) ? undefined : prev;
	}
}

/** Whether a status is the user's turn. */
export function needsAttention(
	status: AgentStatus | undefined,
): status is "waiting" | "done" {
	return status === "waiting" || status === "done";
}

/** Sort rank in the activity list: what needs the user first. */
export function statusRank(status: AgentStatus | undefined): number {
	switch (status) {
		case "waiting":
			return 0;
		case "done":
			return 1;
		case "working":
			return 2;
		case "exited":
			return 4;
		default:
			return 3;
	}
}
