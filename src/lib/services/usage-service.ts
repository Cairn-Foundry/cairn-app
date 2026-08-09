import { invoke } from "@tauri-apps/api/core";

/**
 * One answered turn and what it consumed. Every label the stats page groups by
 * is carried on the entry: a project can be removed, a conversation deleted or
 * an agent renamed, and what was spent still has to read correctly.
 */
export interface UsageEntry {
	id: string;
	/** When the turn came back, in milliseconds. */
	ts: number;
	projectId: string;
	projectName: string;
	instanceId: string;
	instanceName: string;
	conversationId: string;
	conversationTitle: string;
	scope: string;
	providerId: string;
	model: string;
	agentId: string;
	agentName: string;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheCreationTokens: number;
	costUsd: number;
	durationMs: number;
	numTurns: number;
	/**
	 * Set on a turn recovered from a conversation written before the ledger
	 * existed. It carries no timestamp of its own, so it is dated at the
	 * conversation's last activity.
	 */
	backfilled: boolean;
}

export async function getUsageEntries(): Promise<UsageEntry[]> {
	return await invoke("get_usage_entries");
}

export async function appendUsageEntries(entries: UsageEntry[]): Promise<void> {
	await invoke("append_usage_entries", { entries });
}

/** Recovers the turns already on disk that the ledger never saw. */
export async function backfillUsageEntries(): Promise<number> {
	return await invoke("backfill_usage_entries");
}

export async function clearUsageEntries(): Promise<void> {
	await invoke("clear_usage_entries");
}
