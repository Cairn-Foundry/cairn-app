import type { AgentBlock } from "$lib/services/conversation-service";

export interface DelegationStart {
	/** The provider's id for the `Agent` call that started the subagent. */
	toolUseId: string;
	/** The subagent's name, which is what the roster calls it. */
	name: string;
	color: string;
	/** The run holding what it did, so its thread can be opened from here. */
	agentRunId: string;
}

/**
 * Turns the line the provider drew for a delegation into the subagent's own.
 *
 * The provider announces an `Agent` tool call before it says which agent it
 * is, so the turn already holds an ordinary tool line by the time the name
 * arrives. That line is rewritten in place: one delegation is one entry, and
 * appending a second would leave the tool row behind saying nothing useful.
 */
export function openDelegation(
	blocks: AgentBlock[],
	start: DelegationStart,
): void {
	const block: AgentBlock = {
		kind: "agent",
		phase: "start",
		text: start.name,
		toolId: start.toolUseId,
		agentRunId: start.agentRunId,
		color: start.color,
		done: false,
	};
	const drawn = blocks.findLast(
		(b) => b.kind === "tool" && b.toolId === start.toolUseId,
	);
	if (drawn) Object.assign(drawn, block);
	else blocks.push(block);
}

/**
 * Records that a delegation finished, with what the subagent answered.
 *
 * A new entry at the end of the turn, never a rewrite of the one that started
 * it: the provider keeps working while a subagent does, and folding the answer
 * back into the starting line would place it before everything written while
 * waiting for it.
 *
 * The answer stays inside the turn rather than becoming a message after it.
 * The provider was handed the same answer and goes on writing about it, so a
 * message here would say everything twice - and, because the run keeps
 * rewriting the message it owns, it would land above the reply commenting on
 * it and reorder the transcript on reload.
 */
export function closeDelegation(
	blocks: AgentBlock[],
	agentRunId: string,
	outcome: { result: string; failed: boolean },
): boolean {
	const started = blocks.findLast(
		(b) =>
			b.kind === "agent" && b.phase === "start" && b.agentRunId === agentRunId,
	);
	if (!started) return false;
	started.done = true;
	blocks.push({
		kind: "agent",
		phase: "end",
		text: started.text,
		agentRunId,
		color: started.color,
		done: true,
		failed: outcome.failed,
		result: outcome.result,
	});
	return true;
}

/**
 * Closes the tool call a result belongs to: by id when the provider gave one,
 * by recency otherwise. A delegation's result arrives long after it started,
 * so the last still-open line is not necessarily the one that just finished.
 */
export function closeToolBlock(
	blocks: AgentBlock[],
	failed: boolean,
	toolUseId = "",
): void {
	const open = toolUseId
		? blocks.findLast((b) => b.kind === "tool" && b.toolId === toolUseId)
		: blocks.findLast((b) => b.kind === "tool" && !b.done);
	if (!open) return;
	open.done = true;
	open.failed = failed;
}
