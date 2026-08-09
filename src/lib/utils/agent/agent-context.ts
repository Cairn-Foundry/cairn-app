import { buildHandoffTranscript, type HandoffMessage } from "./handoff";

/** One exchange an agent already had in this conversation. */
export interface AgentTurn {
	prompt: string;
	result: string;
}

/**
 * What the conversation tells an agent when it is called. Only what was *said*
 * since the agent's last run travels: never the tool activity, never the system
 * lines, never the rest of the thread. The agent keeps its own context, so
 * resending what it already heard would only pay for it twice.
 */
export function conversationDelta(
	messages: HandoffMessage[],
	syncedMessages: number,
): string {
	return buildHandoffTranscript(messages.slice(syncedMessages));
}

/**
 * The agent's own memory of this conversation, for a provider taking its thread
 * over. Only the prompts it was given and the answers it returned - the same
 * lossy view the conversation has of it.
 */
export function agentThreadTranscript(turns: AgentTurn[]): string {
	const messages: HandoffMessage[] = [];
	for (const turn of turns) {
		if (turn.prompt.trim()) {
			messages.push({ role: "user", content: turn.prompt });
		}
		if (turn.result.trim()) {
			messages.push({ role: "agent", content: turn.result });
		}
	}
	return buildHandoffTranscript(messages);
}

/**
 * The prompt an agent run receives: what the conversation said since last time,
 * its own past turns when a new provider is picking the thread up, then the
 * message itself. Both blocks are context, and both are capped.
 */
export function buildAgentPrompt(
	message: string,
	delta: string,
	threadTranscript: string,
): string {
	const blocks: string[] = [];
	if (threadTranscript) {
		blocks.push(
			"<your-earlier-work>",
			"Your own past turns in this conversation, handed over from another",
			"provider. Context only - do not reply to it.",
			"",
			threadTranscript,
			"</your-earlier-work>",
			"",
		);
	}
	if (delta) {
		blocks.push(
			"<conversation>",
			"What was said in the conversation that called you, since your last",
			"turn. Context only - do not reply to it.",
			"",
			delta,
			"</conversation>",
			"",
		);
	}
	return blocks.length ? [...blocks, message].join("\n") : message;
}

/**
 * What the conversation's own provider is handed once an agent has answered.
 * It never saw that turn - the agent ran in its own process - so without this
 * the next message would refer to work the provider has no record of.
 *
 * Only the final answer travels, never the agent's tool activity: the two
 * contexts stay separate, and what crosses is what was said.
 */
export function buildAgentResultBlock(
	results: { agentName: string; result: string }[],
): string {
	const usable = results.filter((r) => r.result.trim());
	if (!usable.length) return "";
	return [
		"<agent-results>",
		"Agents you did not run answered in this conversation. Context only -",
		"do not reply to it.",
		"",
		...usable.map((r) => `${r.agentName}: ${r.result.trim()}`),
		"</agent-results>",
		"",
	].join("\n");
}
