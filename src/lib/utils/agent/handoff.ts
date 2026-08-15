// Replaying a thread to a provider that never saw it, when a conversation
// switches from one provider to another mid-way.

/** The minimum a message needs for a handoff: who spoke and what was said. */
export interface HandoffMessage {
	role: string;
	content: string;
}

const MAX_MESSAGES = 20;
const MAX_CHARS = 6000;

/**
 * The recent exchange, for a provider that is taking over a conversation it has
 * never seen. Capped both ways: a thread can be arbitrarily long, and a CLI
 * receives this inside the prompt, where every character is paid for.
 *
 * The newest turns are the ones worth keeping, so the oldest are dropped first.
 */
/**
 * The turns already exchanged here, oldest first, for a provider that has to be
 * given them again: a chat API keeps nothing server-side, and a provider taking
 * a thread over has never seen any of it.
 *
 * System lines - the switch marker, the instance banner - are not turns and are
 * left out. Pass only messages that were already exchanged: the prompt being
 * sent right now travels on its own and must not be duplicated in here.
 */
export function priorTurns(
	messages: HandoffMessage[],
	maxMessages: number = MAX_MESSAGES,
): HandoffMessage[] {
	return messages
		.filter(
			(m) => (m.role === "user" || m.role === "agent") && m.content.trim(),
		)
		.slice(-maxMessages);
}

/**
 * The recent exchange as a flat transcript, capped by turns and by characters.
 * Trimming happens from the oldest end, so the newest turns always survive.
 */
export function buildHandoffTranscript(
	messages: HandoffMessage[],
	maxMessages: number = MAX_MESSAGES,
	maxChars: number = MAX_CHARS,
): string {
	const usable = priorTurns(messages, maxMessages);

	const lines: string[] = [];
	let total = 0;
	for (let i = usable.length - 1; i >= 0; i--) {
		const message = usable[i];
		const speaker = message.role === "user" ? "user" : "assistant";
		const line = `${speaker}: ${message.content.trim()}`;
		if (total + line.length > maxChars) break;
		total += line.length;
		lines.unshift(line);
	}
	return lines.join("\n\n");
}

/**
 * Wraps the transcript around the prompt for a CLI provider, which has no
 * channel for prior turns other than the message itself.
 */
export function withHandoffContext(
	message: string,
	transcript: string,
): string {
	if (!transcript) return message;
	return [
		"<earlier-conversation>",
		"This thread was answered by another provider up to this point.",
		"It is context only - do not reply to it.",
		"",
		transcript,
		"</earlier-conversation>",
		"",
		message,
	].join("\n");
}
