// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Naming a conversation from what the user typed into its CLI.
 *
 * Cairn reads keystrokes on their way into the PTY and nothing on the way out:
 * the CLIs render their own prompt with their own escape sequences, and parsing
 * that back is exactly the coupling this refonte removed. The first line a user
 * commits with Enter is the prompt they asked, which is the best title
 * available without reading a single byte of output.
 */

/** A prompt can be a paragraph; the history row shows one line. */
export const TITLE_MAX = 80;

/**
 * Openers a prompt starts with and a title should not: politeness, the "can
 * you" framing, and the pronoun that follows it.
 */
const FILLER =
	/^(?:s'?il te plait|s'?il vous plait|please|hey|hi|ok|bon|alors|donc|(?:can|could|would|will)\s+you|(?:i|je)\s+(?:want|need|would\s+like|voudrais|veux|aimerais)(?:\s+(?:you\s+to|que\s+tu))?|peux[- ]tu|pourrais[- ]tu|tu\s+peux|let'?s|on\s+va|je\s+vais)[,\s]+/i;

/**
 * Turns a typed prompt into something that reads as a name: no politeness, one
 * sentence, no trailing punctuation, capitalised.
 *
 * The CLIs render their own output and Cairn never reads it, so the prompt is
 * all there is to name a conversation with. Shaping it is what makes the row
 * say "Fix the parser" instead of "please can you fix the parser for me?".
 */
export function titleFromPrompt(line: string): string {
	let text = line.replace(CONTROL, "").trim();
	let previous = "";
	while (text !== previous) {
		previous = text;
		text = text.replace(FILLER, "");
	}
	// One sentence: the rest of a paragraph is context, not a name.
	text = text.split(/(?<=[.!?])\s+/)[0] ?? text;
	text = text.replace(/[\s.,;:!?]+$/, "").trim();
	if (!text) return "";
	if (text.length > TITLE_MAX) {
		const cut = text.slice(0, TITLE_MAX);
		const space = cut.lastIndexOf(" ");
		text = (space > TITLE_MAX / 2 ? cut.slice(0, space) : cut).trim();
	}
	return text.charAt(0).toUpperCase() + text.slice(1);
}

const ESC = String.fromCharCode(27);
const DEL = String.fromCharCode(127);

/** CSI / OSC escape sequences an interactive prompt sends while editing. */
const ESCAPE_SEQUENCE = new RegExp(
	`${ESC}\\[[0-9:;<=>?]*[ -/]*[@-~]|${ESC}.`,
	"g",
);

/** Everything below space, which is control input rather than text. */
const CONTROL = new RegExp(`[\\x00-\\x1f${DEL}]`, "g");

/**
 * What the typed bytes amount to as a title, or null while the line is still
 * being typed.
 *
 * `pending` is what was typed since the last Enter; the return value replaces
 * it. A backspace erases a character rather than leaving a marker, so the title
 * matches what the user saw themselves type.
 */
export function captureTitle(
	pending: string,
	data: string,
): { title: string | null; pending: string } {
	const cleaned = data.replace(ESCAPE_SEQUENCE, "");
	let line = pending;

	for (const char of cleaned) {
		if (char === "\r" || char === "\n") {
			const title = titleFromPrompt(line);
			// An empty Enter is not a title; keep waiting for a real prompt.
			return title ? { title, pending: "" } : { title: null, pending: "" };
		}
		if (char === "\b" || char === DEL) {
			line = line.slice(0, -1);
			continue;
		}
		line += char;
	}
	return { title: null, pending: line };
}
