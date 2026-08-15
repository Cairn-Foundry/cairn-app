// Reordering editor tabs by drag, shared with the vertical lists that reuse the
// same gesture. Pinned tabs are held at the front of the bar.

/** Which elements make up the bar, and whether it runs across or down. */
export interface InsertIndexOptions {
	selector?: string;
	axis?: "x" | "y";
}

/** The slot the pointer is over: past an item's midpoint means after it. */
export function computeTabInsertIndex(
	barEl: HTMLElement | null,
	pointerCoord: number,
	opts: InsertIndexOptions = {},
): number {
	const selector = opts.selector ?? ".file-tab";
	const axis = opts.axis ?? "x";
	const itemEls = barEl?.querySelectorAll<HTMLElement>(selector);
	if (!itemEls || itemEls.length === 0) return 0;
	for (let i = 0; i < itemEls.length; i++) {
		const rect = itemEls[i].getBoundingClientRect();
		const start = axis === "x" ? rect.left : rect.top;
		const size = axis === "x" ? rect.width : rect.height;
		if (pointerCoord < start + size / 2) return i;
	}
	return itemEls.length;
}

/** Pinned tabs first, each group keeping its relative order. */
export function sortedByPin<T extends { pinned?: boolean }>(arr: T[]): T[] {
	return [...arr.filter((t) => t.pinned), ...arr.filter((t) => !t.pinned)];
}

/**
 * Moves a tab and re-derives its pinned flag from where it landed, so dragging
 * into or out of the pinned run is what pins and unpins. The active tab is
 * tracked by path, since its index moves with the reorder.
 */
export function applyTabReorder<T extends { path: string; pinned?: boolean }>(
	tabs: T[],
	activeIdx: number,
	dragSrc: number,
	insertAt: number,
): { tabs: T[]; activeIdx: number } {
	const isNoop = insertAt === dragSrc || insertAt === dragSrc + 1;
	if (isNoop) return { tabs, activeIdx };
	const newTabs = [...tabs];
	const [moved] = newTabs.splice(dragSrc, 1);
	const adjustedInsert = insertAt > dragSrc ? insertAt - 1 : insertAt;
	newTabs.splice(adjustedInsert, 0, moved);
	const otherPinnedCount = newTabs.filter(
		(_, i) => i !== adjustedInsert && newTabs[i].pinned,
	).length;
	moved.pinned = adjustedInsert < otherPinnedCount;
	const activePath = tabs[activeIdx]?.path;
	const sorted = sortedByPin(newTabs);
	const newActive = activePath
		? sorted.findIndex((t) => t.path === activePath)
		: -1;
	return { tabs: sorted, activeIdx: newActive };
}
