import type { Action } from "svelte/action";

/** Extra selector(s) whose clicks must not count as "outside", beyond `node` itself. */
export interface ClickOutsideOptions {
	callback: () => void;
	exclude?: string;
}

/**
 * Svelte action: invoke `callback` when a pointerdown happens outside `node`
 * and outside any element matching `exclude` (typically the button that
 * toggles the panel `node` wraps, when that button lives elsewhere in the DOM).
 * Listener is registered in capture phase so it runs even if inner handlers stop propagation.
 */
export const clickOutside: Action<
	HTMLElement,
	(() => void) | ClickOutsideOptions
> = (node, callback) => {
	let opts = normalize(callback);
	const armedAt = performance.now();
	const handler = (e: PointerEvent) => {
		if (e.timeStamp <= armedAt) return;
		const target = e.target as Element | null;
		if (node.contains(target)) return;
		if (opts.exclude && target?.closest(opts.exclude)) return;
		opts.callback();
	};
	document.addEventListener("pointerdown", handler, true);
	return {
		update(newCallback: (() => void) | ClickOutsideOptions) {
			opts = normalize(newCallback);
		},
		destroy() {
			document.removeEventListener("pointerdown", handler, true);
		},
	};
};

function normalize(
	callback: (() => void) | ClickOutsideOptions,
): ClickOutsideOptions {
	return typeof callback === "function" ? { callback } : callback;
}
