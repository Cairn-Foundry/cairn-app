// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Three queues drained once per tick through a MessageChannel (setTimeout is
 * clamped to 4 ms and coalesced). `input` and `visible` always run; `background`
 * only while the tick still has budget, so a tree index or a persistence write
 * never lands in the frame the user is typing in.
 * ponytail: budget is measured from the tick, not from the frame start; a rAF-anchored budget if profiling shows background work still stealing paint time
 * ponytail: yielding restarts the drain, which re-reads `start`, so each task
 * gets a fresh BUDGET_MS instead of sharing one tick's worth; carry the
 * deadline across drains if background work ever needs a real cap
 */
type Queue = "input" | "visible" | "background";

const BUDGET_MS = 5;
const queues: Record<Queue, (() => void)[]> = {
	input: [],
	visible: [],
	background: [],
};
let scheduled = false;
const channel =
	typeof MessageChannel === "undefined" ? null : new MessageChannel();

function pump(): void {
	if (scheduled) return;
	scheduled = true;
	if (channel) channel.port2.postMessage(null);
	else setTimeout(drain, 0);
}

function drain(): void {
	scheduled = false;
	const start = performance.now();
	for (const name of ["input", "visible"] as const) {
		const queue = queues[name];
		while (queue.length) queue.shift()?.();
	}
	const background = queues.background;
	while (background.length) {
		if (performance.now() - start > BUDGET_MS) {
			pump();
			return;
		}
		background.shift()?.();
	}
}

if (channel) channel.port1.onmessage = drain;

/** Runs `task` on the next tick of its queue. */
export function schedule(queue: Queue, task: () => void): void {
	queues[queue].push(task);
	pump();
}

/**
 * Coalesces a keyed task: scheduling the same key again before it ran replaces
 * the pending one, so a burst of updates costs one run.
 */
const keyed = new Map<string, () => void>();
export function scheduleKeyed(
	queue: Queue,
	key: string,
	task: () => void,
): void {
	const first = !keyed.has(key);
	keyed.set(key, task);
	if (!first) return;
	schedule(queue, () => {
		const latest = keyed.get(key);
		keyed.delete(key);
		latest?.();
	});
}
