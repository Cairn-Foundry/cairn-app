export interface PaneBox {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

export interface PaneDrop {
	pane: 0 | 1;
	/** The drop lands on the right edge of a single pane and must open the split. */
	openSplit: boolean;
}

/** Share of a pane's width that opens the split instead of reusing the pane. */
const EDGE_RATIO = 0.28;
const EDGE_MAX = 220;

function contains(box: PaneBox, x: number, y: number): boolean {
	return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
}

/**
 * Which editor pane a pointer at (x, y) drops into. Without a split, the right
 * edge of the only pane opens one rather than replacing what is on screen.
 */
export function resolvePaneDrop(
	boxes: (PaneBox | null)[],
	splitMode: boolean,
	x: number,
	y: number,
): PaneDrop | null {
	const first = boxes[0];
	if (!splitMode) {
		if (!first || !contains(first, x, y)) return null;
		const edge = Math.min((first.right - first.left) * EDGE_RATIO, EDGE_MAX);
		const openSplit = x >= first.right - edge;
		return { pane: openSplit ? 1 : 0, openSplit };
	}

	if (first && contains(first, x, y)) return { pane: 0, openSplit: false };
	const second = boxes[1];
	if (second && contains(second, x, y)) return { pane: 1, openSplit: false };
	return null;
}

/**
 * Turns an absolute path dropped from the OS into a worktree-relative one.
 * Returns null when the file lives outside the worktree - the editor keys its
 * tabs by relative path and cannot hold it.
 */
export function toWorktreeRelative(
	absolutePath: string,
	worktreePath: string | null,
): string | null {
	if (!worktreePath) return null;
	const root = worktreePath.endsWith("/") ? worktreePath : `${worktreePath}/`;
	if (!absolutePath.startsWith(root)) return null;
	const relative = absolutePath.slice(root.length);
	return relative.length > 0 ? relative : null;
}
