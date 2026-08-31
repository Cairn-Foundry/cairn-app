// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Discussion } from "$lib/types/integrations";

/**
 * What a gutter marker stands for. Discussions came first and stay the default;
 * the guide adds its remarks, coloured by kind, and the reviewer's own pending
 * comments. They share one gutter so a line never carries two.
 */
export type MarkerKind =
	| "discussion"
	| "issue"
	| "question"
	| "refactor"
	| "note"
	| "comment";

export interface DiffMarker {
	line: number;
	side: "old" | "new";
	count: number;
	isResolved: boolean;
	kind?: MarkerKind;
}

/** Anchors are compared with forward slashes whatever the platform produced. */
export function normalizeAnchorPath(path: string): string {
	return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function discussionsForFile(
	discussions: Discussion[],
	filePath: string,
): Discussion[] {
	const target = normalizeAnchorPath(filePath);
	return discussions.filter(
		(d) => d.anchor !== null && normalizeAnchorPath(d.anchor.path) === target,
	);
}

export function openDiscussionCount(
	discussions: Discussion[],
	filePath: string,
): number {
	return discussionsForFile(discussions, filePath).filter((d) => !d.resolved)
		.length;
}

/** One marker per anchored line and side; a line is resolved only when every thread on it is. */
export function diffMarkersFor(
	discussions: Discussion[],
	filePath: string,
): DiffMarker[] {
	const byKey = new Map<string, DiffMarker>();
	for (const d of discussionsForFile(discussions, filePath)) {
		if (!d.anchor) continue;
		const key = `${d.anchor.side}:${d.anchor.line}`;
		const existing = byKey.get(key);
		if (existing) {
			existing.count += 1;
			existing.isResolved = existing.isResolved && d.resolved;
		} else {
			byKey.set(key, {
				line: d.anchor.line,
				side: d.anchor.side,
				count: 1,
				isResolved: d.resolved,
				kind: "discussion",
			});
		}
	}
	return [...byKey.values()];
}

/** A few lines of the document around the anchor, prefixed with their line number. */
export function excerptAround(
	content: string,
	line: number,
	radius = 3,
): string {
	const lines = content.split("\n");
	const start = Math.max(0, line - 1 - radius);
	const end = Math.min(lines.length, line + radius);
	return lines
		.slice(start, end)
		.map((text, i) => `${start + i + 1}: ${text}`)
		.join("\n");
}

/**
 * The guide's remarks and the reviewer's comments as gutter markers. A line
 * that already carries a discussion keeps it: the thread on the forge is what
 * the reviewer has to answer, the remark is only a suggestion.
 */
export function guideMarkersFor(
	remarks: {
		path: string;
		side: "old" | "new";
		line: number;
		kind: MarkerKind;
		status: string;
	}[],
	comments: { path: string; side: "old" | "new"; line: number }[],
	filePath: string,
	taken: DiffMarker[],
): DiffMarker[] {
	const target = normalizeAnchorPath(filePath);
	const used = new Set(taken.map((m) => `${m.side}:${m.line}`));
	const out: DiffMarker[] = [];
	const add = (marker: DiffMarker) => {
		const key = `${marker.side}:${marker.line}`;
		if (used.has(key)) {
			const existing = out.find((m) => `${m.side}:${m.line}` === key);
			if (existing && existing.kind === marker.kind) existing.count += 1;
			return;
		}
		used.add(key);
		out.push(marker);
	};
	for (const comment of comments) {
		if (normalizeAnchorPath(comment.path) !== target) continue;
		add({
			line: comment.line,
			side: comment.side,
			count: 1,
			isResolved: false,
			kind: "comment",
		});
	}
	for (const remark of remarks) {
		if (normalizeAnchorPath(remark.path) !== target) continue;
		if (remark.status === "dismissed") continue;
		add({
			line: remark.line,
			side: remark.side,
			count: 1,
			isResolved: false,
			kind: remark.kind,
		});
	}
	return out;
}
