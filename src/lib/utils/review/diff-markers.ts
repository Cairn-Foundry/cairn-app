import type { Discussion } from "$lib/types/integrations";

export interface DiffMarker {
	line: number;
	side: "old" | "new";
	count: number;
	isResolved: boolean;
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
