// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { javascript } from "@codemirror/lang-javascript";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { stickyLinesAt } from "./editor-sticky-scroll";

const SOURCE = `class Service {
	fetchUser(id) {
		if (id > 0) {
			return id;
		}
		return null;
	}
}
`;

function stateOf(doc: string): EditorState {
	return EditorState.create({ doc, extensions: [javascript()] });
}

/** Offset of the first character of `line` (1-based), like the gutter numbers. */
function startOf(state: EditorState, line: number): number {
	return state.doc.line(line).from;
}

describe("stickyLinesAt", () => {
	it("pins every enclosing scope, outermost first", () => {
		const state = stateOf(SOURCE);
		expect(
			stickyLinesAt(state, startOf(state, 4)).map((l) => l.number),
		).toEqual([1, 2, 3]);
	});

	it("drops a scope once its body is left", () => {
		const state = stateOf(SOURCE);
		expect(
			stickyLinesAt(state, startOf(state, 6)).map((l) => l.number),
		).toEqual([1, 2]);
	});

	it("pins nothing at the top level", () => {
		const state = stateOf(SOURCE);
		expect(stickyLinesAt(state, startOf(state, 1))).toEqual([]);
	});

	it("carries the line text so the header can render it", () => {
		const state = stateOf(SOURCE);
		expect(stickyLinesAt(state, startOf(state, 4))[0]).toEqual({
			number: 1,
			text: "class Service {",
		});
	});
});
