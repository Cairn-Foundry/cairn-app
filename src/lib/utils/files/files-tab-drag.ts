export interface InsertIndexOptions {
  selector?: string;
  axis?: 'x' | 'y';
}

export function computeTabInsertIndex(
  barEl: HTMLElement | null,
  pointerCoord: number,
  opts: InsertIndexOptions = {},
): number {
  const selector = opts.selector ?? '.file-tab';
  const axis = opts.axis ?? 'x';
  const itemEls = barEl?.querySelectorAll<HTMLElement>(selector);
  if (!itemEls || itemEls.length === 0) return 0;
  for (let i = 0; i < itemEls.length; i++) {
    const rect = itemEls[i].getBoundingClientRect();
    const start = axis === 'x' ? rect.left : rect.top;
    const size = axis === 'x' ? rect.width : rect.height;
    if (pointerCoord < start + size / 2) return i;
  }
  return itemEls.length;
}

export function sortedByPin<T extends { pinned?: boolean }>(arr: T[]): T[] {
  return [...arr.filter(t => t.pinned), ...arr.filter(t => !t.pinned)];
}

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
  const otherPinnedCount = newTabs.filter((_, i) => i !== adjustedInsert && newTabs[i].pinned).length;
  moved.pinned = adjustedInsert < otherPinnedCount;
  const activePath = tabs[activeIdx]?.path;
  const sorted = sortedByPin(newTabs);
  const newActive = activePath ? sorted.findIndex(t => t.path === activePath) : -1;
  return { tabs: sorted, activeIdx: newActive };
}
