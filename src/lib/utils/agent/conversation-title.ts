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

const ESC = String.fromCharCode(27);
const DEL = String.fromCharCode(127);

/** CSI / OSC escape sequences an interactive prompt sends while editing. */
const ESCAPE_SEQUENCE = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]|${ESC}.`, "g");

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
			const title = line.replace(CONTROL, "").trim().slice(0, TITLE_MAX);
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
