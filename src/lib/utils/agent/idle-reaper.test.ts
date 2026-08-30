import { describe, expect, it } from "vitest";
import { IDLE_TIMEOUT_MS, type IdleCandidate, isQuiet } from "./idle-reaper";

const NOW = 1_000_000_000;

function candidate(over: Partial<IdleCandidate> = {}): IdleCandidate {
	return {
		conversationId: "c1",
		terminalId: "conversation:c1",
		background: true,
		lastInputAt: NOW - IDLE_TIMEOUT_MS - 1,
		lastOutputAt: NOW - IDLE_TIMEOUT_MS - 1,
		...over,
	};
}

describe("isQuiet", () => {
	it("calls a background conversation quiet once nothing has happened for the timeout", () => {
		expect(isQuiet(candidate(), NOW)).toBe(true);
	});

	/** Killing what the user is looking at would be indefensible. */
	it("never touches the conversation on screen, however long it has been idle", () => {
		expect(
			isQuiet(
				candidate({
					background: false,
					lastInputAt: 0,
					lastOutputAt: 0,
				}),
				NOW,
			),
		).toBe(false);
	});

	it("counts a recent keystroke as activity", () => {
		expect(isQuiet(candidate({ lastInputAt: NOW - 1_000 }), NOW)).toBe(false);
	});

	/** A CLI still printing is a CLI still working. */
	it("counts recent output as activity, even with no one typing", () => {
		expect(
			isQuiet(candidate({ lastInputAt: 0, lastOutputAt: NOW - 1_000 }), NOW),
		).toBe(false);
	});

	it("waits for the whole timeout before saying anything", () => {
		const justUnder = candidate({
			lastInputAt: NOW - IDLE_TIMEOUT_MS + 1,
			lastOutputAt: 0,
		});
		expect(isQuiet(justUnder, NOW)).toBe(false);

		const exactly = candidate({
			lastInputAt: NOW - IDLE_TIMEOUT_MS,
			lastOutputAt: 0,
		});
		expect(isQuiet(exactly, NOW)).toBe(true);
	});

	/**
	 * The timestamps cannot see a CLI blocked on a ten-minute command: it reads
	 * nothing and prints nothing while it waits. That case is caught by the
	 * process-table check the caller runs after this one, which is why "quiet"
	 * is deliberately not the same word as "reapable".
	 */
	it("says quiet about a CLI waiting on a long command, leaving the process check to decide", () => {
		const waiting = candidate({
			lastInputAt: NOW - IDLE_TIMEOUT_MS - 60_000,
			lastOutputAt: NOW - IDLE_TIMEOUT_MS - 30_000,
		});
		expect(isQuiet(waiting, NOW)).toBe(true);
	});
});
