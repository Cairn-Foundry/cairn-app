// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schedule, scheduleKeyed } from "./scheduler";

// The module drains through a MessageChannel, whose delivery jsdom schedules as
// a macrotask. Waiting on a real timer is what lets a tick actually run.
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("schedule", () => {
	it("defers the task rather than running it inline", async () => {
		const run = vi.fn();
		schedule("input", run);
		expect(run).not.toHaveBeenCalled();
		await tick();
		expect(run).toHaveBeenCalledTimes(1);
	});

	it("drains a whole queue in one tick, in order", async () => {
		const seen: number[] = [];
		for (const n of [1, 2, 3]) schedule("visible", () => seen.push(n));
		await tick();
		expect(seen).toEqual([1, 2, 3]);
	});

	it("runs input and visible before background", async () => {
		const seen: string[] = [];
		schedule("background", () => seen.push("background"));
		schedule("visible", () => seen.push("visible"));
		schedule("input", () => seen.push("input"));
		await tick();
		expect(seen).toEqual(["input", "visible", "background"]);
	});

	it("keeps draining across ticks until every queue is empty", async () => {
		const seen: string[] = [];
		schedule("input", () => {
			seen.push("first");
			schedule("input", () => seen.push("second"));
		});
		await tick();
		await tick();
		expect(seen).toEqual(["first", "second"]);
	});

	it("lets a task scheduled from within a drain run on a later tick", async () => {
		const run = vi.fn();
		schedule("visible", () => schedule("visible", run));
		await tick();
		await tick();
		expect(run).toHaveBeenCalledTimes(1);
	});
});

describe("scheduleKeyed", () => {
	it("runs a lone keyed task", async () => {
		const run = vi.fn();
		scheduleKeyed("visible", "k", run);
		await tick();
		expect(run).toHaveBeenCalledTimes(1);
	});

	it("collapses a burst on one key into a single run", async () => {
		const first = vi.fn();
		const second = vi.fn();
		const third = vi.fn();
		scheduleKeyed("visible", "k", first);
		scheduleKeyed("visible", "k", second);
		scheduleKeyed("visible", "k", third);
		await tick();
		expect(first).not.toHaveBeenCalled();
		expect(second).not.toHaveBeenCalled();
		expect(third).toHaveBeenCalledTimes(1);
	});

	it("keeps the latest task, not the first, which is the point of coalescing", async () => {
		const seen: string[] = [];
		scheduleKeyed("input", "k", () => seen.push("stale"));
		scheduleKeyed("input", "k", () => seen.push("fresh"));
		await tick();
		expect(seen).toEqual(["fresh"]);
	});

	it("keeps distinct keys independent", async () => {
		const a = vi.fn();
		const b = vi.fn();
		scheduleKeyed("visible", "a", a);
		scheduleKeyed("visible", "b", b);
		await tick();
		expect(a).toHaveBeenCalledTimes(1);
		expect(b).toHaveBeenCalledTimes(1);
	});

	it("frees the key once it ran, so the same key can be scheduled again", async () => {
		const run = vi.fn();
		scheduleKeyed("visible", "k", run);
		await tick();
		scheduleKeyed("visible", "k", run);
		await tick();
		expect(run).toHaveBeenCalledTimes(2);
	});
});

describe("background budget", () => {
	let now = 0;

	beforeEach(() => {
		now = 0;
		vi.spyOn(performance, "now").mockImplementation(() => now);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("drains the whole background queue while every task is cheap", async () => {
		const seen: number[] = [];
		for (const n of [1, 2, 3]) schedule("background", () => seen.push(n));
		await tick();
		expect(seen).toEqual([1, 2, 3]);
	});

	it("still runs every background task when they overrun the budget", async () => {
		const seen: number[] = [];
		for (const n of [1, 2, 3]) {
			schedule("background", () => {
				seen.push(n);
				now += 100;
			});
		}
		await tick();
		expect(seen).toEqual([1, 2, 3]);
	});

	/**
	 * The budget is measured from the current drain, and a yield starts a new
	 * one, so `start` is re-read and the elapsed time falls back to zero. Each
	 * task therefore gets a fresh budget instead of sharing one tick's worth.
	 * Documented here because it is what the code does, not what BUDGET_MS
	 * suggests; the module has no production caller today.
	 */
	it("gives each task a fresh budget rather than one shared per tick", async () => {
		const starts: number[] = [];
		vi.spyOn(performance, "now").mockImplementation(() => {
			starts.push(now);
			return now;
		});
		for (const n of [1, 2]) {
			schedule("background", () => {
				void n;
				now += 100;
			});
		}
		await tick();
		expect(starts).toContain(0);
		expect(starts).toContain(100);
	});

	it("never starves input work when background work overruns", async () => {
		const seen: string[] = [];
		schedule("background", () => {
			seen.push("background");
			now += 99;
		});
		schedule("input", () => seen.push("input"));
		await tick();
		expect(seen).toEqual(["input", "background"]);
	});
});
