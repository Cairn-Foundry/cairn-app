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
	/** The agent's reasoning, kept with its thread. */
	thinking: string;
	/**
	 * What the agent did, in the order it did it. Text, reasoning and tool calls
	 * share one list because they interleave: an answer written before three
	 * tool calls must not be shown after them.
	 */
	blocks: AgentBlock[];
	/** Tokens, cost, duration and turns, so an agent run is costed like a turn. */
	usage: MessageUsage | null;
	error: string;
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
