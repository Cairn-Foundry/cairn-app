// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissToast, openToast, pushToast, toasts } from "./toasts";

beforeEach(() => {
	vi.useFakeTimers();
	for (const t of get(toasts)) dismissToast(t.id);
});

afterEach(() => {
	vi.useRealTimers();
});

describe("toasts", () => {
	it("shows the newest first", () => {
		pushToast({ id: "a", kicker: "k", title: "A" });
		pushToast({ id: "b", kicker: "k", title: "B" });
		expect(get(toasts).map((t) => t.id)).toEqual(["b", "a"]);
	});

	it("replaces a toast pushed again under the same id", () => {
		pushToast({ id: "a", kicker: "k", title: "A" });
		pushToast({ id: "b", kicker: "k", title: "B" });
		pushToast({ id: "a", kicker: "k", title: "A again" });
		expect(get(toasts).map((t) => t.title)).toEqual(["A again", "B"]);
	});

	it("goes away on its own only when it has a timeout", () => {
		pushToast({ id: "a", kicker: "k", title: "A", timeoutMs: 8000 });
		pushToast({ id: "b", kicker: "k", title: "B" });
		vi.advanceTimersByTime(8000);
		expect(get(toasts).map((t) => t.id)).toEqual(["b"]);
	});

	it("restarts the timer when pushed again, and drops it when it no longer has one", () => {
		pushToast({ id: "a", kicker: "k", title: "A", timeoutMs: 8000 });
		vi.advanceTimersByTime(6000);
		pushToast({ id: "a", kicker: "k", title: "A", timeoutMs: 8000 });
		vi.advanceTimersByTime(6000);
		expect(get(toasts)).toHaveLength(1);

		pushToast({ id: "a", kicker: "k", title: "A" });
		vi.advanceTimersByTime(60_000);
		expect(get(toasts)).toHaveLength(1);
	});

	it("runs its action and goes away when opened", () => {
		const onOpen = vi.fn();
		pushToast({ id: "a", kicker: "k", title: "A", onOpen });
		openToast(get(toasts)[0]);
		expect(onOpen).toHaveBeenCalledOnce();
		expect(get(toasts)).toEqual([]);
	});
});
