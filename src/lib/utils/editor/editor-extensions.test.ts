// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
	openSearchPanel,
	SearchQuery,
	search,
	setSearchQuery,
} from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { searchMatchLines } from "./editor-extensions";

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
