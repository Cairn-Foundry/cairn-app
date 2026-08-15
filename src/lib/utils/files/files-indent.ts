// Detecting and converting a file's line endings and indentation. The editor
// always holds LF internally; the original ending is restored on save.

/** To the LF form the editor holds in memory. */
export function normalizeLineEndings(text: string, le: "CRLF" | "LF"): string {
	return le === "CRLF" ? text.replace(/\r\n/g, "\n") : text;
}

/** Back to the file's own endings, for writing to disk. */
export function denormalizeLineEndings(
	text: string,
	le: "CRLF" | "LF",
): string {
	return le === "CRLF" ? text.replace(/\n/g, "\r\n") : text;
}

/** A single CRLF anywhere makes the whole file CRLF. */
export function detectLineEndings(text: string): "CRLF" | "LF" {
	return text.includes("\r\n") ? "CRLF" : "LF";
}

/**
 * Decided on the first 100 lines only, and ties go to tabs. Null when nothing
 * in the file is indented, leaving the choice to the editor settings.
 */
export function detectIndentStyle(text: string): "tabs" | "spaces" | null {
	let tabs = 0,
		spaces = 0;
	const lines = text.split("\n");
	const limit = Math.min(lines.length, 100);
	for (let i = 0; i < limit; i++) {
		const line = lines[i];
		if (line.startsWith("\t")) tabs++;
		else if (/^ {2,}\S/.test(line)) spaces++;
	}
	if (tabs === 0 && spaces === 0) return null;
	return tabs >= spaces ? "tabs" : "spaces";
}

/**
 * The smallest indent width no larger than 4, since a file indented by 4 also
 * shows 8 and 12 as leading runs. Falls back to 2 when nothing is indented.
 */
export function detectSpaceSize(text: string): number {
	const counts: Record<number, number> = {};
	for (const line of text.split("\n")) {
		const m = line.match(/^( +)\S/);
		if (m) {
			const n = m[1].length;
			counts[n] = (counts[n] ?? 0) + 1;
		}
	}
	const sorted = Object.keys(counts)
		.map(Number)
		.sort((a, b) => a - b);
	if (!sorted.length) return 2;
	return sorted.find((n) => n <= 4) ?? sorted[0];
}

/** Leading tabs only: a tab inside a line may be data. */
export function convertToSpaces(text: string, size: number): string {
	return text
		.split("\n")
		.map((line) => {
			let i = 0;
			while (line[i] === "\t") i++;
			return " ".repeat(i * size) + line.slice(i);
		})
		.join("\n");
}

/** Leading runs of exactly `size` spaces only; a partial run is left alone. */
export function convertToTabs(text: string, size: number): string {
	const sp = " ".repeat(size);
	return text
		.split("\n")
		.map((line) => {
			let i = 0;
			while (line.slice(i, i + size) === sp) i += size;
			return "\t".repeat(i / size) + line.slice(i);
		})
		.join("\n");
}
