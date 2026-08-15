import { formatCount, formatDuration } from "$lib/utils/format";

/** The metrics that can be shown under an answer. */
export type ResponseStatField = "duration" | "tokens" | "cost" | "turns";

/** A stat and the icon it is drawn with, before a value is known. */
export interface ResponseStatDef {
	id: ResponseStatField;
	icon: string;
}

// Keep in sync with default_response_stats() in src-tauri/src/commands/settings.rs.
// The model is deliberately absent: the answer already carries it in its header.
export const RESPONSE_STAT_FIELDS: ResponseStatDef[] = [
	{ id: "duration", icon: "clock" },
	{ id: "tokens", icon: "layers" },
	{ id: "cost", icon: "gauge" },
	{ id: "turns", icon: "refresh" },
];

/**
 * What a provider reported about one answer. Everything is optional: providers
 * disagree on what they measure.
 */
export interface ResponseUsage {
	model?: string;
	inputTokens?: number;
	outputTokens?: number;
	cacheReadTokens?: number;
	costUsd?: number;
	durationMs?: number;
	numTurns?: number;
}

/** A stat ready to render: the value is already formatted for display. */
export interface ResponseStat {
	id: ResponseStatField;
	icon: string;
	value: string;
}

/**
 * The stats of one answer, in the order the user chose to see them, skipping
 * whatever the provider did not report.
 */
export function responseStats(
	usage: ResponseUsage,
	enabled: readonly string[],
): ResponseStat[] {
	const values: Record<ResponseStatField, string | null> = {
		duration:
			usage.durationMs != null ? formatDuration(usage.durationMs) : null,
		tokens:
			usage.inputTokens != null || usage.outputTokens != null
				? `${formatCount((usage.inputTokens ?? 0) + (usage.cacheReadTokens ?? 0))} in / ${formatCount(usage.outputTokens ?? 0)} out`
				: null,
		cost: usage.costUsd != null ? `$${usage.costUsd.toFixed(4)}` : null,
		turns: usage.numTurns != null ? String(usage.numTurns) : null,
	};

	return RESPONSE_STAT_FIELDS.filter((f) => enabled.includes(f.id))
		.map((f) => ({ id: f.id, icon: f.icon, value: values[f.id] }))
		.filter((s): s is ResponseStat => s.value !== null);
}
