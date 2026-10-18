// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from "vitest";
import { setWindowDecorations } from "./window-decorations";

const win = vi.hoisted(() => ({
	decorated: true,
	maximized: false,
	calls: [] as string[],
	setDecorations: vi.fn(),
	getCurrentWindow: vi.fn(),
}));
vi.mock("@tauri-apps/api/window", () => ({
	getCurrentWindow: win.getCurrentWindow,
}));

beforeEach(() => {
	win.decorated = true;
	win.maximized = false;
	win.calls = [];
	win.setDecorations.mockReset().mockImplementation(async (value: boolean) => {
		win.calls.push(`setDecorations(${value})`);
		await Promise.resolve();
		win.decorated = value;
	});
	win.getCurrentWindow.mockReset().mockReturnValue({
		isDecorated: async () => win.decorated,
		isMaximized: async () => win.maximized,
		hide: async () => win.calls.push("hide"),
		show: async () => win.calls.push("show"),
		maximize: async () => win.calls.push("maximize"),
		setDecorations: win.setDecorations,
	});
});

describe("setWindowDecorations", () => {
	it("leaves a window that already matches alone", async () => {
		await setWindowDecorations(true);
		expect(win.calls).toEqual([]);
	});

	it("switches a hidden window, then shows it again", async () => {
		await setWindowDecorations(false);
		expect(win.calls).toEqual(["hide", "setDecorations(false)", "show"]);
		expect(win.decorated).toBe(false);
	});

	it("maximizes the window again when it was maximized", async () => {
		win.maximized = true;
		await setWindowDecorations(false);
		expect(win.calls).toEqual([
			"hide",
			"setDecorations(false)",
			"show",
			"maximize",
		]);
	});

	it("shows the window again when the switch fails", async () => {
		win.setDecorations.mockRejectedValue(new Error("refused"));
		await expect(setWindowDecorations(false)).resolves.toBeUndefined();
		expect(win.calls).toEqual(["hide", "show"]);
	});

	it("runs two quick switches one after the other, ending on the last", async () => {
		const first = setWindowDecorations(false);
		const second = setWindowDecorations(true);
		await Promise.all([first, second]);
		expect(win.calls).toEqual([
			"hide",
			"setDecorations(false)",
			"show",
			"hide",
			"setDecorations(true)",
			"show",
		]);
		expect(win.decorated).toBe(true);
	});
});
