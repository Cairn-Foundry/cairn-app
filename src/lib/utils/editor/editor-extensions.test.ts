// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
	openSearchPanel,
	SearchQuery,
	search,
	setSearchQuery,
} from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { showMinimap } from "@replit/codemirror-minimap";
import { afterEach, describe, expect, it } from "vitest";
import type { ShortcutId } from "#lib/types/shortcuts";
import {
	buildFontSizeTheme,
	buildMinimap,
	buildShortcutKeymap,
	SHORTCUT_COMMANDS,
	searchMatchLines,
} from "./editor-extensions";

const SOURCE = `const alpha = 1;
const beta = 2;
alpha += beta;
`;

let view: EditorView | null = null;

afterEach(() => {
	view?.destroy();
	view = null;
});

/** A real view, because only an open search panel counts as the current search. */
function openViewWith(query: SearchQuery): EditorState {
	view = new EditorView({
		state: EditorState.create({ doc: SOURCE, extensions: [search()] }),
		parent: document.body,
	});
	openSearchPanel(view);
	view.dispatch({ effects: setSearchQuery.of(query) });
	return view.state;
}

describe("searchMatchLines", () => {
	it("reports each line carrying a hit, once per line", () => {
		const state = openViewWith(new SearchQuery({ search: "alpha" }));
		expect(searchMatchLines(state)).toEqual([1, 3]);
	});

	it("finds every line of a repeated match once", () => {
		const state = openViewWith(new SearchQuery({ search: "a" }));
		expect(searchMatchLines(state)).toEqual([1, 2, 3]);
	});

	it("honours case sensitivity", () => {
		const state = openViewWith(new SearchQuery({ search: "ALPHA" }));
		expect(searchMatchLines(state)).toEqual([1, 3]);
	});

	it("reads a regular expression", () => {
		const state = openViewWith(
			new SearchQuery({ search: "beta|alpha", regexp: true }),
		);
		expect(searchMatchLines(state)).toEqual([1, 2, 3]);
	});

	it("reports nothing while the search panel is closed", () => {
		const state = EditorState.create({ doc: SOURCE, extensions: [search()] });
		expect(searchMatchLines(state)).toEqual([]);
	});

	it("reports nothing for an invalid regular expression instead of throwing", () => {
		const state = openViewWith(new SearchQuery({ search: "(", regexp: true }));
		expect(searchMatchLines(state)).toEqual([]);
	});

	it("reports nothing for an empty query", () => {
		const state = openViewWith(new SearchQuery({ search: "" }));
		expect(searchMatchLines(state)).toEqual([]);
	});
});

describe("buildMinimap", () => {
	it("contributes nothing when disabled", () => {
		expect(buildMinimap(false)).toEqual([]);
		expect(buildMinimap(false, { 1: "#ff0000" })).toEqual([]);
	});

	it("registers the minimap with the markers as a gutter", () => {
		const markers = { 2: "#ff0000" };
		const state = EditorState.create({
			extensions: buildMinimap(true, markers),
		});
		const config = state.facet(showMinimap);
		expect(config?.displayText).toBe("blocks");
		expect(config?.showOverlay).toBe("always");
		expect(config?.gutters).toEqual([markers]);
	});

	it("registers the minimap without any gutter when no markers are given", () => {
		const state = EditorState.create({ extensions: buildMinimap(true) });
		const config = state.facet(showMinimap);
		expect(config?.displayText).toBe("blocks");
		expect(config?.gutters).toBeUndefined();
	});
});

describe("searchMatchLines limits", () => {
	it("stops at the marker limit", () => {
		const doc = "a\n".repeat(2100);
		view = new EditorView({
			state: EditorState.create({ doc, extensions: [search()] }),
			parent: document.body,
		});
		openSearchPanel(view);
		view.dispatch({
			effects: setSearchQuery.of(new SearchQuery({ search: "a" })),
		});
		const lines = searchMatchLines(view.state);
		expect(lines).toHaveLength(2000);
		expect(lines[0]).toBe(1);
		expect(lines[1999]).toBe(2000);
	});

	it("stops after a zero-width match instead of looping", () => {
		const state = openViewWith(new SearchQuery({ search: "^", regexp: true }));
		expect(searchMatchLines(state)).toEqual([1]);
	});
});

describe("searchMatchLines with a closed panel", () => {
	it("reports nothing even though a query is set", () => {
		const state = EditorState.create({
			doc: SOURCE,
			extensions: [search()],
		}).update({
			effects: setSearchQuery.of(new SearchQuery({ search: "alpha" })),
		}).state;
		expect(searchMatchLines(state)).toEqual([]);
	});
});

describe("buildFontSizeTheme", () => {
	it("builds one theme per size and reuses it", () => {
		expect(buildFontSizeTheme(13)).toBe(buildFontSizeTheme(13));
		expect(buildFontSizeTheme(13)).not.toBe(buildFontSizeTheme(14));
	});

	it("sets the line numbers smaller than the code", () => {
		view = new EditorView({
			state: EditorState.create({ extensions: [buildFontSizeTheme(17)] }),
			parent: document.body,
		});
		const css = Array.from(document.querySelectorAll("style"))
			.map((style) => style.textContent)
			.join("\n");
		expect(css).toContain("font-size: 17px");
		expect(css).toContain("font-size: 15.5px");
	});
});

describe("the minimap mousedown guard", () => {
	function mousedownOn(className: string): {
		isPrevented: boolean;
		off: () => boolean;
	} {
		view = new EditorView({
			state: EditorState.create({ extensions: buildMinimap(true) }),
			parent: document.body,
		});
		const target = document.createElement("div");
		target.className = className;
		view.dom.appendChild(target);
		const press = () => {
			const event = new MouseEvent("mousedown", {
				bubbles: true,
				cancelable: true,
			});
			target.dispatchEvent(event);
			return event.defaultPrevented;
		};
		return {
			isPrevented: press(),
			off: () => {
				view?.destroy();
				view = null;
				return press();
			},
		};
	}

	it("keeps a press on the minimap from starting a text selection", () => {
		expect(mousedownOn("cm-minimap-gutter").isPrevented).toBe(true);
	});

	it("leaves a press elsewhere alone", () => {
		expect(mousedownOn("cm-content").isPrevented).toBe(false);
	});

	it("stops guarding once the view is destroyed", () => {
		const { off } = mousedownOn("cm-minimap-gutter");
		expect(off()).toBe(false);
	});

	it("creates the minimap element", () => {
		const config = EditorState.create({
			extensions: buildMinimap(true),
		}).facet(showMinimap);
		expect(config?.create({} as EditorView).dom).toBeInstanceOf(HTMLDivElement);
	});
});

describe("buildShortcutKeymap", () => {
	it("binds only the commands that have a binding, under their key", () => {
		const bindings = Object.fromEntries(
			SHORTCUT_COMMANDS.map((command) => [command.id, null]),
		) as Record<
			ShortcutId,
			null | {
				key: string;
				mod: boolean;
				shift: boolean;
				alt: boolean;
				ctrl: boolean;
			}
		>;
		bindings.deleteLine = {
			key: "k",
			mod: true,
			shift: true,
			alt: false,
			ctrl: false,
		};
		const state = EditorState.create({
			extensions: buildShortcutKeymap(bindings),
		});
		const bound = state.facet(keymap).flat();
		const deleteLine = SHORTCUT_COMMANDS.find((c) => c.id === "deleteLine");
		expect(bound).toEqual([{ key: "Mod-Shift-k", run: deleteLine?.run }]);
	});
});
