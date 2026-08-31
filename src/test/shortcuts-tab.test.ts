// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ShortcutBinding } from "$lib/types/shortcuts";

vi.mock("$lib/services/settings-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	updateSettings: vi.fn(async (next: unknown) => next),
}));

const { settings } = await import("$lib/stores/settings");
const { SHORTCUT_DEFS } = await import("$lib/stores/shortcuts");
const { default: ShortcutsTab } = await import(
	"$lib/components/home/settings/ShortcutsTab.svelte"
);

const binding = (key: string): ShortcutBinding => ({
	key,
	mod: true,
	shift: false,
	alt: false,
	ctrl: false,
});

const rows = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".sc-row"));
const rowFor = (id: string) => {
	const def = SHORTCUT_DEFS.find((d) => d.id === id);
	return rows().find((r) =>
		r
			.querySelector(".settings-row-label")
			?.textContent?.trim()
			.startsWith(def?.label ?? " "),
	) as HTMLElement;
};
const conflicts = () =>
	rows().filter((r) => r.classList.contains("sc-conflict"));
const notice = () => document.querySelector(".sc-conflict-notice")?.textContent;
const search = () =>
	document.querySelector(".sc-search-input") as HTMLInputElement;
const toggleIn = (row: HTMLElement) =>
	row.querySelector('input[type="checkbox"]') as HTMLInputElement;
const stored = () => {
	let value: { id: string; binding: unknown; enabled: boolean }[] = [];
	settings.subscribe((s) => {
		value = s.shortcuts as never;
	})();
	return value;
};

/** Two shortcuts that ship with a binding, used to build conflicts. */
const BOUND = SHORTCUT_DEFS.filter((d) => d.default !== null);

beforeEach(async () => {
	await settings.save({ shortcuts: [] });
});

describe("ShortcutsTab", () => {
	describe("the list", () => {
		it("lists every shortcut the app declares", () => {
			render(ShortcutsTab, {});
			expect(rows()).toHaveLength(SHORTCUT_DEFS.length);
		});

		it("shows the keys of a bound shortcut", () => {
			render(ShortcutsTab, {});
			const bound = rows().filter(
				(r) => r.querySelectorAll(".sc-kbd").length > 0,
			);
			expect(bound.length).toBeGreaterThan(5);
		});

		it("narrows the list to what was searched", async () => {
			render(ShortcutsTab, {});
			const before = rows().length;
			await userEvent.type(search(), SHORTCUT_DEFS[0].label.slice(0, 5));
			expect(rows().length).toBeLessThan(before);
		});
	});

	describe("conflicts", () => {
		/** Two commands on one key means neither is predictable, so both are flagged. */
		it("flags both shortcuts sharing a binding", async () => {
			await settings.save({
				shortcuts: [
					{ id: BOUND[0].id, binding: binding("j"), enabled: true },
					{ id: BOUND[1].id, binding: binding("j"), enabled: true },
				] as never,
			});
			render(ShortcutsTab, {});
			expect(conflicts().length).toBeGreaterThanOrEqual(2);
			expect(notice()).toMatch(/\d/);
		});

		it("flags nothing when every binding is distinct", () => {
			render(ShortcutsTab, {});
			expect(conflicts()).toHaveLength(0);
			expect(notice()).toBeUndefined();
		});

		/** A shortcut switched off holds no key, so it conflicts with nothing. */
		it("does not flag a shortcut that is switched off", async () => {
			await settings.save({
				shortcuts: [
					{ id: BOUND[0].id, binding: binding("j"), enabled: true },
					{ id: BOUND[1].id, binding: binding("j"), enabled: false },
				] as never,
			});
			render(ShortcutsTab, {});
			expect(rowFor(BOUND[1].id).classList.contains("sc-conflict")).toBe(false);
		});
	});

	describe("switching a shortcut off", () => {
		it("stores the shortcut as disabled", async () => {
			render(ShortcutsTab, {});
			const def = SHORTCUT_DEFS[0];
			await userEvent.click(toggleIn(rowFor(def.id)));
			await tick();
			expect(stored().find((c) => c.id === def.id)?.enabled).toBe(false);
		});

		it("marks the row as switched off", async () => {
			const def = SHORTCUT_DEFS[0];
			await settings.save({
				shortcuts: [{ id: def.id, binding: null, enabled: false }] as never,
			});
			render(ShortcutsTab, {});
			expect(rowFor(def.id).classList.contains("sc-disabled")).toBe(true);
		});

		/** Its keys are not shown, since it answers to none. */
		it("hides the keys of a shortcut that is off", async () => {
			await settings.save({
				shortcuts: [
					{ id: BOUND[0].id, binding: binding("k"), enabled: false },
				] as never,
			});
			render(ShortcutsTab, {});
			expect(rowFor(BOUND[0].id).querySelectorAll(".sc-kbd")).toHaveLength(0);
		});

		it("switches it back on", async () => {
			const def = SHORTCUT_DEFS[0];
			await settings.save({
				shortcuts: [{ id: def.id, binding: null, enabled: false }] as never,
			});
			render(ShortcutsTab, {});
			await userEvent.click(toggleIn(rowFor(def.id)));
			await tick();
			expect(stored().find((c) => c.id === def.id)?.enabled).toBe(true);
		});
	});

	describe("putting the bindings back", () => {
		/**
		 * Resetting clears the custom keys but keeps the shortcuts the user
		 * switched off: those are a choice, not a customisation.
		 */
		it("clears the custom bindings", async () => {
			await settings.save({
				shortcuts: [
					{ id: BOUND[0].id, binding: binding("j"), enabled: true },
				] as never,
			});
			render(ShortcutsTab, {});
			await userEvent.click(
				document.querySelector(".sc-reset-all") as HTMLElement,
			);
			await tick();
			expect(stored().find((c) => c.id === BOUND[0].id)).toBeUndefined();
		});

		it("keeps the shortcuts that were switched off", async () => {
			await settings.save({
				shortcuts: [
					{ id: BOUND[0].id, binding: binding("j"), enabled: true },
					{ id: BOUND[1].id, binding: binding("k"), enabled: false },
				] as never,
			});
			render(ShortcutsTab, {});
			await userEvent.click(
				document.querySelector(".sc-reset-all") as HTMLElement,
			);
			await tick();
			const kept = stored().find((c) => c.id === BOUND[1].id);
			expect(kept?.enabled).toBe(false);
			expect(kept?.binding).toBeNull();
		});
	});

	describe("recording a new binding", () => {
		it("waits for a combination once a row is picked", async () => {
			render(ShortcutsTab, {});
			await userEvent.click(rowFor(SHORTCUT_DEFS[0].id));
			expect(document.querySelector(".sc-recording-hint")).not.toBeNull();
		});

		/** A shortcut switched off has no binding to record. */
		it("records nothing on a row that is switched off", async () => {
			const def = SHORTCUT_DEFS[0];
			await settings.save({
				shortcuts: [{ id: def.id, binding: null, enabled: false }] as never,
			});
			render(ShortcutsTab, {});
			await userEvent.click(rowFor(def.id));
			expect(document.querySelector(".sc-recording-hint")).toBeNull();
		});

		/** Toggling the row must not also start recording it. */
		it("does not start recording from the toggle", async () => {
			render(ShortcutsTab, {});
			await userEvent.click(toggleIn(rowFor(SHORTCUT_DEFS[0].id)));
			expect(document.querySelector(".sc-recording-hint")).toBeNull();
		});
	});

	/** A customised shortcut is marked so it can be told from a default one. */
	it("marks a shortcut the user changed", async () => {
		await settings.save({
			shortcuts: [
				{ id: BOUND[0].id, binding: binding("j"), enabled: true },
			] as never,
		});
		render(ShortcutsTab, {});
		expect(rowFor(BOUND[0].id).querySelector(".sc-custom-dot")).not.toBeNull();
		expect(document.querySelectorAll(".sc-custom-dot")).toHaveLength(1);
	});
});
