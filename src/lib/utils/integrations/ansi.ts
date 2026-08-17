// Turns a CI job log carrying ANSI SGR colour codes into safe HTML: text is
// escaped, colours become <span> elements, every other escape sequence is dropped.

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const ESCAPE_SEQUENCE = new RegExp(
	`${ESC}\\[([0-9;]*)([A-Za-z])|${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`,
	"g",
);

const NAMED_COLORS = [
	"black",
	"red",
	"green",
	"yellow",
	"blue",
	"magenta",
	"cyan",
	"white",
];

interface SgrState {
	fg: string | null;
	bg: string | null;
	isBold: boolean;
	isDim: boolean;
	isItalic: boolean;
	isUnderline: boolean;
}

const RESET: SgrState = {
	fg: null,
	bg: null,
	isBold: false,
	isDim: false,
	isItalic: false,
	isUnderline: false,
};

export function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function colorFromCode(code: number, offset: number): string | null {
	const index = code - offset;
	if (index >= 0 && index < 8) return NAMED_COLORS[index];
	if (index >= 60 && index < 68) return `bright-${NAMED_COLORS[index - 60]}`;
	return null;
}

function colorFrom256(value: number): string {
	if (value < 8) return NAMED_COLORS[value];
	if (value < 16) return `bright-${NAMED_COLORS[value - 8]}`;
	if (value < 232) {
		const level = value - 16;
		const r = Math.floor(level / 36);
		const g = Math.floor((level % 36) / 6);
		const b = level % 6;
		const channel = (n: number) => (n === 0 ? 0 : 55 + n * 40);
		return `rgb(${channel(r)},${channel(g)},${channel(b)})`;
	}
	const grey = 8 + (value - 232) * 10;
	return `rgb(${grey},${grey},${grey})`;
}

/** Applies one SGR parameter list (`1;31`, `38;5;208`, `0`) to the state. */
export function applySgr(state: SgrState, params: string): SgrState {
	const codes = params === "" ? [0] : params.split(";").map((n) => Number(n));
	let next = { ...state };
	for (let i = 0; i < codes.length; i++) {
		const code = codes[i];
		if (Number.isNaN(code)) continue;
		if (code === 0) next = { ...RESET };
		else if (code === 1) next.isBold = true;
		else if (code === 2) next.isDim = true;
		else if (code === 3) next.isItalic = true;
		else if (code === 4) next.isUnderline = true;
		else if (code === 22) {
			next.isBold = false;
			next.isDim = false;
		} else if (code === 23) next.isItalic = false;
		else if (code === 24) next.isUnderline = false;
		else if (code === 39) next.fg = null;
		else if (code === 49) next.bg = null;
		else if (code === 38 || code === 48) {
			const mode = codes[i + 1];
			let color: string | null = null;
			if (mode === 5 && codes[i + 2] !== undefined) {
				color = colorFrom256(codes[i + 2]);
				i += 2;
			} else if (mode === 2 && codes[i + 4] !== undefined) {
				color = `rgb(${codes[i + 2]},${codes[i + 3]},${codes[i + 4]})`;
				i += 4;
			}
			if (code === 38) next.fg = color;
			else next.bg = color;
		} else {
			const fg = colorFromCode(code, 30);
			const bg = colorFromCode(code, 40);
			if (fg) next.fg = fg;
			else if (bg) next.bg = bg;
		}
	}
	return next;
}

function isNamed(color: string): boolean {
	return !color.startsWith("rgb(");
}

function openTag(state: SgrState): string {
	const classes: string[] = [];
	const styles: string[] = [];
	if (state.fg) {
		if (isNamed(state.fg)) classes.push(`ansi-fg-${state.fg}`);
		else styles.push(`color:${state.fg}`);
	}
	if (state.bg) {
		if (isNamed(state.bg)) classes.push(`ansi-bg-${state.bg}`);
		else styles.push(`background:${state.bg}`);
	}
	if (state.isBold) classes.push("ansi-bold");
	if (state.isDim) classes.push("ansi-dim");
	if (state.isItalic) classes.push("ansi-italic");
	if (state.isUnderline) classes.push("ansi-underline");
	if (classes.length === 0 && styles.length === 0) return "";
	const classAttr = classes.length ? ` class="${classes.join(" ")}"` : "";
	const styleAttr = styles.length ? ` style="${styles.join(";")}"` : "";
	return `<span${classAttr}${styleAttr}>`;
}

/**
 * The log as HTML lines: escaped text wrapped in `<span class="ansi-...">`
 * runs, one entry per line, a span never crossing a line break so each line
 * can be rendered on its own. Colours are `ansi-fg-<name>` / `ansi-bg-<name>`
 * for the 16 named ones and inline `style` for 256-colour and truecolor
 * values; unknown sequences vanish.
 */
export function ansiToLines(text: string): string[] {
	const lines: string[] = [];
	let line = "";
	let state: SgrState = { ...RESET };
	let isOpen = false;
	let last = 0;
	const closeRun = () => {
		if (isOpen) {
			line += "</span>";
			isOpen = false;
		}
	};
	const write = (raw: string) => {
		if (raw === "") return;
		if (!isOpen) {
			const tag = openTag(state);
			if (tag) {
				line += tag;
				isOpen = true;
			}
		}
		line += escapeHtml(raw);
	};
	const flush = (until: number) => {
		if (until <= last) return;
		const parts = text.slice(last, until).split("\n");
		for (let i = 0; i < parts.length; i++) {
			if (i > 0) {
				closeRun();
				lines.push(line);
				line = "";
			}
			write(parts[i]);
		}
	};
	ESCAPE_SEQUENCE.lastIndex = 0;
	for (
		let match = ESCAPE_SEQUENCE.exec(text);
		match !== null;
		match = ESCAPE_SEQUENCE.exec(text)
	) {
		flush(match.index);
		last = match.index + match[0].length;
		if (match[2] === "m") {
			state = applySgr(state, match[1]);
			closeRun();
		}
	}
	flush(text.length);
	closeRun();
	lines.push(line);
	return lines;
}

/** `ansiToLines` joined back with line breaks. */
export function ansiToSpans(text: string): string {
	return ansiToLines(text).join("\n");
}

/** The log with every escape sequence removed, for searching and excerpts. */
export function stripAnsi(text: string): string {
	return text.replace(ESCAPE_SEQUENCE, "");
}
