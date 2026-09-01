// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Runs `update` inside a view transition when the engine has one: the browser
 * cross-fades the old frame into the new one on the GPU, which also hides any
 * intermediate frame the switch still goes through. Elsewhere - and whenever
 * the user asked for reduced motion - the update runs as it always did.
 */
type ViewTransition = { finished?: Promise<unknown> };

type WithViewTransition = Document & {
	startViewTransition?: (update: () => void) => ViewTransition;
};

function startTransition(update: () => void): ViewTransition | null {
	const doc = document as WithViewTransition;
	const reduced = window.matchMedia?.(
		"(prefers-reduced-motion: reduce)",
	)?.matches;
	if (!doc.startViewTransition || reduced) {
		update();
		return null;
	}
	return doc.startViewTransition(update);
}

export function withViewTransition(update: () => void): void {
	startTransition(update);
}

/**
 * The visual change goes in `update`, the work it leads to in `then`. A view
 * transition holds the captured frame until the DOM settles, so anything heavy
 * started from `update` is paid for as a frozen screen rather than as a load
 * behind a cross-fade. Running it once the transition has finished bounds the
 * freeze to the animation itself.
 *
 * Without a view transition there is no frame to protect, so `then` runs on the
 * next task - late enough for the update to have been applied, early enough not
 * to be perceptible.
 */
export function withViewTransitionThen(
	update: () => void,
	then: () => void,
): void {
	const transition = startTransition(update);
	const finished = transition?.finished;
	if (!finished) {
		setTimeout(then, 0);
		return;
	}
	finished.then(then, then);
}
