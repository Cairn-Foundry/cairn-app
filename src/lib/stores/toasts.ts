// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Short notices shown over the whole app, on Home as in the Workspace.
 *
 * A toast is keyed by its id: pushing an id already shown replaces it in place
 * and restarts its timer, so whoever pushes can update one notice instead of
 * stacking copies of it.
 */
import { writable } from "svelte/store";

export type ToastTone = "accent" | "warning" | "success";

export interface Toast {
	id: string;
	/** The short line above the title, saying what happened. */
	kicker: string;
	title: string;
	body?: string;
	tone?: ToastTone;
	/** Gone on its own after this long; without it, it stays until dismissed. */
	timeoutMs?: number;
	/** What a click on the toast does; it is dismissed right after. */
	onOpen?: () => void;
}

/** Newest first. */
export const toasts = writable<Toast[]>([]);

const timers = new Map<string, ReturnType<typeof setTimeout>>();

function clearTimer(id: string): void {
	const timer = timers.get(id);
	if (timer) clearTimeout(timer);
	timers.delete(id);
}

export function pushToast(toast: Toast): void {
	clearTimer(toast.id);
	toasts.update((list) => [toast, ...list.filter((t) => t.id !== toast.id)]);
	if (toast.timeoutMs) {
		timers.set(
			toast.id,
			setTimeout(() => dismissToast(toast.id), toast.timeoutMs),
		);
	}
}

export function dismissToast(id: string): void {
	clearTimer(id);
	toasts.update((list) =>
		list.some((t) => t.id === id) ? list.filter((t) => t.id !== id) : list,
	);
}

export function openToast(toast: Toast): void {
	dismissToast(toast.id);
	toast.onOpen?.();
}
