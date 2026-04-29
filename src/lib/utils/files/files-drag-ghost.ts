let dragGhostEl: HTMLDivElement | null = null;

export function createDragGhost(label: string): void {
	removeDragGhost();
	const el = document.createElement("div");
	el.className = "drag-ghost";
	el.textContent = label;
	el.style.cssText =
		"position:fixed;z-index:9999;pointer-events:none;background:var(--bg-4);color:var(--fg-0);border:1px solid var(--accent);border-radius:4px;padding:3px 8px;font-size:12px;white-space:nowrap;opacity:0.9;";
	document.body.appendChild(el);
	dragGhostEl = el;
}

export function moveGhost(x: number, y: number): void {
	if (!dragGhostEl) return;
	dragGhostEl.style.left = `${x + 12}px`;
	dragGhostEl.style.top = `${y + 12}px`;
}

export function removeDragGhost(): void {
	dragGhostEl?.remove();
	dragGhostEl = null;
}

export function findDropTargetDir(x: number, y: number): string | null {
	const el = document.elementFromPoint(x, y);
	if (!el) return null;
	const btn = (el as HTMLElement).closest(
		"[data-tree-dir]",
	) as HTMLElement | null;
	if (!btn) return null;
	return btn.getAttribute("data-tree-dir") ?? null;
}
