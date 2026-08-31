// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	MOUSE_KEY,
	type ShortcutBinding,
	type ShortcutId,
} from "$lib/types/shortcuts";
import { IS_MAC } from "$lib/utils/platform";

const getSettings = vi.hoisted(() => vi.fn());
const updateSettings = vi.hoisted(() => vi.fn());
vi.mock("$lib/services/settings-service", () => ({
	getSettings,
	updateSettings,
}));

import { settings } from "./settings";
import {
	activeShortcuts,
	bindingKey,
	bindingToLabels,
	matchesMouseShortcut,
	matchesShortcut,
	SHORTCUT_DEFS,
	SHORTCUT_GROUP_LABELS,
	shortcuts,
	toCmKey,
} from "./shortcuts";

/** A binding with every modifier off unless the test turns one on. */
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

/** A key event carrying only the modifiers a test asks for. */
const keyEvent = (init: KeyboardEventInit = {}) =>
	new KeyboardEvent("keydown", { key: "s", ...init });

/** The first command that ships with a factory binding. */
const withDefault = SHORTCUT_DEFS.find((d) => d.default !== null);

beforeEach(async () => {
	getSettings.mockReset();
	updateSettings.mockReset();
	updateSettings.mockImplementation(async (s) => s);
	getSettings.mockResolvedValue({ shortcuts: [] });
	await settings.load();
});

describe("SHORTCUT_DEFS", () => {
	it("declares every command with the fields the UI reads", () => {
		for (const def of SHORTCUT_DEFS) {
			expect(def.id, def.id).toMatch(/^[a-zA-Z0-9.-]+$/);
			expect(def.label.length, def.id).toBeGreaterThan(0);
			expect(SHORTCUT_GROUP_LABELS, def.id).toHaveProperty(def.group);
		}
	});

	it("gives every command a distinct id", () => {
		const ids = SHORTCUT_DEFS.map((d) => d.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("leaves no label on a missing i18n key", () => {
		for (const def of SHORTCUT_DEFS) {
			expect(def.label, def.id).not.toMatch(/^shortcuts\./);
		}
	});

	it("claims no keystroke for two commands at once", () => {
		const seen = new Map<string, ShortcutId>();
		for (const def of SHORTCUT_DEFS) {
			if (!def.default) continue;
			const key = bindingKey(def.default);
			const owner = seen.get(key);
			expect(owner, `${def.id} collides with ${owner}`).toBeUndefined();
			seen.set(key, def.id);
		}
	});

	it("binds every mouse command to the click key", () => {
		for (const def of SHORTCUT_DEFS.filter((d) => d.mouse && d.default)) {
			expect(def.default?.key, def.id).toBe(MOUSE_KEY);
		}
	});
});

describe("shortcuts", () => {
	it("serves the factory binding when the user changed nothing", () => {
		expect(withDefault).toBeDefined();
		if (!withDefault) return;
		expect(get(shortcuts)[withDefault.id]).toEqual(withDefault.default);
	});

	it("serves the user's override instead of the default", async () => {
		expect(withDefault).toBeDefined();
		if (!withDefault) return;
		const custom = binding({ key: "j", mod: true });
		await settings.save({
			shortcuts: [{ id: withDefault.id, binding: custom, enabled: true }],
		});
		expect(get(shortcuts)[withDefault.id]).toEqual(custom);
	});

	it("still reports the binding of a command the user disabled", async () => {
		expect(withDefault).toBeDefined();
		if (!withDefault) return;
		const custom = binding({ key: "j", mod: true });
		await settings.save({
			shortcuts: [{ id: withDefault.id, binding: custom, enabled: false }],
		});
		expect(get(shortcuts)[withDefault.id]).toEqual(custom);
	});

	it("covers every declared command", () => {
		for (const def of SHORTCUT_DEFS) {
			expect(get(shortcuts), def.id).toHaveProperty(def.id);
		}
	});

	it("hands back a copy, so editing one binding cannot rewrite the default", () => {
		expect(withDefault).toBeDefined();
		if (!withDefault) return;
		const first = get(shortcuts)[withDefault.id];
		if (first) first.key = "zzz";
		expect(withDefault.default?.key).not.toBe("zzz");
	});
});

describe("activeShortcuts", () => {
	it("serves the binding of an enabled command", async () => {
		expect(withDefault).toBeDefined();
		if (!withDefault) return;
		const custom = binding({ key: "j", mod: true });
		await settings.save({
			shortcuts: [{ id: withDefault.id, binding: custom, enabled: true }],
		});
		expect(get(activeShortcuts)[withDefault.id]).toEqual(custom);
	});

	it("maps a disabled command to nothing, so no handler fires it", async () => {
		expect(withDefault).toBeDefined();
		if (!withDefault) return;
		await settings.save({
			shortcuts: [
				{ id: withDefault.id, binding: binding({ key: "j" }), enabled: false },
			],
		});
		expect(get(activeShortcuts)[withDefault.id]).toBeNull();
	});

	it("falls back to the factory binding for an untouched command", () => {
		expect(withDefault).toBeDefined();
		if (!withDefault) return;
		expect(get(activeShortcuts)[withDefault.id]).toEqual(withDefault.default);
	});

	it("maps a command that ships unbound to nothing", () => {
		const unbound = SHORTCUT_DEFS.find((d) => d.default === null);
		if (!unbound) return;
		expect(get(activeShortcuts)[unbound.id]).toBeNull();
	});
});

describe("matchesShortcut", () => {
	const mod = IS_MAC ? { metaKey: true } : { ctrlKey: true };

	it("fires on the bound key with its modifier", () => {
		expect(matchesShortcut(keyEvent(mod), binding({ mod: true }))).toBe(true);
	});

	it("ignores another key", () => {
		expect(
			matchesShortcut(keyEvent({ ...mod, key: "x" }), binding({ mod: true })),
		).toBe(false);
	});

	it("ignores the case of the key", () => {
		expect(
			matchesShortcut(keyEvent({ ...mod, key: "S" }), binding({ mod: true })),
		).toBe(true);
	});

	it("never fires on a null binding", () => {
		expect(matchesShortcut(keyEvent(mod), null)).toBe(false);
	});

	it("refuses the key without its modifier", () => {
		expect(matchesShortcut(keyEvent(), binding({ mod: true }))).toBe(false);
	});

	it("refuses an extra shift the binding does not ask for", () => {
		expect(
			matchesShortcut(
				keyEvent({ ...mod, shiftKey: true }),
				binding({ mod: true }),
			),
		).toBe(false);
	});

	it("refuses an extra alt the binding does not ask for", () => {
		expect(
			matchesShortcut(
				keyEvent({ ...mod, altKey: true }),
				binding({ mod: true }),
			),
		).toBe(false);
	});

	it("requires the shift a binding does ask for", () => {
		const b = binding({ mod: true, shift: true });
		expect(matchesShortcut(keyEvent({ ...mod, shiftKey: true }), b)).toBe(true);
		expect(matchesShortcut(keyEvent(mod), b)).toBe(false);
	});

	it("fires a binding with no modifier at all", () => {
		expect(matchesShortcut(keyEvent(), binding())).toBe(true);
	});

	it("treats mod and ctrl as one physical key off macOS", () => {
		if (IS_MAC) return;
		expect(
			matchesShortcut(keyEvent({ ctrlKey: true }), binding({ ctrl: true })),
		).toBe(true);
		expect(
			matchesShortcut(keyEvent({ ctrlKey: true }), binding({ mod: true })),
		).toBe(true);
	});

	it("keeps command and control apart on macOS", () => {
		if (!IS_MAC) return;
		expect(
			matchesShortcut(keyEvent({ ctrlKey: true }), binding({ mod: true })),
		).toBe(false);
		expect(
			matchesShortcut(keyEvent({ metaKey: true }), binding({ ctrl: true })),
		).toBe(false);
	});

	it("matches a named key like Escape", () => {
		expect(
			matchesShortcut(keyEvent({ key: "Escape" }), binding({ key: "Escape" })),
		).toBe(true);
	});
});

describe("matchesMouseShortcut", () => {
	const mod = IS_MAC ? { metaKey: true } : { ctrlKey: true };
	const state = (init: Partial<Record<string, boolean>> = {}) => ({
		metaKey: false,
		ctrlKey: false,
		shiftKey: false,
		altKey: false,
		...init,
	});

	it("fires on a modified click", () => {
		expect(
			matchesMouseShortcut(state(mod), binding({ key: MOUSE_KEY, mod: true })),
		).toBe(true);
	});

	it("refuses a binding that is not a click", () => {
		expect(matchesMouseShortcut(state(mod), binding({ mod: true }))).toBe(
			false,
		);
	});

	it("refuses a bare click, so a click stays a click", () => {
		expect(matchesMouseShortcut(state(), binding({ key: MOUSE_KEY }))).toBe(
			false,
		);
	});

	it("never fires on a null binding", () => {
		expect(matchesMouseShortcut(state(mod), null)).toBe(false);
	});

	it("requires the exact modifiers", () => {
		const b = binding({ key: MOUSE_KEY, mod: true });
		expect(matchesMouseShortcut(state({ ...mod, shiftKey: true }), b)).toBe(
			false,
		);
	});

	it("fires on a shift click when that is the binding", () => {
		expect(
			matchesMouseShortcut(
				state({ shiftKey: true }),
				binding({ key: MOUSE_KEY, shift: true }),
			),
		).toBe(true);
	});
});

describe("toCmKey", () => {
	it("renders a plain key", () => {
		expect(toCmKey(binding({ key: "s" }))).toBe("s");
	});

	it("renders the modifiers in CodeMirror order", () => {
		expect(
			toCmKey(
				binding({ key: "s", mod: true, ctrl: true, shift: true, alt: true }),
			),
		).toBe("Mod-Ctrl-Shift-Alt-s");
	});

	it("renders mod alone as Mod", () => {
		expect(toCmKey(binding({ key: "s", mod: true }))).toBe("Mod-s");
	});

	it("keeps a named key as CodeMirror spells it", () => {
		expect(toCmKey(binding({ key: "Escape" }))).toBe("Escape");
	});
});

describe("bindingToLabels", () => {
	it("shows nothing for an unbound command", () => {
		expect(bindingToLabels(null)).toEqual([]);
	});

	it("prints the command glyph on macOS and Ctrl elsewhere", () => {
		expect(bindingToLabels(binding({ mod: true }), true)[0]).toBe("⌘");
		expect(bindingToLabels(binding({ mod: true }), false)[0]).toBe("Ctrl");
	});

	it("prints alt as its glyph on macOS", () => {
		expect(bindingToLabels(binding({ alt: true }), true)).toEqual(["⌥", "S"]);
		expect(bindingToLabels(binding({ alt: true }), false)).toEqual([
			"Alt",
			"S",
		]);
	});

	it("shows ctrl only when it is not already implied by mod", () => {
		expect(bindingToLabels(binding({ mod: true, ctrl: true }), true)).toEqual([
			"⌘",
			"S",
		]);
		expect(bindingToLabels(binding({ ctrl: true }), true)).toEqual([
			"Ctrl",
			"S",
		]);
	});

	it("uppercases a letter key", () => {
		expect(bindingToLabels(binding({ key: "j" }), true)).toEqual(["J"]);
	});

	it("uses the glyph of a key whose name is not its symbol", () => {
		expect(bindingToLabels(binding({ key: "ArrowUp" }), true)).toEqual(["↑"]);
		expect(bindingToLabels(binding({ key: "Escape" }), true)).toEqual(["Esc"]);
		expect(bindingToLabels(binding({ key: " " }), true)).toEqual(["Space"]);
	});

	it("names a click binding", () => {
		expect(bindingToLabels(binding({ key: MOUSE_KEY }), true)).toEqual([
			"Click",
		]);
	});

	it("orders the chips modifier first, key last", () => {
		expect(
			bindingToLabels(binding({ key: "s", mod: true, shift: true }), true),
		).toEqual(["⌘", "⇧", "S"]);
	});
});

describe("bindingKey", () => {
	it("gives two identical bindings the same key", () => {
		expect(bindingKey(binding({ key: "s", mod: true }))).toBe(
			bindingKey(binding({ key: "s", mod: true })),
		);
	});

	it("ignores the case of the key, since matching does too", () => {
		expect(bindingKey(binding({ key: "S" }))).toBe(
			bindingKey(binding({ key: "s" })),
		);
	});

	it("separates bindings that differ by a modifier", () => {
		expect(bindingKey(binding({ mod: true }))).not.toBe(
			bindingKey(binding({ ctrl: true })),
		);
		expect(bindingKey(binding({ shift: true }))).not.toBe(
			bindingKey(binding()),
		);
	});

	it("separates bindings that differ by their key", () => {
		expect(bindingKey(binding({ key: "a" }))).not.toBe(
			bindingKey(binding({ key: "b" })),
		);
	});
});
