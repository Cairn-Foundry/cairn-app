// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowTabConfig } from "$lib/services/settings-service";

// `settings.save` round-trips through the backend; here the write is
// acknowledged as it stands so the store keeps what the component wrote.
vi.mock("$lib/services/settings-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	updateSettings: vi.fn(async (next: unknown) => next),
}));

const readExclude = vi.fn();
const writeExclude = vi.fn();
vi.mock("$lib/stores/git", () => ({
	readExclude: (...a: unknown[]) => readExclude(...a),
	writeExclude: (...a: unknown[]) => writeExclude(...a),
}));

const activeInstanceStore = writable<unknown>(null);
vi.mock("$lib/stores/instance", () => ({
	activeInstance: { subscribe: activeInstanceStore.subscribe },
}));

const { settings } = await import("$lib/stores/settings");
const { DEFAULT_WF_TABS } = await import("$lib/utils/home/workflow-tabs");
const { instance } = await import("./fixtures");
const { default: GitignoreView } = await import(
	"$lib/components/git/GitignoreView.svelte"
);
const { default: ProjectTab } = await import(
	"$lib/components/home/settings/ProjectTab.svelte"
);

describe("ProjectTab workflow tabs", () => {
	const rows = () =>
		Array.from(document.querySelectorAll<HTMLElement>(".wf-row"));
	const labels = () =>
		rows().map((r) => r.querySelector(".settings-row-label")?.textContent);
	const toggleIn = (row: HTMLElement) =>
		row.querySelector('input[type="checkbox"]') as HTMLInputElement;
	const indicators = () => document.querySelectorAll(".wf-drop-indicator");
	const savedTabs = () => {
		let value: WorkflowTabConfig[] = [];
		settings.subscribe((s) => {
			value = s.workflowTabs ?? [];
		})();
		return value;
	};

	/** Lays the rows out vertically so the drag can pick an insert position. */
	function layOutRows() {
		const list = document.querySelector(".wf-list") as HTMLElement;
		list.getBoundingClientRect = () => ({ top: 0, bottom: 300 }) as DOMRect;
		rows().forEach((row, i) => {
			row.getBoundingClientRect = () =>
				({ top: i * 40, bottom: i * 40 + 40, height: 40 }) as DOMRect;
		});
	}

	function pointer(type: string, y: number) {
		return new PointerEvent(type, {
			bubbles: true,
			cancelable: true,
			clientY: y,
			pointerId: 1,
		});
	}

	beforeEach(async () => {
		Element.prototype.setPointerCapture = vi.fn();
		Element.prototype.releasePointerCapture = vi.fn();
		await settings.save({ workflowTabs: DEFAULT_WF_TABS });
	});

	it("lists the workflow tabs in their configured order", () => {
		render(ProjectTab, {});
		expect(rows()).toHaveLength(DEFAULT_WF_TABS.length);
		expect(labels()[0]).toBe(DEFAULT_WF_TABS[0].name);
	});

	/** The stored order wins over the order the array happens to be in. */
	it("sorts the tabs by their order, not by their position", async () => {
		await settings.save({
			workflowTabs: [
				{ ...DEFAULT_WF_TABS[0], order: 2 },
				{ ...DEFAULT_WF_TABS[1], order: 0 },
				{ ...DEFAULT_WF_TABS[2], order: 1 },
			],
		});
		render(ProjectTab, {});
		expect(labels()[0]).toBe(DEFAULT_WF_TABS[1].name);
	});

	it("hides a tab from the workspace on request", async () => {
		render(ProjectTab, {});
		await userEvent.click(toggleIn(rows()[0]));
		const stored = savedTabs().find((t) => t.key === DEFAULT_WF_TABS[0].key);
		expect(stored?.enabled).toBe(false);
	});

	it("shows it again on a second toggle", async () => {
		render(ProjectTab, {});
		await userEvent.click(toggleIn(rows()[0]));
		await tick();
		await userEvent.click(toggleIn(rows()[0]));
		const stored = savedTabs().find((t) => t.key === DEFAULT_WF_TABS[0].key);
		expect(stored?.enabled).toBe(true);
	});

	it("marks a hidden tab in the list", async () => {
		await settings.save({
			workflowTabs: DEFAULT_WF_TABS.map((t, i) =>
				i === 0 ? { ...t, enabled: false } : t,
			),
		});
		render(ProjectTab, {});
		expect(rows()[0].classList.contains("wf-disabled-row")).toBe(true);
		expect(rows()[1].classList.contains("wf-disabled-row")).toBe(false);
	});

	describe("reordering by drag", () => {
		/**
		 * Moving a row down lands it after the rows it passed, not one short:
		 * the insert index counts positions in the list before the row is taken
		 * out, so it has to be adjusted once it is. Asserted on the exact
		 * resulting order, since "the first label changed" is true either way.
		 */
		it("moves a tab down the list, past the rows it crossed", async () => {
			render(ProjectTab, {});
			layOutRows();
			const before = labels();
			const row = rows()[0];
			row.dispatchEvent(pointer("pointerdown", 10));
			layOutRows();
			row.dispatchEvent(pointer("pointermove", 110));
			row.dispatchEvent(pointer("pointerup", 110));
			await tick();
			expect(labels()).toEqual([
				before[1],
				before[2],
				before[0],
				...before.slice(3),
			]);
		});

		it("moves a tab up the list", async () => {
			render(ProjectTab, {});
			layOutRows();
			const before = labels();
			const row = rows()[2];
			row.dispatchEvent(pointer("pointerdown", 90));
			layOutRows();
			row.dispatchEvent(pointer("pointermove", 5));
			row.dispatchEvent(pointer("pointerup", 5));
			await tick();
			expect(labels()).toEqual([
				before[2],
				before[0],
				before[1],
				...before.slice(3),
			]);
		});

		/** Dropping a row just below itself is the same position, so nothing moves. */
		it("changes nothing when a tab is dropped just below itself", async () => {
			render(ProjectTab, {});
			layOutRows();
			const before = labels();
			const row = rows()[1];
			row.dispatchEvent(pointer("pointerdown", 50));
			layOutRows();
			row.dispatchEvent(pointer("pointermove", 85));
			row.dispatchEvent(pointer("pointerup", 85));
			await tick();
			expect(labels()).toEqual(before);
		});

		/** Every stored order is renumbered from the new positions. */
		it("renumbers every tab from its new position", async () => {
			render(ProjectTab, {});
			layOutRows();
			const row = rows()[0];
			row.dispatchEvent(pointer("pointerdown", 10));
			layOutRows();
			row.dispatchEvent(pointer("pointermove", 110));
			row.dispatchEvent(pointer("pointerup", 110));
			await tick();
			const orders = savedTabs()
				.slice()
				.sort((a, b) => a.order - b.order)
				.map((t) => t.order);
			expect(orders).toEqual(orders.map((_, i) => i));
		});

		/**
		 * Dropping a row back where it was changes nothing - and writes nothing:
		 * the resulting order would be identical either way, so the saved write
		 * is what distinguishes a real move from a no-op.
		 */
		it("writes nothing when a tab is dropped on itself", async () => {
			const { updateSettings } = await import("$lib/services/settings-service");
			render(ProjectTab, {});
			layOutRows();
			const before = labels();
			vi.mocked(updateSettings).mockClear();

			const row = rows()[1];
			row.dispatchEvent(pointer("pointerdown", 50));
			layOutRows();
			row.dispatchEvent(pointer("pointermove", 50));
			row.dispatchEvent(pointer("pointerup", 50));
			await tick();
			expect(labels()).toEqual(before);
			expect(updateSettings).not.toHaveBeenCalled();
		});

		it("shows where the row would land while it is dragged", async () => {
			render(ProjectTab, {});
			layOutRows();
			const row = rows()[0];
			row.dispatchEvent(pointer("pointerdown", 10));
			row.dispatchEvent(pointer("pointermove", 110));
			await tick();
			expect(indicators().length).toBeGreaterThan(0);
			expect(rows()[0].classList.contains("wf-dragging")).toBe(true);
		});

		it("clears the indicator once the row is dropped", async () => {
			render(ProjectTab, {});
			layOutRows();
			const row = rows()[0];
			row.dispatchEvent(pointer("pointerdown", 10));
			row.dispatchEvent(pointer("pointermove", 110));
			row.dispatchEvent(pointer("pointerup", 110));
			await tick();
			expect(indicators()).toHaveLength(0);
		});

		/** Pressing the toggle is not grabbing the row. */
		it("does not start a drag from the toggle", async () => {
			render(ProjectTab, {});
			layOutRows();
			const before = labels();
			const toggle = toggleIn(rows()[0]);
			toggle.dispatchEvent(pointer("pointerdown", 10));
			rows()[0].dispatchEvent(pointer("pointermove", 110));
			rows()[0].dispatchEvent(pointer("pointerup", 110));
			await tick();
			expect(labels()).toEqual(before);
		});

		it("captures the pointer on the row that was pressed", () => {
			render(ProjectTab, {});
			layOutRows();
			rows()[0].dispatchEvent(pointer("pointerdown", 10));
			expect(Element.prototype.setPointerCapture).toHaveBeenCalledWith(1);
		});
	});

	it("puts the tabs back to their defaults on request", async () => {
		await settings.save({
			workflowTabs: DEFAULT_WF_TABS.map((t) => ({ ...t, enabled: false })),
		});
		render(ProjectTab, {});
		const reset = Array.from(
			document.querySelectorAll<HTMLElement>("button"),
		).find((b) => /reset|défaut|restaurer/i.test(b.textContent ?? ""));
		await userEvent.click(reset as HTMLElement);
		expect(savedTabs().every((t) => t.enabled)).toBe(true);
	});
});

describe("GitignoreView", () => {
	const textarea = () =>
		document.querySelector("textarea") as HTMLTextAreaElement;
	const saveButton = () =>
		document.querySelector(".btn.primary") as HTMLButtonElement;
	const revertButton = () =>
		Array.from(document.querySelectorAll<HTMLButtonElement>(".btn")).find(
			(b) => !b.classList.contains("primary"),
		) as HTMLButtonElement;

	async function settle() {
		await tick();
		await tick();
	}

	beforeEach(() => {
		readExclude.mockReset().mockResolvedValue("node_modules\n");
		writeExclude.mockReset().mockResolvedValue(undefined);
		activeInstanceStore.set(instance("i1", "p1"));
	});

	it("loads the exclude file of the worktree", async () => {
		render(GitignoreView, {});
		await settle();
		expect(readExclude).toHaveBeenCalled();
		expect(textarea().value).toBe("node_modules\n");
	});

	/** An unreadable file starts empty rather than blocking the editor. */
	it("starts empty when the file cannot be read", async () => {
		readExclude.mockRejectedValue(new Error("no repo"));
		render(GitignoreView, {});
		await settle();
		expect(textarea().value).toBe("");
	});

	it("refuses to save what has not changed", async () => {
		render(GitignoreView, {});
		await settle();
		expect(saveButton().disabled).toBe(true);
	});

	/** The disabled button and the guard in the handler are two defences. */
	it("still writes nothing unchanged when the button is forced", async () => {
		render(GitignoreView, {});
		await settle();
		saveButton().disabled = false;
		await userEvent.click(saveButton());
		expect(writeExclude).not.toHaveBeenCalled();
	});

	it("allows saving once the content changed", async () => {
		render(GitignoreView, {});
		await settle();
		await userEvent.type(textarea(), "dist");
		expect(saveButton().disabled).toBe(false);
	});

	it("writes what was edited", async () => {
		render(GitignoreView, {});
		await settle();
		await userEvent.type(textarea(), "dist");
		await userEvent.click(saveButton());
		expect(writeExclude).toHaveBeenCalledWith("node_modules\ndist");
	});

	/** A file ends with a newline, whether or not the user typed one. */
	it("ends the saved file with a newline", async () => {
		readExclude.mockResolvedValue("");
		render(GitignoreView, {});
		await settle();
		await userEvent.type(textarea(), "dist");
		await userEvent.click(saveButton());
		await settle();
		expect(textarea().value).toBe("dist\n");
	});

	it("leaves an empty file empty rather than adding a newline to nothing", async () => {
		readExclude.mockResolvedValue("x\n");
		render(GitignoreView, {});
		await settle();
		await userEvent.clear(textarea());
		await userEvent.click(saveButton());
		await settle();
		expect(textarea().value).toBe("");
	});

	it("saves on the platform shortcut", async () => {
		render(GitignoreView, {});
		await settle();
		await userEvent.type(textarea(), "dist");
		await userEvent.keyboard("{Meta>}s{/Meta}");
		expect(writeExclude).toHaveBeenCalled();
	});

	it("puts the content back on request", async () => {
		render(GitignoreView, {});
		await settle();
		await userEvent.type(textarea(), "dist");
		await userEvent.click(revertButton());
		expect(textarea().value).toBe("node_modules\n");
		expect(saveButton().disabled).toBe(true);
	});

	/** A failed write leaves the edit in place so it is not lost. */
	it("keeps the edit when the write fails", async () => {
		writeExclude.mockRejectedValue(new Error("read-only"));
		render(GitignoreView, {});
		await settle();
		await userEvent.type(textarea(), "dist");
		await userEvent.click(saveButton());
		await settle();
		expect(textarea().value).toContain("dist");
		expect(saveButton().disabled).toBe(false);
	});
});
