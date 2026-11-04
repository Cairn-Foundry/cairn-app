// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "#lib/i18n";
import { buildConflictResolver, conflictLines } from "./editor-conflict";

const views: EditorView[] = [];

function stateOf(doc: string): EditorState {
	return EditorState.create({ doc, extensions: [buildConflictResolver()] });
}

function mount(doc: string): EditorView {
	const view = new EditorView({ state: stateOf(doc), parent: document.body });
	views.push(view);
	return view;
}

function lines(...rows: string[]): string {
	return rows.join("\n");
}

function press(button: Element): boolean {
	return button.dispatchEvent(
		new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
	);
}

function scrollMargins(spy: { mock: { calls: unknown[][] } }): unknown[] {
	return spy.mock.calls.flatMap(([spec]) => {
		const effects = (spec as { effects?: unknown }).effects;
		return [effects]
			.flat()
			.filter(
				(effect): effect is { value: { range: { head: number }; y: string } } =>
					Boolean(effect) &&
					(effect as { value?: { yMargin?: number } }).value?.yMargin === 56,
			)
			.map((effect) => [effect.value.range.head, effect.value.y]);
	});
}

function actionButton(view: EditorView, variant: string, bar = 0): Element {
	const found = view.dom.querySelectorAll(".cm-conflict-bar")[bar];
	const button = found.querySelector(`.cm-conflict-btn.${variant}`);
	if (!button) throw new Error(`no ${variant} button`);
	return button;
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

describe("conflictLines", () => {
	it("covers every line of a plain region, markers included", () => {
		const state = stateOf(
			lines("a", "<<<<<<< HEAD", "ours", "=======", "theirs", ">>>>>>> x", "b"),
		);
		expect(conflictLines(state)).toEqual([2, 3, 4, 5, 6]);
	});

	it("covers a diff3 region with its base section", () => {
		const state = stateOf(
			lines(
				"<<<<<<< HEAD",
				"ours",
				"||||||| base",
				"old",
				"=======",
				"theirs",
				">>>>>>> x",
			),
		);
		expect(conflictLines(state)).toEqual([1, 2, 3, 4, 5, 6, 7]);
	});

	it("finds several regions in document order", () => {
		const state = stateOf(
			lines(
				"<<<<<<< a",
				"1",
				"=======",
				"2",
				">>>>>>> a",
				"mid",
				"<<<<<<< b",
				"3",
				"=======",
				"4",
				">>>>>>> b",
			),
		);
		expect(conflictLines(state)).toEqual([1, 2, 3, 4, 5, 7, 8, 9, 10, 11]);
	});

	it("skips a region that never closes", () => {
		const state = stateOf(lines("<<<<<<< a", "1", "=======", "2"));
		expect(conflictLines(state)).toEqual([]);
	});

	it("skips a region that has no separator", () => {
		const state = stateOf(lines("<<<<<<< a", "1", ">>>>>>> a"));
		expect(conflictLines(state)).toEqual([]);
	});

	it("skips an unclosed region and still reads the nested one", () => {
		const state = stateOf(
			lines(
				"<<<<<<< outer",
				"x",
				"<<<<<<< inner",
				"1",
				"=======",
				"2",
				">>>>>>> inner",
			),
		);
		expect(conflictLines(state)).toEqual([3, 4, 5, 6, 7]);
	});

	it("is empty on a document without markers", () => {
		expect(conflictLines(stateOf("just\ntext"))).toEqual([]);
	});

	it("treats a base marker after the separator as ordinary text", () => {
		const state = stateOf(
			lines("<<<<<<< a", "1", "=======", "||||||| late", ">>>>>>> a"),
		);
		expect(conflictLines(state)).toEqual([1, 2, 3, 4, 5]);
	});

	it("ignores a separator and an end marker with no start marker", () => {
		const state = stateOf(lines("a", "=======", "b", ">>>>>>> x"));
		expect(conflictLines(state)).toEqual([]);
	});

	it("reads a region that starts on the line right after an unclosed start", () => {
		const state = stateOf(
			lines(
				"<<<<<<< outer",
				"<<<<<<< inner",
				"1",
				"=======",
				"2",
				">>>>>>> inner",
			),
		);
		expect(conflictLines(state)).toEqual([2, 3, 4, 5, 6]);
	});

	it("treats a second separator as ordinary text", () => {
		const state = stateOf(
			lines("<<<<<<< a", "1", "=======", "=======", ">>>>>>> a"),
		);
		expect(conflictLines(state)).toEqual([1, 2, 3, 4, 5]);
	});
});

describe("conflict decorations", () => {
	it("hides the markers and tints each side", () => {
		const view = mount(
			lines("<<<<<<< HEAD", "ours", "=======", "theirs", ">>>>>>> x"),
		);
		const rows = [...view.dom.querySelectorAll(".cm-line")].map((l) => [
			l.textContent,
			l.classList.contains("cm-conflict-hidden"),
			l.classList.contains("cm-conflict-current"),
			l.classList.contains("cm-conflict-incoming"),
		]);
		expect(rows).toEqual([
			["<<<<<<< HEAD", true, false, false],
			["ours", false, true, false],
			["=======", true, false, false],
			["theirs", false, false, true],
			[">>>>>>> x", true, false, false],
		]);
	});

	it("hides the whole base section of a diff3 region", () => {
		const view = mount(
			lines(
				"<<<<<<< HEAD",
				"ours",
				"||||||| base",
				"old",
				"=======",
				"theirs",
				">>>>>>> x",
			),
		);
		const hidden = [...view.dom.querySelectorAll(".cm-line")]
			.filter((l) => l.classList.contains("cm-conflict-hidden"))
			.map((l) => l.textContent);
		expect(hidden).toEqual([
			"<<<<<<< HEAD",
			"||||||| base",
			"old",
			"=======",
			">>>>>>> x",
		]);
	});

	it("anchors the bar on the first incoming line when ours is empty", () => {
		const view = mount(lines("<<<<<<< HEAD", "=======", "theirs", ">>>>>>> x"));
		const bar = view.dom.querySelector(".cm-conflict-bar");
		expect(bar?.nextElementSibling?.textContent).toBe("theirs");
	});

	it("anchors the bar on the start marker when both sides are empty", () => {
		const view = mount(lines("<<<<<<< HEAD", "=======", ">>>>>>> x"));
		const bar = view.dom.querySelector(".cm-conflict-bar");
		expect(bar?.nextElementSibling?.textContent).toBe("<<<<<<< HEAD");
	});

	it("anchors the bar on the first current line otherwise", () => {
		const view = mount(
			lines("<<<<<<< HEAD", "ours", "=======", "theirs", ">>>>>>> x"),
		);
		const bar = view.dom.querySelector(".cm-conflict-bar");
		expect(bar?.nextElementSibling?.textContent).toBe("ours");
	});

	it("shows no navigation for a single region", () => {
		const view = mount(
			lines("<<<<<<< HEAD", "ours", "=======", "theirs", ">>>>>>> x"),
		);
		expect(view.dom.querySelector(".cm-conflict-nav")).toBeNull();
	});
});

describe("conflict actions", () => {
	const SINGLE = lines(
		"top",
		"<<<<<<< HEAD",
		"ours",
		"=======",
		"theirs",
		">>>>>>> x",
		"bottom",
	);

	it("accepts the current side", () => {
		const view = mount(SINGLE);
		press(actionButton(view, "current"));
		expect(view.state.doc.toString()).toBe("top\nours\nbottom");
	});

	it("accepts the incoming side", () => {
		const view = mount(SINGLE);
		press(actionButton(view, "incoming"));
		expect(view.state.doc.toString()).toBe("top\ntheirs\nbottom");
	});

	it("accepts both sides, current first", () => {
		const view = mount(SINGLE);
		press(actionButton(view, "both"));
		expect(view.state.doc.toString()).toBe("top\nours\ntheirs\nbottom");
	});

	it("accepts both without a trailing newline when incoming is empty", () => {
		const view = mount(lines("<<<<<<< HEAD", "ours", "=======", ">>>>>>> x"));
		press(actionButton(view, "both"));
		expect(view.state.doc.toString()).toBe("ours");
	});

	it("does nothing on a read-only document", () => {
		const view = new EditorView({
			state: EditorState.create({
				doc: SINGLE,
				extensions: [buildConflictResolver(), EditorState.readOnly.of(true)],
			}),
			parent: document.body,
		});
		views.push(view);
		press(actionButton(view, "current"));
		expect(view.state.doc.toString()).toBe(SINGLE);
	});

	it("resolves only the clicked region", () => {
		const view = mount(
			lines(
				"<<<<<<< a",
				"1",
				"=======",
				"2",
				">>>>>>> a",
				"<<<<<<< b",
				"3",
				"=======",
				"4",
				">>>>>>> b",
			),
		);
		press(actionButton(view, "incoming", 1));
		expect(view.state.doc.toString()).toBe(
			lines("<<<<<<< a", "1", "=======", "2", ">>>>>>> a", "4"),
		);
	});
});

describe("conflict navigation", () => {
	const TWO = lines(
		"<<<<<<< a",
		"1",
		"=======",
		"2",
		">>>>>>> a",
		"gap",
		"<<<<<<< b",
		"3",
		"=======",
		"4",
		">>>>>>> b",
	);

	function nav(view: EditorView, bar: number) {
		const root = view.dom.querySelectorAll(".cm-conflict-bar")[bar];
		const buttons = root.querySelectorAll(".cm-conflict-navbtn");
		return {
			count: root.querySelector(".cm-conflict-count")?.textContent,
			prev: buttons[0],
			next: buttons[1],
		};
	}

	it("numbers the regions", () => {
		const view = mount(TWO);
		expect(nav(view, 0).count).toBe("1/2");
		expect(nav(view, 1).count).toBe("2/2");
	});

	it("moves the caret to the next region", () => {
		const view = mount(TWO);
		press(nav(view, 0).next);
		expect(view.state.selection.main.head).toBe(view.state.doc.line(8).from);
	});

	it("wraps to the first region from the last one", () => {
		const view = mount(TWO);
		press(nav(view, 1).next);
		expect(view.state.selection.main.head).toBe(view.state.doc.line(2).from);
	});

	it("moves the caret to the previous region, wrapping from the first", () => {
		const view = mount(TWO);
		press(nav(view, 0).prev);
		expect(view.state.selection.main.head).toBe(view.state.doc.line(8).from);
		press(nav(view, 1).prev);
		expect(view.state.selection.main.head).toBe(view.state.doc.line(2).from);
	});
});

describe("conflict regions in detail", () => {
	const DIFF3 = lines(
		"<<<<<<< HEAD",
		"ours",
		"||||||| base",
		"old",
		"=======",
		"theirs",
		">>>>>>> x",
	);

	it("keeps the base section out of the current side", () => {
		const view = mount(DIFF3);
		press(actionButton(view, "current"));
		expect(view.state.doc.toString()).toBe("ours");
	});

	it("keeps the base section out of the incoming side", () => {
		const view = mount(DIFF3);
		press(actionButton(view, "incoming"));
		expect(view.state.doc.toString()).toBe("theirs");
	});

	it("treats a second base marker as part of the base section", () => {
		const view = mount(
			lines(
				"<<<<<<< HEAD",
				"ours",
				"||||||| base",
				"old",
				"||||||| again",
				"older",
				"=======",
				"theirs",
				">>>>>>> x",
			),
		);
		press(actionButton(view, "current"));
		expect(view.state.doc.toString()).toBe("ours");
	});

	it("treats a base marker after the separator as incoming text", () => {
		const view = mount(
			lines("<<<<<<< a", "1", "=======", "||||||| late", ">>>>>>> a"),
		);
		press(actionButton(view, "current"));
		expect(view.state.doc.toString()).toBe("1");
	});

	it("accepts both sides as a blank line then the incoming text when current is empty", () => {
		const view = mount(lines("<<<<<<< HEAD", "=======", "theirs", ">>>>>>> x"));
		press(actionButton(view, "both"));
		expect(view.state.doc.toString()).toBe("\ntheirs");
	});

	it("accepts the current side as nothing when it is empty", () => {
		const view = mount(lines("<<<<<<< HEAD", "=======", "theirs", ">>>>>>> x"));
		press(actionButton(view, "current"));
		expect(view.state.doc.toString()).toBe("");
	});

	it("drops the bar and the tints once the region is resolved", () => {
		const view = mount(
			lines("top", "<<<<<<< HEAD", "ours", "=======", "theirs", ">>>>>>> x"),
		);
		press(actionButton(view, "current"));
		expect(view.dom.querySelector(".cm-conflict-bar")).toBeNull();
		expect(view.dom.querySelector(".cm-conflict-current")).toBeNull();
	});

	it("draws each action as a swatch followed by its label", () => {
		const view = mount(
			lines("<<<<<<< HEAD", "ours", "=======", "theirs", ">>>>>>> x"),
		);
		const expected = {
			current: t("git.acceptCurrent"),
			incoming: t("git.acceptIncoming"),
			both: t("git.acceptBoth"),
		};
		for (const [variant, label] of Object.entries(expected)) {
			const button = actionButton(view, variant);
			expect(button.querySelector(".cm-conflict-swatch")).not.toBeNull();
			expect(button.textContent).toBe(label);
		}
	});

	it("cancels the default action of a button press", () => {
		const view = mount(
			lines("<<<<<<< HEAD", "ours", "=======", "theirs", ">>>>>>> x"),
		);
		expect(press(actionButton(view, "current"))).toBe(false);
	});
});

describe("conflict scrolling", () => {
	const SINGLE = lines("top", "<<<<<<< a", "1", "=======", "2", ">>>>>>> a");

	it("scrolls the first conflict to the top once the view is mounted", async () => {
		const dispatch = vi.spyOn(EditorView.prototype, "dispatch");
		const view = mount(SINGLE);
		await Promise.resolve();
		await Promise.resolve();
		expect(scrollMargins(dispatch)).toEqual([
			[view.state.doc.line(3).from, "start"],
		]);
		dispatch.mockRestore();
	});

	it("does not scroll a view that left the page before the microtask ran", async () => {
		const dispatch = vi.spyOn(EditorView.prototype, "dispatch");
		const view = mount(SINGLE);
		view.dom.remove();
		await Promise.resolve();
		await Promise.resolve();
		expect(scrollMargins(dispatch)).toEqual([]);
		dispatch.mockRestore();
	});

	it("mounts a document without markers without raising an error", async () => {
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});
		const dispatch = vi.spyOn(EditorView.prototype, "dispatch");
		mount("plain\ntext");
		await Promise.resolve();
		await Promise.resolve();
		expect(logged).not.toHaveBeenCalled();
		expect(scrollMargins(dispatch)).toEqual([]);
		logged.mockRestore();
		dispatch.mockRestore();
	});

	it("scrolls to the next conflict after resolving one", () => {
		const view = mount(
			lines(
				"<<<<<<< a",
				"1",
				"=======",
				"2",
				">>>>>>> a",
				"<<<<<<< b",
				"3",
				"=======",
				"4",
				">>>>>>> b",
			),
		);
		const dispatch = vi.spyOn(view, "dispatch");
		press(actionButton(view, "current", 0));
		expect(scrollMargins(dispatch)).toEqual([
			[view.state.doc.line(3).from, "start"],
		]);
	});

	it("wraps to the first remaining conflict after resolving the last one", () => {
		const view = mount(
			lines(
				"<<<<<<< a",
				"1",
				"=======",
				"2",
				">>>>>>> a",
				"<<<<<<< b",
				"3",
				"=======",
				"4",
				">>>>>>> b",
			),
		);
		const dispatch = vi.spyOn(view, "dispatch");
		press(actionButton(view, "current", 1));
		expect(scrollMargins(dispatch)).toEqual([
			[view.state.doc.line(2).from, "start"],
		]);
	});

	it("does not scroll when the last conflict is resolved", () => {
		const view = mount(SINGLE);
		const dispatch = vi.spyOn(view, "dispatch");
		press(actionButton(view, "current"));
		expect(scrollMargins(dispatch)).toEqual([]);
	});

	it("focuses the editor and scrolls when jumping to a conflict", () => {
		const view = mount(
			lines(
				"<<<<<<< a",
				"1",
				"=======",
				"2",
				">>>>>>> a",
				"<<<<<<< b",
				"3",
				"=======",
				"4",
				">>>>>>> b",
			),
		);
		const focus = vi.spyOn(view, "focus");
		const dispatch = vi.spyOn(view, "dispatch");
		press(
			view.dom
				.querySelectorAll(".cm-conflict-bar")[0]
				.querySelectorAll(".cm-conflict-navbtn")[1],
		);
		expect(focus).toHaveBeenCalledOnce();
		expect(scrollMargins(dispatch)).toEqual([
			[view.state.doc.line(7).from, "start"],
		]);
	});
});

describe("conflict bar redraw", () => {
	const TWO = lines(
		"<<<<<<< a",
		"1",
		"=======",
		"2",
		">>>>>>> a",
		"gap",
		"<<<<<<< b",
		"3",
		"=======",
		"4",
		">>>>>>> b",
	);

	function barTexts(view: EditorView): (string | null)[] {
		return [...view.dom.querySelectorAll(".cm-conflict-count")].map(
			(count) => count.textContent,
		);
	}

	it("keeps the bar element across an edit that leaves the region alone", () => {
		const view = mount(TWO);
		const before = view.dom.querySelector(".cm-conflict-bar");
		view.dispatch({
			changes: { from: view.state.doc.length, insert: "\nend" },
		});
		expect(view.dom.querySelector(".cm-conflict-bar")).toBe(before);
	});

	it("redraws the bar when the region moves", () => {
		const view = mount(lines("<<<<<<< a", "1", "=======", "2", ">>>>>>> a"));
		view.dispatch({ changes: { from: 0, insert: "zz\n" } });
		press(actionButton(view, "current"));
		expect(view.state.doc.toString()).toBe("zz\n1");
	});

	it("redraws the bar when the current text is edited", () => {
		const view = mount(lines("<<<<<<< a", "1", "=======", "2", ">>>>>>> a"));
		view.dispatch({ changes: { from: 11, insert: "1" } });
		press(actionButton(view, "current"));
		expect(view.state.doc.toString()).toBe("11");
	});

	it("redraws the bar when the incoming text is edited", () => {
		const view = mount(lines("<<<<<<< a", "1", "=======", "2", ">>>>>>> a"));
		view.dispatch({ changes: { from: 21, insert: "2" } });
		press(actionButton(view, "incoming"));
		expect(view.state.doc.toString()).toBe("22");
	});

	it("renumbers a bar whose region kept its place but not its index", () => {
		const view = mount(TWO);
		const first = view.state.doc.line(1);
		const filler = "x".repeat(
			first.length + view.state.doc.line(5).to - first.to,
		);
		view.dispatch({
			changes: [
				{ from: first.from, to: view.state.doc.line(5).to, insert: filler },
				{
					from: view.state.doc.length,
					insert: "\n<<<<<<< c\n5\n=======\n6\n>>>>>>> c",
				},
			],
		});
		expect(barTexts(view)).toEqual(["1/2", "2/2"]);
	});

	it("recounts the bars when a region is added", () => {
		const view = mount(TWO);
		view.dispatch({
			changes: {
				from: view.state.doc.length,
				insert: "\n<<<<<<< c\n5\n=======\n6\n>>>>>>> c",
			},
		});
		expect(barTexts(view)).toEqual(["1/3", "2/3", "3/3"]);
	});
});

describe("conflict navigation with three regions", () => {
	const THREE = lines(
		"<<<<<<< a",
		"1",
		"=======",
		"2",
		">>>>>>> a",
		"<<<<<<< b",
		"3",
		"=======",
		"4",
		">>>>>>> b",
		"<<<<<<< c",
		"5",
		"=======",
		"6",
		">>>>>>> c",
	);

	function navButtons(view: EditorView, bar: number): Element[] {
		return [
			...view.dom
				.querySelectorAll(".cm-conflict-bar")
				[bar].querySelectorAll(".cm-conflict-navbtn"),
		];
	}

	it("steps back one region at a time", () => {
		const view = mount(THREE);
		press(navButtons(view, 1)[0]);
		expect(view.state.selection.main.head).toBe(view.state.doc.line(2).from);
		press(navButtons(view, 2)[0]);
		expect(view.state.selection.main.head).toBe(view.state.doc.line(7).from);
	});

	it("labels the arrows and keeps the container", () => {
		const view = mount(THREE);
		const [prev, next] = navButtons(view, 0);
		expect(prev.textContent).toBe("↑");
		expect(next.textContent).toBe("↓");
		expect(view.dom.querySelector(".cm-conflict-nav")).not.toBeNull();
		expect(press(prev)).toBe(false);
		expect(press(next)).toBe(false);
	});
});
