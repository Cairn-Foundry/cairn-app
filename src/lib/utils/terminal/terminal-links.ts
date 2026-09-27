// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { IBuffer, IBufferCell } from "@xterm/xterm";

// Paths and URLs printed in a terminal, found by text pattern alone: Cairn never
// learns the output format of the CLI running in it, so the same rules serve
// every agent and every shell.

/** A file path or URL spotted in a line of terminal text, `[start, end)` in that text. */
export type LinkCandidate =
	| { kind: "url"; start: number; end: number; url: string }
	| {
			kind: "path";
			start: number;
			end: number;
			path: string;
			line: number;
			col: number;
	  };

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`]+/g;
// A path, then an optional `:line[:col]` or `(line,col)` position.
const PATH_PATTERN =
	/(?:\.{1,2}\/|\/)?(?:[\w@+-][\w.@+-]*\/)*[\w@+-][\w.@+-]*(?::(\d+)(?::(\d+))?|\((\d+),(\d+)\))?/g;
const TRAILING_URL_PUNCTUATION = /[.,;:!?)\]}]+$/;

/**
 * Every link-shaped token of a line. A path has to carry a separator or an
 * extension to qualify, so a plain word is never proposed; whether it exists on
 * disk is for the caller to check.
 */
export function findLinkCandidates(text: string): LinkCandidate[] {
	const found: LinkCandidate[] = [];
	for (const m of text.matchAll(URL_PATTERN)) {
		const url = m[0].replace(TRAILING_URL_PUNCTUATION, "");
		found.push({ kind: "url", start: m.index, end: m.index + url.length, url });
	}
	const urls = [...found];
	for (const m of text.matchAll(PATH_PATTERN)) {
		const start = m.index;
		if (text[start - 1] === "~") continue;
		const hasPosition = m[1] !== undefined || m[3] !== undefined;
		const raw = hasPosition
			? m[0].slice(0, m[0].search(/[:(]\d/))
			: m[0].replace(/\.+$/, "");
		if (!raw.includes("/") && !/\.\w+$/.test(raw)) continue;
		if (!/[A-Za-z]/.test(raw)) continue;
		const end = start + (hasPosition ? m[0].length : raw.length);
		if (urls.some((u) => start < u.end && end > u.start)) continue;
		found.push({
			kind: "path",
			start,
			end,
			path: raw,
			line: Number(m[1] ?? m[3] ?? 1),
			col: Number(m[2] ?? m[4] ?? 1),
		});
	}
	return found.sort((a, b) => a.start - b.start);
}

/**
 * The absolute form of a printed path, `.` and `..` folded. A relative path is
 * read against `base`; without one, only an absolute path resolves.
 */
export function resolveLinkPath(
	path: string,
	base: string | null,
): string | null {
	if (!path.startsWith("/") && !base) return null;
	const joined = path.startsWith("/") ? path : `${base}/${path}`;
	const segments: string[] = [];
	for (const segment of joined.split("/")) {
		if (segment === "" || segment === ".") continue;
		if (segment === "..") {
			if (segments.length === 0) return null;
			segments.pop();
		} else {
			segments.push(segment);
		}
	}
	return `${joined.startsWith("/") ? "/" : ""}${segments.join("/")}`;
}

/** A screen line as text, with the 1-based cell each UTF-16 unit was drawn in. */
export interface LogicalLine {
	text: string;
	cells: { x: number; y: number }[];
}

/**
 * The whole line a buffer row belongs to: a path longer than the terminal is
 * wide wraps onto the next rows, and matching row by row would cut it in two.
 */
export function readLogicalLine(buffer: IBuffer, row: number): LogicalLine {
	let first = row;
	while (first > 0 && buffer.getLine(first)?.isWrapped) first--;
	let last = row;
	while (buffer.getLine(last + 1)?.isWrapped) last++;

	const result: LogicalLine = { text: "", cells: [] };
	let cell: IBufferCell | undefined;
	for (let y = first; y <= last; y++) {
		const line = buffer.getLine(y);
		if (!line) break;
		for (let x = 0; x < line.length; x++) {
			cell = line.getCell(x, cell);
			if (!cell || cell.getWidth() === 0) continue;
			const chars = cell.getChars() || " ";
			for (let i = 0; i < chars.length; i++) {
				result.text += chars[i];
				result.cells.push({ x: x + 1, y: y + 1 });
			}
		}
	}
	return result;
}
