// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { GutterChunk } from "$lib/utils/editor/editor-diff-gutter";

// The embedded diff is a CodeMirror view, which has nothing to say about this
// panel's behaviour; it is replaced by a marker carrying the two sides.
vi.mock("$lib/components/review/DiffEditor.svelte", async () => ({
	default: (await import("../../../test/stubs/DiffEditorStub.svelte")).default,
}));

const { default: HunkDiffPanel } = await import("./HunkDiffPanel.svelte");

function chunk(overrides: Partial<GutterChunk> = {}): GutterChunk {
	return {
		lineStart: 10,
		lineEnd: 14,
		before: "old line",
		after: "new line",
		...overrides,
	} as GutterChunk;
}

function mount(props: Record<string, unknown> = {}) {
	const onRevert = vi.fn();
	const onDismiss = vi.fn();
	const result = render(HunkDiffPanel, {
		chunk: chunk(),
		activeLang: null,
		onRevert,
		onDismiss,
		...props,
	});
	return { ...result, onRevert, onDismiss };
}

const title = () =>
	document.querySelector(".hunk-panel-title")?.textContent?.trim();
const diff = () => document.querySelector("[data-diff]") as HTMLElement;

describe("HunkDiffPanel", () => {
	it("says which lines the hunk covers", () => {
		mount({ chunk: chunk({ lineStart: 3, lineEnd: 9 }) });
		expect(title()).toMatch(/3/);
		expect(title()).toMatch(/9/);
	});

	it("shows the two sides of the hunk", () => {
		mount({
			chunk: chunk({ before: "was here", after: "is here now" }),
		});
		expect(diff().dataset.old).toBe("was here");
		expect(diff().dataset.new).toBe("is here now");
	});

	it("shows an added hunk, whose before side is empty", () => {
		mount({ chunk: chunk({ before: "", after: "brand new" }) });
		expect(diff().dataset.old).toBe("");
		expect(diff().dataset.new).toBe("brand new");
	});

	it("shows a removed hunk, whose after side is empty", () => {
		mount({ chunk: chunk({ before: "gone now", after: "" }) });
		expect(diff().dataset.old).toBe("gone now");
		expect(diff().dataset.new).toBe("");
	});

	it("reverts the hunk on request", async () => {
		const { onRevert, onDismiss } = mount();
		await userEvent.click(
			document.querySelector(".hunk-panel-action") as HTMLElement,
		);
		expect(onRevert).toHaveBeenCalled();
		expect(onDismiss).not.toHaveBeenCalled();
	});

	it("closes on request without reverting", async () => {
		const { onRevert, onDismiss } = mount();
		await userEvent.click(
			document.querySelector(".hunk-panel-close") as HTMLElement,
		);
		expect(onDismiss).toHaveBeenCalled();
		expect(onRevert).not.toHaveBeenCalled();
	});

	it("names the close button for a screen reader", () => {
		mount();
		expect(
			(document.querySelector(".hunk-panel-close") as HTMLElement).getAttribute(
				"aria-label",
			),
		).toBeTruthy();
	});

	/**
	 * The diff is keyed on the chunk: peeking at another hunk must rebuild it
	 * rather than leave the previous one's content in place.
	 */
	it("rebuilds the diff when another hunk is peeked at", async () => {
		const { rerender } = mount();
		const before = diff();
		await rerender({
			chunk: chunk({ lineStart: 40, lineEnd: 42, before: "x", after: "y" }),
			activeLang: null,
			onRevert: vi.fn(),
			onDismiss: vi.fn(),
		});
		expect(diff()).not.toBe(before);
		expect(diff().dataset.old).toBe("x");
	});

	it("passes the language down to the diff", () => {
		mount({ activeLang: "typescript" });
		expect(diff().dataset.lang).toBe("typescript");
	});
});
