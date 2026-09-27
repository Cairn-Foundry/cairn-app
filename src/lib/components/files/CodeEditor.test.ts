// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { showMinimap } from "@replit/codemirror-minimap";
import { render } from "@testing-library/svelte";
import { tick } from "svelte";
import { describe, expect, it } from "vitest";
import CodeEditor from "./CodeEditor.svelte";

type Ref = {
	jumpTo: (line: number, col: number, path?: string | null) => boolean;
	getState: () => { cursorPos: number; scrollTop: number };
};

const docOf = (lines: string[]) => Text.of(lines);

/** The markers the minimap was last configured with, read off its own facet. */
function minimapMarkers(): Record<number, string> {
	const dom = document.querySelector<HTMLElement>(".cm-editor");
	if (!dom) return {};
	const view = EditorView.findFromDOM(dom);
	const config = view?.state.facet(showMinimap);
	return (config?.gutters?.[0] ?? {}) as Record<number, string>;
}

describe("CodeEditor.jumpTo", () => {
	it("jumps once its own document is on screen", async () => {
		const { component } = render(CodeEditor, {
			content: docOf(["one", "two", "three", "four"]),
			docPath: "a.ts",
			readonly: true,
		});
		await tick();
		const ref = component as unknown as Ref;
		const jumped = ref.jumpTo(3, 2, "a.ts");
		await tick();
		expect(jumped).toBe(true);
		expect(ref.getState().cursorPos).toBe(
			docOf(["one", "two", "three", "four"]).line(3).from + 1,
		);
	});

	it("refuses a jump for a document it is not showing, then accepts it after the swap", async () => {
		const { component, rerender } = render(CodeEditor, {
			content: docOf(["one", "two"]),
			docPath: "a.ts",
			readonly: true,
		});
		await tick();
		const ref = component as unknown as Ref;
		expect(ref.jumpTo(2, 1, "b.ts")).toBe(false);

		await rerender({
			content: docOf(["alpha", "beta", "gamma"]),
			docPath: "b.ts",
			readonly: true,
		});
		await tick();
		expect(ref.jumpTo(3, 1, "b.ts")).toBe(true);
		expect(ref.getState().cursorPos).toBe(
			docOf(["alpha", "beta", "gamma"]).line(3).from,
		);
	});
});

describe("CodeEditor minimap search markers", () => {
	it("marks the workspace search hits it is handed", async () => {
		render(CodeEditor, {
			content: docOf(["one", "two", "three", "four"]),
			docPath: "a.ts",
			readonly: true,
			searchLines: [2, 4],
		});
		await tick();
		const markers = minimapMarkers();
		expect(Object.keys(markers).sort()).toEqual(["2", "4"]);
	});

	it("drops the marks when the search results go away", async () => {
		const { rerender } = render(CodeEditor, {
			content: docOf(["one", "two", "three", "four"]),
			docPath: "a.ts",
			readonly: true,
			searchLines: [2, 4],
		});
		await tick();
		expect(Object.keys(minimapMarkers())).toHaveLength(2);

		await rerender({
			content: docOf(["one", "two", "three", "four"]),
			docPath: "a.ts",
			readonly: true,
			searchLines: [],
		});
		await tick();
		expect(Object.keys(minimapMarkers())).toHaveLength(0);
	});
});
