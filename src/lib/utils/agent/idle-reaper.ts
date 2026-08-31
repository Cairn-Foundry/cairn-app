// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Closing the CLIs of conversations nobody is looking at any more.
 *
 * A conversation left open keeps a process alive, and a day of work leaves a
 * dozen of them running behind steps the user has moved on from. This closes
 * the ones that have gone quiet - the entry stays, and reopening it resumes the
 * conversation where it stopped, so nothing is lost by being reaped.
 *
 * Everything here is biased towards leaving a process alone. Killing a CLI that
 * was working destroys real work; keeping an idle one costs a little memory
 * until the app closes.
 */

/** How long a conversation must be quiet before its CLI is closed. */
export const IDLE_TIMEOUT_MS = 5 * 60_000;

/** What is known about one running conversation. */
export interface IdleCandidate {
	conversationId: string;
	terminalId: string;
	/** False for the conversation on screen, which is never reaped. */
	background: boolean;
	/** Last keystroke the user sent into it, in ms. */
	lastInputAt: number;
	/** Last byte the CLI produced, in ms; 0 when it has printed nothing. */
	lastOutputAt: number;
}

/**
 * Whether this conversation's CLI may be closed, given the time now.
 *
 * Four things keep a CLI alive, any one of them enough:
 *
 * - it is the conversation on screen;
 * - the user typed into it recently;
 * - it printed something recently;
 * - a process it spawned is still running.
 *
 * That last one is checked separately, against the process table, and is what
 * covers a CLI waiting on a command with a ten-minute timeout: it prints
 * nothing and reads nothing while it waits, so from the terminal alone it is
 * indistinguishable from an abandoned one. This function answers the part that
 * can be decided from timestamps; the caller must confirm with
 * `terminalHasChildren` before killing anything.
 */
export function isQuiet(candidate: IdleCandidate, now: number): boolean {
	if (!candidate.background) return false;

	const lastActivity = Math.max(candidate.lastInputAt, candidate.lastOutputAt);
	return now - lastActivity >= IDLE_TIMEOUT_MS;
}
