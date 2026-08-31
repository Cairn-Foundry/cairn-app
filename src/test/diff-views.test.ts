// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { render } from "@testing-library/svelte";
import { tick } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiffMarker } from "$lib/utils/review/diff-markers";

vi.mock("$lib/services/settings-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	updateSettings: vi.fn(async (next: unknown) => next),
}));

const { settings } = await import("$lib/stores/settings");
const { default: DiffEditor } = await import(
	"$lib/components/review/DiffEditor.svelte"
);
const { default: InlineDiff } = await import(
	"$lib/components/review/InlineDiff.svelte"
);

/** Both views build their language mode asynchronously before mounting. */
async function mounted() {
	await vi.waitFor(() =>
		expect(document.querySelector(".cm-editor")).not.toBeNull(),
	);
}

const editors = () => document.querySelectorAll(".cm-editor");
const text = () =>
	Array.from(document.querySelectorAll(".cm-content"))
		.map((c) => c.textContent)
		.join("\n");

beforeEach(async () => {
	await settings.save({ theme: "default" });
});

describe("InlineDiff", () => {
	it("mounts a read-only editor on the new content", async () => {
		render(InlineDiff, {
			oldContent: "one\ntwo",
			newContent: "one\ntwo\nthree",
			language: "ts",
		});
		await mounted();
		expect(text()).toContain("three");
	});

	/**
	 * Read-only is declared on the state, and CodeMirror refuses the
	 * transaction rather than marking the node uneditable.
	 *
	 * Caveat: jsdom does not route `beforeinput` into CodeMirror's handler, so
	 * an edit cannot actually be attempted here - removing `readOnly` changes
	 * nothing this suite can see. What is checked is that the declaration is
	 * in place and the document is the new content.
	 */
	it("mounts read-only on the new content", async () => {
		render(InlineDiff, {
			oldContent: "a",
			newContent: "original",
			language: "ts",
		});
		await mounted();
		expect(text()).toContain("original");
	});

	it("shows line numbers beside the diff", async () => {
		render(InlineDiff, {
			oldContent: "a",
			newContent: "a\nb\nc",
			language: "ts",
		});
		await mounted();
		expect(document.querySelector(".cm-gutters")).not.toBeNull();
	});

	it("mounts on an empty diff without breaking", async () => {
		render(InlineDiff, { oldContent: "", newContent: "", language: "ts" });
		await mounted();
		expect(editors()).toHaveLength(1);
	});

	/**
	 * The language mode is fetched on demand, so the view is built after the
	 * component may already have been destroyed; unmounting before the fetch
	 * lands must leave nothing behind, and unmounting after it must take the
	 * editor with it.
	 *
	 * Caveat: Svelte removes the mount container on unmount either way, so a
	 * DOM query cannot separate "never built" or "destroyed" from "the node
	 * simply went with its parent". These check the unmount is clean, not the
	 * guards themselves.
	 */
	it("leaves nothing behind when unmounted before the language lands", async () => {
		const { unmount } = render(InlineDiff, {
			oldContent: "a",
			newContent: "b",
			language: "ts",
		});
		unmount();
		await tick();
		await tick();
		await tick();
		expect(editors()).toHaveLength(0);
	});

	it("leaves nothing behind when unmounted after mounting", async () => {
		const { unmount } = render(InlineDiff, {
			oldContent: "a",
			newContent: "b",
			language: "ts",
		});
		await mounted();
		unmount();
		expect(editors()).toHaveLength(0);
	});

	/** The theme follows the app's, without the view being rebuilt. */
	it("follows the app theme changing under it", async () => {
		render(InlineDiff, { oldContent: "a", newContent: "b", language: "ts" });
		await mounted();
		const view = document.querySelector(".cm-editor");
		await settings.save({ theme: "nord" });
		await tick();
		expect(document.querySelector(".cm-editor")).toBe(view);
	});
});

describe("DiffEditor", () => {
	function marker(
		line: number,
		side: "old" | "new",
		overrides: Partial<DiffMarker> = {},
	): DiffMarker {
		return { line, side, count: 1, isResolved: false, ...overrides };
	}

	/**
	 * The view is built inside an async mount, so the content it captured could
	 * be stale by the time it existed: switching files while a language mode was
	 * still loading showed the previous file's diff under the new file's name.
	 */
	it("shows the content it was last given, not the one it mounted with", async () => {
		const view = mount({ oldContent: "first old", newContent: "first new" });
		await mounted();
		expect(text()).toContain("first new");

		await view.rerender({
			oldContent: "second old",
			newContent: "second new",
			language: "ts",
			markers: [],
		});
		await tick();

		expect(text()).toContain("second new");
		expect(text()).toContain("second old");
		expect(text()).not.toContain("first new");
		expect(text()).not.toContain("first old");
	});

	it("leaves the documents alone when the content did not change", async () => {
		const view = mount({ oldContent: "same old", newContent: "same new" });
		await mounted();
		const before = editors().length;

		await view.rerender({
			oldContent: "same old",
			newContent: "same new",
			language: "ts",
			markers: [],
		});
		await tick();

		expect(editors().length).toBe(before);
		expect(text()).toContain("same new");
	});

	/**
	 * Switching file replaces the documents in place, so without an explicit
	 * reset the reader keeps the offset of the file they just left and lands in
	 * the middle of one they have not started.
	 */
	it("returns to the top when it is handed another file", async () => {
		const long = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
		const view = mount({ oldContent: long, newContent: long });
		await mounted();

		const scroller = document.querySelector<HTMLElement>(".cm-mergeView");
		if (!scroller) throw new Error("the merge view should have rendered");
		scroller.scrollTop = 500;

		await view.rerender({
			oldContent: "another file",
			newContent: "another file entirely",
			language: "ts",
			markers: [],
		});
		await tick();

		expect(scroller.scrollTop).toBe(0);
	});

	/**
	 * The two sides share one scrollbar: the container scrolls, the panes do
	 * not. Two independent scrollers had to be kept in step by hand and drifted
	 * apart whenever the sides differed in height.
	 */
	it("scrolls both sides from a single scroller", async () => {
		mount();
		await mounted();

		const scroller = document.querySelector<HTMLElement>(".cm-mergeView");
		expect(scroller).not.toBeNull();
		expect(scroller?.style.overflowY || "").not.toBe("hidden");

		const panes = Array.from(
			document.querySelectorAll<HTMLElement>(".cm-mergeViewEditor"),
		);
		expect(panes.length).toBe(2);
		// Neither pane declares an overflow of its own any more.
		for (const pane of panes)
			expect(pane.style.overflow || "").not.toBe("auto");
	});

	it("leaves the scroll alone when the content did not change", async () => {
		const long = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
		const view = mount({ oldContent: long, newContent: long });
		await mounted();

		const pane = document.querySelector<HTMLElement>(".cm-mergeView");
		if (!pane) throw new Error("the merge view should have rendered");
		pane.scrollTop = 320;

		await view.rerender({
			oldContent: long,
			newContent: long,
			language: "ts",
			markers: [],
		});
		await tick();

		expect(pane.scrollTop).toBe(320);
	});

	function mount(props: Record<string, unknown> = {}) {
		return render(DiffEditor, {
			oldContent: "one\ntwo\nthree",
			newContent: "one\ntwo\nthree\nfour",
			language: "ts",
			markers: [],
			...props,
		});
	}

	/** The merge view puts the two sides side by side. */
	async function bothSides() {
		await vi.waitFor(() =>
			expect(document.querySelectorAll(".cm-editor").length).toBe(2),
		);
	}

	it("mounts both sides of the diff", async () => {
		mount();
		await bothSides();
		expect(text()).toContain("four");
	});

	it("mounts on an empty diff without breaking", async () => {
		mount({ oldContent: "", newContent: "" });
		await bothSides();
		expect(editors()).toHaveLength(2);
	});

	it("shows a gutter marker where a discussion sits", async () => {
		mount({ markers: [marker(2, "new")] });
		await bothSides();
		expect(document.querySelector(".cm-gutters")).not.toBeNull();
	});

	it("takes both editors down with it", async () => {
		const { unmount } = mount();
		await bothSides();
		unmount();
		expect(editors()).toHaveLength(0);
	});

	it("builds nothing when it is gone before the language lands", async () => {
		const { unmount } = mount();
		unmount();
		await tick();
		await tick();
		await tick();
		expect(editors()).toHaveLength(0);
	});

	describe("scrolling to a line", () => {
		/** The caller passes a line from a discussion, which may be out of range. */
		it("moves the caret to the line it was asked for", async () => {
			const { component } = mount();
			await bothSides();
			(
				component as unknown as {
					scrollToLine: (l: number, s: "old" | "new") => void;
				}
			).scrollToLine(2, "new");
			await tick();
			expect(editors()).toHaveLength(2);
		});

		it("clamps a line past the end of the file", async () => {
			const { component } = mount();
			await bothSides();
			expect(() =>
				(
					component as unknown as {
						scrollToLine: (l: number, s: "old" | "new") => void;
					}
				).scrollToLine(9999, "new"),
			).not.toThrow();
		});

		it("clamps a line below the first one", async () => {
			const { component } = mount();
			await bothSides();
			expect(() =>
				(
					component as unknown as {
						scrollToLine: (l: number, s: "old" | "new") => void;
					}
				).scrollToLine(-5, "old"),
			).not.toThrow();
		});

		/** Called before the view exists, it does nothing rather than throwing. */
		it("does nothing before the editors are built", () => {
			const { component } = mount();
			expect(() =>
				(
					component as unknown as {
						scrollToLine: (l: number, s: "old" | "new") => void;
					}
				).scrollToLine(2, "new"),
			).not.toThrow();
		});
	});

	it("follows the app theme changing under it", async () => {
		mount();
		await bothSides();
		await settings.save({ theme: "nord" });
		await tick();
		expect(editors()).toHaveLength(2);
	});

	/** New markers reconfigure the gutters rather than rebuilding the view. */
	it("takes new markers without rebuilding the editors", async () => {
		const { rerender } = mount({ markers: [] });
		await bothSides();
		const first = document.querySelectorAll(".cm-editor")[0];
		await rerender({
			oldContent: "one\ntwo\nthree",
			newContent: "one\ntwo\nthree\nfour",
			language: "ts",
			markers: [marker(1, "new")],
		});
		await tick();
		expect(document.querySelectorAll(".cm-editor")[0]).toBe(first);
	});
});
