// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Action } from "svelte/action";

function scrollParentOf(node: HTMLElement): HTMLElement | null {
	for (let el = node.parentElement; el; el = el.parentElement) {
		const { overflowY } = getComputedStyle(el);
		if (overflowY === "auto" || overflowY === "scroll") return el;
	}
	return null;
}

/**
 * Svelte action: caps `node` to the part of its scroll container still visible
 * below its top edge, so a sticky column beside a long page never runs past the
 * bottom of the window. The cap follows the column as the page scrolls: it
 * grows while the column rises towards its sticky position.
 */
export const fitToScrollport: Action<HTMLElement> = (node) => {
	const scroller = scrollParentOf(node);
	if (!scroller) return {};

	let frame = 0;
	const fit = () => {
		frame = 0;
		const bottom =
			scroller.getBoundingClientRect().bottom -
			Number.parseFloat(getComputedStyle(scroller).paddingBottom || "0");
		const height = Math.floor(bottom - node.getBoundingClientRect().top);
		node.style.maxHeight = height > 0 ? `${height}px` : "";
	};
	const schedule = () => {
		if (!frame) frame = requestAnimationFrame(fit);
	};

	fit();
	scroller.addEventListener("scroll", schedule, { passive: true });
	const observer = new ResizeObserver(schedule);
	observer.observe(scroller);

	return {
		destroy() {
			if (frame) cancelAnimationFrame(frame);
			scroller.removeEventListener("scroll", schedule);
			observer.disconnect();
			node.style.maxHeight = "";
		},
	};
};
