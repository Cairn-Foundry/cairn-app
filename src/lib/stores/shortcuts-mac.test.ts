// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from "vitest";
import { MOUSE_KEY, type ShortcutBinding } from "#lib/types/shortcuts";

vi.mock("#lib/utils/platform", async (original) => ({
	...(await original<Record<string, unknown>>()),
	IS_MAC: true,
}));

import {
	bindingToLabels,
	matchesMouseShortcut,
	matchesShortcut,
	SHORTCUT_DEFS,
} from "./shortcuts";

const binding = (
	overrides: Partial<ShortcutBinding> = {},
): ShortcutBinding => ({
	key: "s",
	mod: false,
	shift: false,
	alt: false,
	ctrl: false,
	...overrides,
});

const keyEvent = (init: KeyboardEventInit = {}) =>
	new KeyboardEvent("keydown", { key: "s", ...init });

const state = (init: Partial<Record<string, boolean>> = {}) => ({
	metaKey: false,
	ctrlKey: false,
	shiftKey: false,
	altKey: false,
	...init,
});

describe("on macOS", () => {
	it("ships fullscreen on command-control-F", () => {
		const def = SHORTCUT_DEFS.find((d) => d.id === "toggleFullscreen");
		expect(def?.default).toEqual({
			key: "f",
			mod: true,
			shift: false,
			alt: false,
			ctrl: true,
		});
	});

	it("labels the modifiers with their glyphs by default", () => {
		expect(
			bindingToLabels(binding({ mod: true, shift: true, alt: true })),
		).toEqual(["⌘", "⇧", "⌥", "S"]);
	});
});

describe("matchesShortcut on macOS", () => {
	it("fires a mod binding on command", () => {
		expect(
			matchesShortcut(keyEvent({ metaKey: true }), binding({ mod: true })),
		).toBe(true);
	});

	it("refuses control for a mod binding", () => {
		expect(
			matchesShortcut(keyEvent({ ctrlKey: true }), binding({ mod: true })),
		).toBe(false);
	});

	it("fires a ctrl binding on control", () => {
		expect(
			matchesShortcut(keyEvent({ ctrlKey: true }), binding({ ctrl: true })),
		).toBe(true);
	});

	it("refuses command for a ctrl binding", () => {
		expect(
			matchesShortcut(keyEvent({ metaKey: true }), binding({ ctrl: true })),
		).toBe(false);
	});

	it("requires both command and control when the binding asks for both", () => {
		const both = binding({ mod: true, ctrl: true });
		expect(
			matchesShortcut(keyEvent({ metaKey: true, ctrlKey: true }), both),
		).toBe(true);
		expect(matchesShortcut(keyEvent({ metaKey: true }), both)).toBe(false);
		expect(matchesShortcut(keyEvent({ ctrlKey: true }), both)).toBe(false);
	});

	it("refuses a modifier the binding does not ask for", () => {
		expect(matchesShortcut(keyEvent({ metaKey: true }), binding())).toBe(false);
	});
});

describe("matchesMouseShortcut on macOS", () => {
	const click = (overrides: Partial<ShortcutBinding> = {}) =>
		binding({ key: MOUSE_KEY, ...overrides });

	it("fires a mod click on command", () => {
		expect(
			matchesMouseShortcut(state({ metaKey: true }), click({ mod: true })),
		).toBe(true);
	});

	it("refuses control for a mod click", () => {
		expect(
			matchesMouseShortcut(state({ ctrlKey: true }), click({ mod: true })),
		).toBe(false);
	});

	it("fires a ctrl click on control", () => {
		expect(
			matchesMouseShortcut(state({ ctrlKey: true }), click({ ctrl: true })),
		).toBe(true);
	});

	it("refuses command for a ctrl click", () => {
		expect(
			matchesMouseShortcut(state({ metaKey: true }), click({ ctrl: true })),
		).toBe(false);
	});

	it("requires both when the binding asks for both", () => {
		const both = click({ mod: true, ctrl: true });
		expect(
			matchesMouseShortcut(state({ metaKey: true, ctrlKey: true }), both),
		).toBe(true);
		expect(matchesMouseShortcut(state({ metaKey: true }), both)).toBe(false);
	});
});
