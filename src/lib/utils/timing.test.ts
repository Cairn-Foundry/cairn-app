// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import {
	CLIPBOARD_CLEAR_DELAY,
	EDITOR_JUMP_READY_TIMEOUT_MS,
	EDITOR_JUMP_RETRY_MS,
	GIT_REFRESH_IDLE_INTERVAL_MS,
	GIT_REFRESH_INTERVAL_MS,
	LSP_CHANGE_DEBOUNCE_MS,
	SEARCH_DEBOUNCE_MS,
} from "./timing";

const ALL = {
	CLIPBOARD_CLEAR_DELAY,
	SEARCH_DEBOUNCE_MS,
	EDITOR_JUMP_RETRY_MS,
	EDITOR_JUMP_READY_TIMEOUT_MS,
	LSP_CHANGE_DEBOUNCE_MS,
	GIT_REFRESH_INTERVAL_MS,
	GIT_REFRESH_IDLE_INTERVAL_MS,
};

describe("timing", () => {
	it("states every delay as a positive whole number of milliseconds", () => {
		for (const [name, value] of Object.entries(ALL)) {
			expect(Number.isInteger(value), name).toBe(true);
			expect(value, name).toBeGreaterThan(0);
		}
	});

	it("refreshes git more slowly while the view is closed", () => {
		expect(GIT_REFRESH_IDLE_INTERVAL_MS).toBeGreaterThan(
			GIT_REFRESH_INTERVAL_MS,
		);
	});

	it("keeps the interactive delays short enough to feel immediate", () => {
		for (const value of [
			SEARCH_DEBOUNCE_MS,
			EDITOR_JUMP_RETRY_MS,
			LSP_CHANGE_DEBOUNCE_MS,
		]) {
			expect(value).toBeLessThan(1000);
		}
	});

	it("retries a jump often enough to catch a slow read, within a bounded wait", () => {
		expect(EDITOR_JUMP_RETRY_MS).toBeLessThan(100);
		expect(EDITOR_JUMP_READY_TIMEOUT_MS).toBeGreaterThanOrEqual(1000);
	});

	it("holds a copied confirmation long enough to be read", () => {
		expect(CLIPBOARD_CLEAR_DELAY).toBeGreaterThanOrEqual(1000);
	});

	it("debounces language server changes past a typing burst but under a second", () => {
		expect(LSP_CHANGE_DEBOUNCE_MS).toBeGreaterThanOrEqual(100);
		expect(LSP_CHANGE_DEBOUNCE_MS).toBeLessThanOrEqual(500);
	});
});
