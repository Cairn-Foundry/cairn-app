// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	buildDiffGutter,
	changedLines,
	clearDiffBase,
	diffLineKinds,
	type GutterChunk,
	nextChangedLine,
	previousChangedLine,
	revertChunkAtLine,
	setDiffBase,
} from "./editor-diff-gutter";
import { buildMarkdownWysiwyg } from "./editor-markdown-wysiwyg";

const views: EditorView[] = [];

function mount(
	doc: string,
	onChunkClick?: (chunk: GutterChunk) => void,
): EditorView {
	const view = new EditorView({
		state: EditorState.create({
			doc,
			extensions: [buildDiffGutter({ onChunkClick })],
		}),
		parent: document.body,
	});
	views.push(view);
	return view;
}

function kinds(view: EditorView): [number, string][] {
	return [...diffLineKinds(view.state).entries()];
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});

afterEach(() => {
	vi.useRealTimers();
	for (const view of views.splice(0)) view.destroy();
	document.body.innerHTML = "";
});

describe("diffLineKinds", () => {
	it("is empty when the gutter extension is not installed", () => {
		const state = EditorState.create({ doc: "a" });
		expect(diffLineKinds(state)).toEqual(new Map());
	});

	it("is empty until a baseline is set", () => {
		const view = mount("a\nb");
		expect(kinds(view)).toEqual([]);
	});

	it("marks a modified line", () => {
		const view = mount("a\nB\nc");
		view.dispatch({ effects: setDiffBase.of("a\nb\nc") });
		expect(kinds(view)).toEqual([[2, "modified"]]);
	});

	it("marks an added line", () => {
		const view = mount("a\nnew\nb");
		view.dispatch({ effects: setDiffBase.of("a\nb") });
		expect(kinds(view)).toEqual([[2, "added"]]);
	});

	it("marks a deletion once, on the line it sits at", () => {
		const view = mount("a\nc");
		view.dispatch({ effects: setDiffBase.of("a\nb\nc") });
		expect(kinds(view)).toEqual([[2, "deleted"]]);
	});

	it("treats an empty baseline as a single empty line", () => {
		const view = mount("a");
		view.dispatch({ effects: setDiffBase.of("") });
		expect(kinds(view)).toEqual([[1, "modified"]]);
	});

	it("is empty when the document equals the baseline", () => {
		const view = mount("a\nb");
		view.dispatch({ effects: setDiffBase.of("a\nb") });
		expect(kinds(view)).toEqual([]);
	});

	it("re-diffs incrementally on a document change", () => {
		const view = mount("a\nb");
		view.dispatch({ effects: setDiffBase.of("a\nb") });
		view.dispatch({ changes: { from: 2, to: 3, insert: "z" } });
		expect(kinds(view)).toEqual([[2, "modified"]]);
		view.dispatch({ changes: { from: 2, to: 3, insert: "b" } });
		expect(kinds(view)).toEqual([]);
	});

	it("keeps no markers while a document changes without a baseline", () => {
		const view = mount("a");
		view.dispatch({ changes: { from: 1, insert: "x" } });
		expect(kinds(view)).toEqual([]);
	});

	it("marks every line of a multi-line modification", () => {
		const view = mount("a\nB\nC\nd");
		view.dispatch({ effects: setDiffBase.of("a\nb\nc\nd") });
		expect(kinds(view)).toEqual([
			[2, "modified"],
			[3, "modified"],
		]);
	});

	it("ends a modification on an emptied last line", () => {
		const view = mount("A\n\nc");
		view.dispatch({ effects: setDiffBase.of("a\nb\nc") });
		expect(kinds(view)).toEqual([
			[1, "modified"],
			[2, "modified"],
		]);
	});

	it("diffs against a baseline set after edits made without one", () => {
		const view = mount("a");
		view.dispatch({ changes: { from: 1, insert: "x" } });
		view.dispatch({ changes: { from: 2, insert: "y" } });
		view.dispatch({ effects: setDiffBase.of("a") });
		expect(kinds(view)).toEqual([[1, "modified"]]);
	});

	it("drops the markers when the baseline is cleared", () => {
		const view = mount("a\nB");
		view.dispatch({ effects: setDiffBase.of("a\nb") });
		expect(kinds(view)).toEqual([[2, "modified"]]);
		view.dispatch({ effects: clearDiffBase.of(null) });
		expect(kinds(view)).toEqual([]);
		view.dispatch({ changes: { from: 0, insert: "x" } });
		expect(kinds(view)).toEqual([]);
	});

	it("keeps the same state when nothing changed", () => {
		const view = mount("a\nB");
		view.dispatch({ effects: setDiffBase.of("a\nb") });
		const before = diffLineKinds(view.state);
		view.dispatch({ selection: { anchor: 1 } });
		expect(diffLineKinds(view.state)).toBe(before);
	});
});

describe("gutter markers", () => {
	function pressGutter(view: EditorView, clientY: number) {
		const gutterDom = view.dom.querySelector(".cm-diff-gutter");
		const event = new MouseEvent("mousedown", {
			bubbles: true,
			cancelable: true,
			clientY,
		});
		gutterDom?.dispatchEvent(event);
		return event;
	}

	it("renders a marker on the changed line only", () => {
		const view = mount("a\nB\nc");
		view.dispatch({ effects: setDiffBase.of("a\nb\nc") });
		const markers = [...view.dom.querySelectorAll(".cm-diff-marker")].map(
			(m) => m.className,
		);
		expect(markers).toEqual([
			"cm-diff-marker cm-diff-added",
			"cm-diff-marker cm-diff-modified",
		]);
	});

	it("marks a rendered table whose changed row is inside the block", () => {
		const doc = "text\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nend";
		const view = new EditorView({
			state: EditorState.create({
				doc,
				extensions: [
					markdown({ base: markdownLanguage }),
					buildMarkdownWysiwyg(),
					buildDiffGutter({}),
				],
				selection: { anchor: doc.length },
			}),
			parent: document.body,
		});
		views.push(view);
		view.dispatch({ effects: setDiffBase.of(doc.replace("| 2 |", "| x |")) });
		const markers = [...view.dom.querySelectorAll(".cm-diff-marker")].map(
			(m) => m.className,
		);
		expect(markers).toContain("cm-diff-marker cm-diff-modified");
	});

	it("reports the clicked chunk with both sides", () => {
		const onChunkClick = vi.fn();
		const view = mount("a\nB\nc", onChunkClick);
		view.dispatch({ effects: setDiffBase.of("a\nb\nc") });
		pressGutter(view, 20);
		expect(onChunkClick).toHaveBeenCalledOnce();
		expect(onChunkClick).toHaveBeenCalledWith({
			lineStart: 2,
			lineEnd: 2,
			anchorLine: 2,
			before: "b\n",
			after: "B\n",
		});
	});

	it("ignores a click on an unchanged line", () => {
		const onChunkClick = vi.fn();
		const view = mount("a\nB\nc", onChunkClick);
		view.dispatch({ effects: setDiffBase.of("a\nb\nc") });
		pressGutter(view, 5);
		expect(onChunkClick).not.toHaveBeenCalled();
	});

	it("claims a click on a changed line and leaves an unchanged one alone", () => {
		const view = mount("a\nB\nc");
		view.dispatch({ effects: setDiffBase.of("a\nb\nc") });
		expect(pressGutter(view, 20).defaultPrevented).toBe(true);
		expect(pressGutter(view, 5).defaultPrevented).toBe(false);
	});

	it("reports every line of a multi-line chunk", () => {
		const onChunkClick = vi.fn();
		const view = mount("a\nB\nC\nd", onChunkClick);
		view.dispatch({ effects: setDiffBase.of("a\nb\nc\nd") });
		pressGutter(view, 20);
		expect(onChunkClick).toHaveBeenCalledWith(
			expect.objectContaining({ lineStart: 2, lineEnd: 3 }),
		);
	});

	it("accepts a click when no handler is given", () => {
		const view = mount("a\nB\nc");
		view.dispatch({ effects: setDiffBase.of("a\nb\nc") });
		expect(() => pressGutter(view, 20)).not.toThrow();
	});
});

describe("revertChunkAtLine", () => {
	it("restores a modified line to its baseline text", () => {
		const view = mount("a\nB\nc");
		view.dispatch({ effects: setDiffBase.of("a\nb\nc") });
		expect(revertChunkAtLine(view, 2)).toBe(true);
		expect(view.state.doc.toString()).toBe("a\nb\nc");
	});

	it("removes an added line", () => {
		const view = mount("a\nnew\nb");
		view.dispatch({ effects: setDiffBase.of("a\nb") });
		expect(revertChunkAtLine(view, 2)).toBe(true);
		expect(view.state.doc.toString()).toBe("a\nb");
	});

	it("puts a deleted line back", () => {
		const view = mount("a\nc");
		view.dispatch({ effects: setDiffBase.of("a\nb\nc") });
		expect(revertChunkAtLine(view, 2)).toBe(true);
		expect(view.state.doc.toString()).toBe("a\nb\nc");
	});

	it("returns false and leaves the document alone on an unchanged line", () => {
		const view = mount("a\nB\nc");
		view.dispatch({ effects: setDiffBase.of("a\nb\nc") });
		expect(revertChunkAtLine(view, 1)).toBe(false);
		expect(view.state.doc.toString()).toBe("a\nB\nc");
	});

	it("tags the change as a revert", () => {
		const view = mount("a\nB");
		view.dispatch({ effects: setDiffBase.of("a\nb") });
		const seen: (string | undefined)[] = [];
		const original = view.dispatch.bind(view);
		view.dispatch = ((...specs: Parameters<EditorView["dispatch"]>) => {
			const tr = view.state.update(...(specs as [never]));
			seen.push(tr.annotation(Transaction.userEvent) as string | undefined);
			original(tr);
		}) as EditorView["dispatch"];
		revertChunkAtLine(view, 2);
		expect(seen).toEqual(["revert"]);
	});
});

describe("nextChangedLine", () => {
	/** Lines 2 and 5 differ from the baseline, so the changes start there. */
	function changed(): EditorView {
		const view = mount("a\nCHANGED\nc\nd\nALSO\nf");
		view.dispatch({ effects: setDiffBase.of("a\nb\nc\nd\ne\nf") });
		return view;
	}

	it("is null when the gutter extension is not installed", () => {
		expect(nextChangedLine(EditorState.create({ doc: "a" }), 1)).toBeNull();
	});

	it("is null while the file has no change", () => {
		const view = mount("a\nb");
		view.dispatch({ effects: setDiffBase.of("a\nb") });
		expect(nextChangedLine(view.state, 1)).toBeNull();
	});

	it("reaches the first change from the top of the file", () => {
		expect(nextChangedLine(changed().state, 0)).toBe(2);
	});

	it("walks to the change that follows the cursor", () => {
		expect(nextChangedLine(changed().state, 2)).toBe(5);
	});

	it("wraps back to the first change once past the last", () => {
		expect(nextChangedLine(changed().state, 5)).toBe(2);
	});
});

describe("previousChangedLine and changedLines", () => {
	function changed(): EditorView {
		const view = mount("a\nCHANGED\nc\nd\nALSO\nf");
		view.dispatch({ effects: setDiffBase.of("a\nb\nc\nd\ne\nf") });
		return view;
	}

	it("counts every change in document order", () => {
		expect(changedLines(changed().state)).toEqual([2, 5]);
	});

	it("is empty when the gutter extension is not installed", () => {
		expect(changedLines(EditorState.create({ doc: "a" }))).toEqual([]);
	});

	it("walks back to the change above the cursor", () => {
		expect(previousChangedLine(changed().state, 5)).toBe(2);
	});

	it("wraps to the last change from the top of the file", () => {
		expect(previousChangedLine(changed().state, 1)).toBe(5);
	});

	it("is null while the file has no change", () => {
		const view = mount("a\nb");
		view.dispatch({ effects: setDiffBase.of("a\nb") });
		expect(previousChangedLine(view.state, 1)).toBeNull();
	});
});
