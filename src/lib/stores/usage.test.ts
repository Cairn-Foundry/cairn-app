import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UsageEntry } from "$lib/services/usage-service";

const getUsageEntries = vi.hoisted(() => vi.fn());
const appendUsageEntries = vi.hoisted(() => vi.fn());
const backfillUsageEntries = vi.hoisted(() => vi.fn());
const clearUsageEntries = vi.hoisted(() => vi.fn());

const reportPersistError = vi.hoisted(() => vi.fn());
vi.mock("$lib/utils/persist-error", () => ({
	reportPersistError,
	persist: vi.fn(),
}));

vi.mock("$lib/services/usage-service", () => ({
	getUsageEntries,
	appendUsageEntries,
	backfillUsageEntries,
	clearUsageEntries,
}));

import {
	backfillUsage,
	clearUsage,
	loadUsage,
	recordUsage,
	usageCount,
	usageEntries,
	usageLoaded,
} from "./usage";

const entry = (id: string, ts: number): UsageEntry =>
	({ id, ts }) as UsageEntry;

/** A promise this test settles by hand. */
function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

beforeEach(async () => {
	vi.clearAllMocks();
	getUsageEntries.mockResolvedValue([]);
	appendUsageEntries.mockResolvedValue(undefined);
	backfillUsageEntries.mockResolvedValue(0);
	clearUsageEntries.mockResolvedValue(undefined);
	await clearUsage();
	usageLoaded.set(false);
	vi.clearAllMocks();
	appendUsageEntries.mockResolvedValue(undefined);
	clearUsageEntries.mockResolvedValue(undefined);
});

describe("loadUsage", () => {
	it("replaces the ledger with what is on disk", async () => {
		getUsageEntries.mockResolvedValue([entry("a", 1)]);
		await loadUsage();
		expect(get(usageEntries)).toEqual([entry("a", 1)]);
	});

	it("marks the ledger as read, so empty is not mistaken for unread", async () => {
		expect(get(usageLoaded)).toBe(false);
		await loadUsage();
		expect(get(usageLoaded)).toBe(true);
	});
});

describe("recordUsage", () => {
	it("adds the turn to the ledger", () => {
		recordUsage(entry("a", 1));
		expect(get(usageEntries)).toEqual([entry("a", 1)]);
	});

	it("keeps the ledger sorted by timestamp", () => {
		recordUsage(entry("late", 30));
		recordUsage(entry("early", 10));
		recordUsage(entry("middle", 20));
		expect(get(usageEntries).map((e) => e.id)).toEqual([
			"early",
			"middle",
			"late",
		]);
	});

	it("records a turn once, however often it is reported", () => {
		recordUsage(entry("a", 1));
		recordUsage(entry("a", 1));
		expect(get(usageEntries)).toHaveLength(1);
	});

	it("writes the turn to disk", async () => {
		recordUsage(entry("a", 1));
		await vi.waitFor(() => expect(appendUsageEntries).toHaveBeenCalled());
		expect(appendUsageEntries).toHaveBeenCalledWith([entry("a", 1)]);
	});

	it("batches a burst into fewer writes than turns", async () => {
		const gate = deferred();
		appendUsageEntries.mockImplementationOnce(() => gate.promise);
		recordUsage(entry("a", 1));
		recordUsage(entry("b", 2));
		recordUsage(entry("c", 3));
		gate.resolve();
		await vi.waitFor(() => expect(appendUsageEntries).toHaveBeenCalledTimes(2));
		expect(appendUsageEntries.mock.calls[0][0]).toEqual([entry("a", 1)]);
		expect(appendUsageEntries.mock.calls[1][0]).toEqual([
			entry("b", 2),
			entry("c", 3),
		]);
	});

	it("never runs two writes at once, since the ledger is one file", async () => {
		let concurrent = 0;
		let peak = 0;
		appendUsageEntries.mockImplementation(async () => {
			concurrent++;
			peak = Math.max(peak, concurrent);
			await Promise.resolve();
			concurrent--;
		});
		for (let i = 0; i < 5; i++) recordUsage(entry(`e${i}`, i));
		await vi.waitFor(() => expect(concurrent).toBe(0));
		expect(peak).toBe(1);
	});

	it("still shows the turn when the write fails", async () => {
		appendUsageEntries.mockRejectedValue(new Error("EACCES"));
		recordUsage(entry("a", 1));
		await vi.waitFor(() => expect(appendUsageEntries).toHaveBeenCalled());
		expect(get(usageEntries)).toHaveLength(1);
	});

	it("reports a failed write rather than leaving a rejection unhandled", async () => {
		appendUsageEntries.mockRejectedValue(new Error("EACCES"));
		recordUsage(entry("a", 1));
		await vi.waitFor(() =>
			expect(reportPersistError).toHaveBeenCalledWith(
				"the usage ledger",
				expect.any(Error),
			),
		);
	});

	it("keeps recording turns after a failed write", async () => {
		appendUsageEntries.mockRejectedValueOnce(new Error("EACCES"));
		recordUsage(entry("a", 1));
		await vi.waitFor(() => expect(appendUsageEntries).toHaveBeenCalled());
		appendUsageEntries.mockResolvedValue(undefined);
		recordUsage(entry("b", 2));
		await vi.waitFor(() => expect(appendUsageEntries).toHaveBeenCalledTimes(2));
		expect(get(usageEntries)).toHaveLength(2);
	});
});

describe("backfillUsage", () => {
	it("reports how many turns were recovered", async () => {
		backfillUsageEntries.mockResolvedValue(3);
		getUsageEntries.mockResolvedValue([entry("a", 1)]);
		await expect(backfillUsage()).resolves.toBe(3);
	});

	it("reloads the ledger when something was recovered", async () => {
		backfillUsageEntries.mockResolvedValue(2);
		getUsageEntries.mockResolvedValue([entry("recovered", 1)]);
		await backfillUsage();
		expect(get(usageEntries)).toEqual([entry("recovered", 1)]);
	});

	it("does not reread the file when nothing was recovered", async () => {
		backfillUsageEntries.mockResolvedValue(0);
		await backfillUsage();
		expect(getUsageEntries).not.toHaveBeenCalled();
	});
});

describe("clearUsage", () => {
	it("wipes the ledger in memory", async () => {
		recordUsage(entry("a", 1));
		await clearUsage();
		expect(get(usageEntries)).toEqual([]);
	});

	it("wipes it on disk too", async () => {
		await clearUsage();
		expect(clearUsageEntries).toHaveBeenCalled();
	});

	it("drops what was still queued, so a wipe is not undone by a late write", async () => {
		const gate = deferred();
		appendUsageEntries.mockImplementationOnce(() => gate.promise);
		recordUsage(entry("a", 1));
		recordUsage(entry("b", 2));
		await clearUsage();
		gate.resolve();
		await vi.waitFor(() => expect(appendUsageEntries).toHaveBeenCalledTimes(1));
		expect(get(usageEntries)).toEqual([]);
	});
});

describe("usageCount", () => {
	it("counts the turns without a subscription", () => {
		expect(usageCount()).toBe(0);
		recordUsage(entry("a", 1));
		expect(usageCount()).toBe(1);
	});
});
