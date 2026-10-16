// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { windowFullscreen } from "$lib/stores/ui";
import type { ShortcutBinding } from "$lib/types/shortcuts";
import { onFullscreenKey, toggleFullscreen } from "./window-fullscreen";

const win = vi.hoisted(() => ({
	fullscreen: false,
	setFullscreen: vi.fn(),
	getCurrentWindow: vi.fn(),
}));
vi.mock("@tauri-apps/api/window", () => ({
	getCurrentWindow: win.getCurrentWindow,
}));

const F11: ShortcutBinding = {
	key: "F11",
	mod: false,
	shift: false,
	alt: false,
	ctrl: false,
};

async function settle() {
	for (let i = 0; i < 20; i++) await Promise.resolve();
}

beforeEach(() => {
	win.fullscreen = false;
	windowFullscreen.set(false);
	win.setFullscreen.mockReset().mockImplementation(async (value: boolean) => {
		win.fullscreen = value;
	});
	win.getCurrentWindow.mockReset().mockReturnValue({
		isFullscreen: async () => win.fullscreen,
		setFullscreen: win.setFullscreen,
	});
});

describe("toggleFullscreen", () => {
	it("enters fullscreen and says so without waiting for a resize", async () => {
		await toggleFullscreen();
		expect(win.setFullscreen).toHaveBeenCalledWith(true);
		expect(get(windowFullscreen)).toBe(true);
	});

	it("leaves fullscreen", async () => {
		win.fullscreen = true;
		windowFullscreen.set(true);
		await toggleFullscreen();
		expect(win.setFullscreen).toHaveBeenCalledWith(false);
		expect(get(windowFullscreen)).toBe(false);
	});

	it("keeps the flag when the window refuses", async () => {
		win.setFullscreen.mockRejectedValue(new Error("refused"));
		await expect(toggleFullscreen()).resolves.toBeUndefined();
		expect(get(windowFullscreen)).toBe(false);
	});
});

describe("onFullscreenKey", () => {
	it("toggles fullscreen on the bound key and claims it", async () => {
		const event = new KeyboardEvent("keydown", {
			key: "F11",
			cancelable: true,
		});
		onFullscreenKey(event, F11);
		await settle();
		expect(event.defaultPrevented).toBe(true);
		expect(win.setFullscreen).toHaveBeenCalledWith(true);
	});

	it("lets any other key through", async () => {
		const event = new KeyboardEvent("keydown", {
			key: "F10",
			cancelable: true,
		});
		onFullscreenKey(event, F11);
		await settle();
		expect(event.defaultPrevented).toBe(false);
		expect(win.setFullscreen).not.toHaveBeenCalled();
	});

	it("does nothing when the shortcut is disabled", async () => {
		const event = new KeyboardEvent("keydown", {
			key: "F11",
			cancelable: true,
		});
		onFullscreenKey(event, null);
		await settle();
		expect(win.setFullscreen).not.toHaveBeenCalled();
	});
});
