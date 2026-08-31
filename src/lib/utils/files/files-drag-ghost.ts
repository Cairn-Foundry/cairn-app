// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// The label following the pointer during a file tree drag. Built by hand
// because the app never uses HTML5 drag and drop, which has no drag image here.

let dragGhostEl: HTMLDivElement | null = null;

/** Creates the floating label, replacing any ghost left over from before. */
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

/** Follows the pointer, offset so the label never sits under the cursor. */
export function moveGhost(x: number, y: number): void {
	if (!dragGhostEl) return;
	dragGhostEl.style.left = `${x + 12}px`;
	dragGhostEl.style.top = `${y + 12}px`;
}

/** Removes the ghost; safe to call when there is none. */
export function removeDragGhost(): void {
	dragGhostEl?.remove();
	dragGhostEl = null;
}

/**
 * The directory under the pointer: a directory row drops into itself, a file
 * row into the directory that contains it.
 */
export function findDropTargetDir(x: number, y: number): string | null {
	const el = document.elementFromPoint(x, y);
	if (!el) return null;
	const btn = (el as HTMLElement).closest(
		"[data-tree-dir], [data-tree-parent]",
	) as HTMLElement | null;
	if (!btn) return null;
	if (btn.hasAttribute("data-tree-dir"))
		return btn.getAttribute("data-tree-dir") ?? null;
	return btn.getAttribute("data-tree-parent") ?? null;
}
