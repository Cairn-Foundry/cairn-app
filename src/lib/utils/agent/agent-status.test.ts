// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { needsAttention, nextStatus, statusRank } from "./agent-status";

describe("moving a conversation's status", () => {
	it("follows what the CLI reports while nobody is looking", () => {
		expect(nextStatus(undefined, "working", false)).toBe("working");
		expect(nextStatus("working", "waiting", false)).toBe("waiting");
		expect(nextStatus("working", "done", false)).toBe("done");
	});

	it("does not mark a turn that ended on screen", () => {
		expect(nextStatus("working", "done", true)).toBeUndefined();
		expect(nextStatus("working", "waiting", true)).toBeUndefined();
	});

	it("clears the user's turn once the conversation is seen", () => {
		expect(nextStatus("done", "seen", true)).toBeUndefined();
		expect(nextStatus("waiting", "seen", true)).toBeUndefined();
		expect(nextStatus("working", "seen", true)).toBe("working");
	});

	it("takes a keystroke on a pending prompt as the turn resuming", () => {
		expect(nextStatus("waiting", "input", false)).toBe("working");
		expect(nextStatus("done", "input", false)).toBe("done");
		expect(nextStatus(undefined, "input", false)).toBeUndefined();
	});

	it("drops a working status the terminal no longer backs up", () => {
		expect(nextStatus("working", "quiet", false)).toBeUndefined();
		expect(nextStatus("done", "quiet", false)).toBe("done");
	});

	it("keeps an exit over anything a dying CLI still reports", () => {
		expect(nextStatus("working", "exit", false)).toBe("exited");
		expect(nextStatus("exited", "done", false)).toBe("exited");
		expect(nextStatus("exited", "working", false)).toBe("exited");
	});
});

describe("ordering and attention", () => {
	it("puts what needs the user first and what exited last", () => {
		// Wrapped: Array#sort moves bare `undefined` to the end without asking the comparator.
		const order = (["exited", undefined, "working", "done", "waiting"] as const)
			.map((status) => ({ status }))
			.sort((a, b) => statusRank(a.status) - statusRank(b.status))
			.map((c) => c.status);
		expect(order).toEqual(["waiting", "done", "working", undefined, "exited"]);
	});

	it("only counts the user's turn as attention", () => {
		expect(needsAttention("waiting")).toBe(true);
		expect(needsAttention("done")).toBe(true);
		expect(needsAttention("working")).toBe(false);
		expect(needsAttention("exited")).toBe(false);
		expect(needsAttention(undefined)).toBe(false);
	});
});
