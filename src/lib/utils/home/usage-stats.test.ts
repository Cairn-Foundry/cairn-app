import { describe, expect, it } from "vitest";
import type { UsageEntry } from "$lib/services/usage-service";
import {
	dailySeries,
	dayKey,
	filterRange,
	groupBy,
	hourlyLoad,
	previousRange,
	totals,
	trend,
	USAGE_RANGES,
	usageCsv,
} from "./usage-stats";

const DAY = 86_400_000;
const NOW = new Date(2026, 0, 15, 12, 0, 0).getTime();

function entry(over: Partial<UsageEntry> = {}): UsageEntry {
	return {
		id: Math.random().toString(36).slice(2),
		ts: NOW,
		projectId: "p1",
		projectName: "Cairn",
		instanceId: "i1",
		instanceName: "main",
		conversationId: "c1",
		conversationTitle: "Refactor",
		scope: "instance",
		providerId: "claude-cli",
		model: "claude-opus-5",
		agentId: "",
		agentName: "",
		inputTokens: 100,
		outputTokens: 20,
		cacheReadTokens: 400,
		cacheCreationTokens: 0,
		costUsd: 0.1,
		durationMs: 1000,
		numTurns: 1,
		backfilled: false,
		...over,
	};
}

const range = (id: string) =>
	USAGE_RANGES.find((r) => r.id === id) ?? USAGE_RANGES[0];

describe("totals", () => {
	it("sums the turns and counts every distinct label once", () => {
		const t = totals([
			entry(),
			entry({ model: "claude-sonnet-5", conversationId: "c2" }),
			entry({ projectId: "p2", agentId: "a1" }),
		]);
		expect(t.turns).toBe(3);
		expect(t.tokens).toBe(3 * 520);
		expect(t.costUsd).toBeCloseTo(0.3);
		expect(t.conversations).toBe(3);
		expect(t.projects).toBe(2);
		expect(t.models).toBe(2);
		expect(t.agentTurns).toBe(1);
	});

	it("reads the cache ratio off the input side only", () => {
		const t = totals([entry({ inputTokens: 100, cacheReadTokens: 300 })]);
		expect(t.cacheRatio).toBeCloseTo(0.75);
	});

	it("reports zero rather than dividing by no turn at all", () => {
		const t = totals([]);
		expect(t.cacheRatio).toBe(0);
		expect(t.costPerTurn).toBe(0);
		expect(t.tokensPerTurn).toBe(0);
	});
});

describe("ranges", () => {
	it("keeps the current day and the days before it", () => {
		const entries = [
			entry({ ts: NOW }),
			entry({ ts: NOW - 6 * DAY }),
			entry({ ts: NOW - 30 * DAY }),
		];
		expect(filterRange(entries, range("7d"), NOW)).toHaveLength(2);
		expect(filterRange(entries, range("all"), NOW)).toHaveLength(3);
	});

	it("puts the window immediately before the range in the comparison", () => {
		const entries = [entry({ ts: NOW }), entry({ ts: NOW - 9 * DAY })];
		const previous = previousRange(entries, range("7d"), NOW);
		expect(previous).toHaveLength(1);
		expect(previous[0].ts).toBe(NOW - 9 * DAY);
	});

	it("has nothing to compare an all-time range against", () => {
		expect(previousRange([entry()], range("all"), NOW)).toEqual([]);
	});
});

describe("groupBy", () => {
	it("orders the heaviest group first and shares add up to one", () => {
		const groups = groupBy(
			[
				entry({ model: "a", costUsd: 1 }),
				entry({ model: "b", costUsd: 3 }),
				entry({ model: "b", costUsd: 0 }),
			],
			"model",
		);
		expect(groups.map((g) => g.key)).toEqual(["b", "a"]);
		expect(groups[0].turns).toBe(2);
		expect(groups.reduce((s, g) => s + g.share, 0)).toBeCloseTo(1);
	});

	it("drops the entries that carry nothing for the dimension", () => {
		const groups = groupBy(
			[entry(), entry({ agentId: "a1", agentName: "Argus" })],
			"agent",
		);
		expect(groups).toHaveLength(1);
		expect(groups[0].label).toBe("Argus");
	});

	it("can rank by tokens when every turn came back free", () => {
		const groups = groupBy(
			[
				entry({
					model: "a",
					costUsd: 0,
					inputTokens: 10,
					outputTokens: 0,
					cacheReadTokens: 0,
				}),
				entry({
					model: "b",
					costUsd: 0,
					inputTokens: 90,
					outputTokens: 0,
					cacheReadTokens: 0,
				}),
			],
			"model",
			"tokens",
		);
		expect(groups[0].key).toBe("b");
		expect(groups[0].share).toBeCloseTo(0.9);
	});
});

describe("dailySeries", () => {
	it("keeps the days nothing ran", () => {
		const series = dailySeries([entry({ ts: NOW })], range("7d"), NOW);
		expect(series).toHaveLength(7);
		expect(series[6].day).toBe(dayKey(NOW));
		expect(series[6].turns).toBe(1);
		expect(series[0].turns).toBe(0);
	});

	it("starts an all-time series at the oldest turn", () => {
		const series = dailySeries(
			[entry({ ts: NOW - 2 * DAY }), entry({ ts: NOW })],
			range("all"),
			NOW,
		);
		expect(series).toHaveLength(3);
		expect(series[0].day).toBe(dayKey(NOW - 2 * DAY));
	});
});

describe("hourlyLoad", () => {
	it("counts the turns in the hour they landed", () => {
		const hours = hourlyLoad([
			entry({ ts: new Date(2026, 0, 15, 9).getTime() }),
		]);
		expect(hours).toHaveLength(24);
		expect(hours[9]).toBe(1);
	});
});

describe("trend", () => {
	it("is null when there is no previous period to compare with", () => {
		expect(trend(10, 0)).toBeNull();
	});

	it("reads as a ratio of the previous period", () => {
		expect(trend(15, 10)).toBeCloseTo(0.5);
		expect(trend(5, 10)).toBeCloseTo(-0.5);
	});
});

describe("usageCsv", () => {
	it("quotes a field that would otherwise break the row", () => {
		const csv = usageCsv([entry({ conversationTitle: 'Fix "a", then b' })]);
		const [header, row] = csv.split("\n");
		expect(header.startsWith("timestamp,date,project")).toBe(true);
		expect(row).toContain('"Fix ""a"", then b"');
	});
});
