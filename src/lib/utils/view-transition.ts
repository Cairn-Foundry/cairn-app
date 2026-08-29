/**
 * Runs `update` inside a view transition when the engine has one: the browser
 * cross-fades the old frame into the new one on the GPU, which also hides any
 * intermediate frame the switch still goes through. Elsewhere - and whenever
 * the user asked for reduced motion - the update runs as it always did.
 */
type WithViewTransition = Document & {
	startViewTransition?: (update: () => void) => unknown;
};

export function withViewTransition(update: () => void): void {
	const doc = document as WithViewTransition;
	const reduced = window.matchMedia?.(
		"(prefers-reduced-motion: reduce)",
	)?.matches;
	if (!doc.startViewTransition || reduced) {
		update();
		return;
	}
	doc.startViewTransition(update);
}
