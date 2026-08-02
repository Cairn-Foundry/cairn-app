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

export interface DropPoint {
	x: number;
	y: number;
}

/**
 * Where an OS drag-drop payload lands, in CSS pixels. Tauri types the position
 * as physical, but WebKit already reports logical points: dividing those by the
 * device ratio again lands the drop half a window up and to the left, which
 * reads as "the file tree ignores the drag". A point that fits in the viewport
 * is therefore taken as logical, and only a larger one is scaled down.
 */
export function osDropPoint(
	position: DropPoint,
	viewport: { width: number; height: number },
	ratio: number,
): DropPoint {
	if (ratio === 1) return { x: position.x, y: position.y };
	if (position.x <= viewport.width && position.y <= viewport.height) {
		return { x: position.x, y: position.y };
	}
	return { x: position.x / ratio, y: position.y / ratio };
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
