import { invoke } from "@tauri-apps/api/core";
import type { AgentBlock, MessageUsage } from "./conversation-service";

export type AgentRunStatus =
	| "running"
	| "awaiting-permission"
	| "done"
	| "stopped"
	| "error"
	| "interrupted";

export type { AgentBlock };

export interface AgentRun {
	id: string;
	agentId: string;
	agentName: string;
	color: string;
	icon: string;
	instanceId: string;
	instanceName: string;
	conversationId: string;
	conversationTitle: string;
	scope: "instance" | "project";
	providerId: string;
	model: string;
	workingDir: string;
	prompt: string;
	startedAt: number;
	endedAt: number | null;
	status: AgentRunStatus;
	result: string;
	/** The agent's reasoning, handed to the conversation with its answer. */
	thinking: string;
	/**
	 * Whether the result has already been handed to the conversation's own
	 * provider, which never saw the agent answer.
	 */
	delivered: boolean;
	/**
	 * What the agent did, in the order it did it. Text, reasoning and tool calls
	 * share one list because they interleave: an answer written before three
	 * tool calls must not be shown after them.
	 */
	blocks: AgentBlock[];
	/** Tokens, cost, duration and turns, so an agent run is costed like a turn. */
	usage: MessageUsage | null;
	error: string;
	/** Set when the run took over from another provider mid-thread. */
	handedOverFrom: string;
}

export async function getAgentRuns(projectId: string): Promise<AgentRun[]> {
	return await invoke("get_agent_runs", { projectId });
}

export async function saveAgentRuns(
	projectId: string,
	runs: AgentRun[],
): Promise<void> {
	await invoke("save_agent_runs", { projectId, runs });
}
