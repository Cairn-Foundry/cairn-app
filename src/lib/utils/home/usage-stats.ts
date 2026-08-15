import type { UsageEntry } from "$lib/services/usage-service";

// The whole usage dashboard runs on this file: filtering the ledger by range,
// summing it, grouping it by dimension, and shaping it for the charts.

/** The ranges the dashboard offers. */
export type UsageRangeId = "7d" | "30d" | "90d" | "all";

/** A selectable range. */
export interface UsageRange {
	id: UsageRangeId;
	/** Days the range covers, or null when it covers the whole ledger. */
	days: number | null;
}

/** The ranges in the order the selector shows them. */
export const USAGE_RANGES: UsageRange[] = [
	{ id: "7d", days: 7 },
	{ id: "30d", days: 30 },
	{ id: "90d", days: 90 },
	{ id: "all", days: null },
];

/** What the usage table can be broken down by. */
export type UsageDimension =
	| "model"
	| "provider"
	| "project"
	| "agent"
	| "conversation";

/** Everything the summary cards show, sums and derived ratios alike. */
export interface UsageTotals {
	turns: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheCreationTokens: number;
	tokens: number;
	costUsd: number;
	durationMs: number;
	conversations: number;
	projects: number;
	models: number;
	agentTurns: number;
	/** Share of input that came from the cache rather than being re-read. */
	cacheRatio: number;
	costPerTurn: number;
	tokensPerTurn: number;
}

/** One row of the breakdown table. */
export interface UsageGroup {
	key: string;
	label: string;
	turns: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	tokens: number;
	costUsd: number;
	durationMs: number;
	/** Share of the group's metric over the whole set, from 0 to 1. */
	share: number;
}

/** One column of the daily chart. */
export interface UsageBucket {
	/** Local calendar day, as YYYY-MM-DD. */
	day: string;
	ts: number;
	turns: number;
	tokens: number;
	costUsd: number;
}

/** Local calendar day of a timestamp, as YYYY-MM-DD - never UTC, because a */
/** turn belongs to the day the user remembers working, not to Greenwich. */
export function dayKey(ts: number): string {
	const d = new Date(ts);
	const month = `${d.getMonth() + 1}`.padStart(2, "0");
	const day = `${d.getDate()}`.padStart(2, "0");
	return `${d.getFullYear()}-${month}-${day}`;
}

/** Local midnight of the day a timestamp falls in. */
function startOfDay(ts: number): number {
	const d = new Date(ts);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}

/**
 * The window a range covers, as [from, to]. A range of N days is the current
 * day plus the N-1 before it, so "7 days" reads as a week on the chart rather
 * than as eight columns with a stub at each end.
 */
export function rangeWindow(
	range: UsageRange,
	now: number,
): { from: number; to: number } {
	const to = now;
	if (range.days === null) return { from: 0, to };
	return { from: startOfDay(now) - (range.days - 1) * 86_400_000, to };
}

/** The entries inside the range; `all` keeps the whole ledger. */
export function filterRange(
	entries: UsageEntry[],
	range: UsageRange,
	now: number,
): UsageEntry[] {
	const { from } = rangeWindow(range, now);
	return entries.filter((e) => e.ts >= from);
}

/** The same-length window immediately before the range, for the trend. */
export function previousRange(
	entries: UsageEntry[],
	range: UsageRange,
	now: number,
): UsageEntry[] {
	if (range.days === null) return [];
	const { from } = rangeWindow(range, now);
	const span = range.days * 86_400_000;
	return entries.filter((e) => e.ts >= from - span && e.ts < from);
}

/** One pass over the entries: sums, distinct counts, then the ratios. */
export function totals(entries: UsageEntry[]): UsageTotals {
	const t: UsageTotals = {
		turns: entries.length,
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheCreationTokens: 0,
		tokens: 0,
		costUsd: 0,
		durationMs: 0,
		conversations: 0,
		projects: 0,
		models: 0,
		agentTurns: 0,
		cacheRatio: 0,
		costPerTurn: 0,
		tokensPerTurn: 0,
	};
	const conversations = new Set<string>();
	const projects = new Set<string>();
	const models = new Set<string>();

	for (const e of entries) {
		t.inputTokens += e.inputTokens;
		t.outputTokens += e.outputTokens;
		t.cacheReadTokens += e.cacheReadTokens;
		t.cacheCreationTokens += e.cacheCreationTokens;
		t.costUsd += e.costUsd;
		t.durationMs += e.durationMs;
		if (e.agentId) t.agentTurns += 1;
		if (e.conversationId)
			conversations.add(`${e.projectId}:${e.conversationId}`);
		if (e.projectId) projects.add(e.projectId);
		if (e.model) models.add(e.model);
	}

	t.tokens =
		t.inputTokens + t.outputTokens + t.cacheReadTokens + t.cacheCreationTokens;
	t.conversations = conversations.size;
	t.projects = projects.size;
	t.models = models.size;

	const readSide = t.inputTokens + t.cacheReadTokens;
	t.cacheRatio = readSide > 0 ? t.cacheReadTokens / readSide : 0;
	t.costPerTurn = t.turns > 0 ? t.costUsd / t.turns : 0;
	t.tokensPerTurn = t.turns > 0 ? t.tokens / t.turns : 0;
	return t;
}

const DIMENSIONS: Record<
	UsageDimension,
	(e: UsageEntry) => { key: string; label: string } | null
> = {
	model: (e) => (e.model ? { key: e.model, label: e.model } : null),
	provider: (e) =>
		e.providerId ? { key: e.providerId, label: e.providerId } : null,
	project: (e) =>
		e.projectId
			? { key: e.projectId, label: e.projectName || e.projectId }
			: null,
	agent: (e) =>
		e.agentId ? { key: e.agentId, label: e.agentName || e.agentId } : null,
	conversation: (e) =>
		e.conversationId
			? {
					key: `${e.projectId}:${e.conversationId}`,
					label: e.conversationTitle || e.conversationId,
				}
			: null,
};

/**
 * Sums the turns by one dimension, heaviest first. Entries that carry no value
 * for that dimension are dropped rather than piled into an "unknown" row: a
 * bucket nobody can act on only makes the table longer.
 */
export function groupBy(
	entries: UsageEntry[],
	dimension: UsageDimension,
	sortBy: "cost" | "tokens" = "cost",
): UsageGroup[] {
	const of = DIMENSIONS[dimension];
	const map = new Map<string, UsageGroup>();

	for (const e of entries) {
		const id = of(e);
		if (!id) continue;
		let group = map.get(id.key);
		if (!group) {
			group = {
				key: id.key,
				label: id.label,
				turns: 0,
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				tokens: 0,
				costUsd: 0,
				durationMs: 0,
				share: 0,
			};
			map.set(id.key, group);
		}
		group.label = id.label;
		group.turns += 1;
		group.inputTokens += e.inputTokens;
		group.outputTokens += e.outputTokens;
		group.cacheReadTokens += e.cacheReadTokens;
		group.tokens +=
			e.inputTokens +
			e.outputTokens +
			e.cacheReadTokens +
			e.cacheCreationTokens;
		group.costUsd += e.costUsd;
		group.durationMs += e.durationMs;
	}

	const groups = [...map.values()];
	const metric = (g: UsageGroup) => (sortBy === "cost" ? g.costUsd : g.tokens);
	const total = groups.reduce((sum, g) => sum + metric(g), 0);
	for (const g of groups) g.share = total > 0 ? metric(g) / total : 0;

	return groups.sort(
		(a, b) =>
			metric(b) - metric(a) ||
			b.turns - a.turns ||
			a.label.localeCompare(b.label),
	);
}

/**
 * One bucket per calendar day of the range, including the days nothing ran -
 * a chart with the empty days removed lies about the rhythm of the work.
 */
export function dailySeries(
	entries: UsageEntry[],
	range: UsageRange,
	now: number,
): UsageBucket[] {
	const first = entries.reduce((min, e) => Math.min(min, e.ts), now);
	const from =
		range.days === null ? startOfDay(first) : rangeWindow(range, now).from;
	const to = startOfDay(now);
	const dayCount = Math.max(1, Math.round((to - from) / 86_400_000) + 1);

	const buckets = new Map<string, UsageBucket>();
	for (let i = 0; i < dayCount; i++) {
		const ts = from + i * 86_400_000;
		buckets.set(dayKey(ts), {
			day: dayKey(ts),
			ts,
			turns: 0,
			tokens: 0,
			costUsd: 0,
		});
	}
	for (const e of entries) {
		const bucket = buckets.get(dayKey(e.ts));
		if (!bucket) continue;
		bucket.turns += 1;
		bucket.tokens +=
			e.inputTokens +
			e.outputTokens +
			e.cacheReadTokens +
			e.cacheCreationTokens;
		bucket.costUsd += e.costUsd;
	}
	return [...buckets.values()].sort((a, b) => a.ts - b.ts);
}

/** Turns per hour of the day, so the chart can show when the work happens. */
export function hourlyLoad(entries: UsageEntry[]): number[] {
	const hours = new Array<number>(24).fill(0);
	for (const e of entries) hours[new Date(e.ts).getHours()] += 1;
	return hours;
}

/**
 * How the range compares with the one before it, as a ratio: 0.25 means a
 * quarter more. Null when there is nothing to compare against, which is not
 * the same as no change.
 */
export function trend(current: number, previous: number): number | null {
	if (previous <= 0) return null;
	return (current - previous) / previous;
}

/** The ledger as CSV, quoting only the cells that need it. */
export function usageCsv(entries: UsageEntry[]): string {
	const header = [
		"timestamp",
		"date",
		"project",
		"instance",
		"conversation",
		"scope",
		"provider",
		"model",
		"agent",
		"inputTokens",
		"outputTokens",
		"cacheReadTokens",
		"cacheCreationTokens",
		"costUsd",
		"durationMs",
		"numTurns",
		"backfilled",
	];
	const cell = (value: string | number | boolean) => {
		const text = String(value);
		return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
	};
	const rows = entries.map((e) =>
		[
			e.ts,
			new Date(e.ts).toISOString(),
			e.projectName,
			e.instanceName,
			e.conversationTitle,
			e.scope,
			e.providerId,
			e.model,
			e.agentName,
			e.inputTokens,
			e.outputTokens,
			e.cacheReadTokens,
			e.cacheCreationTokens,
			e.costUsd,
			e.durationMs,
			e.numTurns,
			e.backfilled,
		]
			.map(cell)
			.join(","),
	);
	return [header.join(","), ...rows].join("\n");
}
