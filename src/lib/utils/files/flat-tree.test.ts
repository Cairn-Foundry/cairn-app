// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { flattenTree, soleDifference, spliceFolder } from "./flat-tree";

interface N {
	path: string;
	isDir?: boolean;
	children?: N[] | null;
}

const dir = (path: string, children: N[]): N => ({
	path,
	isDir: true,
	children,
});
const file = (path: string): N => ({ path });

const tree: N[] = [
	dir("a", [file("a/1.ts"), dir("a/b", [file("a/b/2.ts")]), file("a/3.ts")]),
	file("z.ts"),
];

const paths = (open: Set<string>) =>
	flattenTree(tree, open).map((r) => r.node.path);

describe("flattenTree", () => {
	it("shows a folder's children only while it is open", () => {
		expect(paths(new Set())).toEqual(["a", "z.ts"]);
		expect(paths(new Set(["a"]))).toEqual([
			"a",
			"a/1.ts",
			"a/b",
			"a/3.ts",
			"z.ts",
		]);
	});

	it("records the depth of each row", () => {
		const rows = flattenTree(tree, new Set(["a", "a/b"]));
		expect(rows.map((r) => r.depth)).toEqual([0, 1, 1, 2, 1, 0]);
	});
});

describe("soleDifference", () => {
	it("names the folder that opened", () => {
		expect(soleDifference(new Set(["a"]), new Set(["a", "a/b"]))).toEqual({
			path: "a/b",
			opened: true,
		});
	});

	it("names the folder that closed", () => {
		expect(soleDifference(new Set(["a", "a/b"]), new Set(["a"]))).toEqual({
			path: "a/b",
			opened: false,
		});
	});

	it("refuses anything that is not exactly one change", () => {
		expect(soleDifference(new Set(["a"]), new Set(["a"]))).toBeNull();
		expect(soleDifference(new Set(), new Set(["a", "b"]))).toBeNull();
		// Same size, different contents: one opened and one closed at once.
		expect(soleDifference(new Set(["a"]), new Set(["b"]))).toBeNull();
	});
});

/* The property that matters: splicing must never disagree with a rebuild. */
describe("spliceFolder", () => {
	it("matches a full rebuild when a folder opens", () => {
		const before = new Set(["a"]);
		const after = new Set(["a", "a/b"]);
		const spliced = spliceFolder(flattenTree(tree, before), after, {
			path: "a/b",
			opened: true,
		});
		expect(spliced).toEqual(flattenTree(tree, after));
	});

	it("matches a full rebuild when a folder closes", () => {
		const before = new Set(["a", "a/b"]);
		const after = new Set(["a"]);
		const spliced = spliceFolder(flattenTree(tree, before), after, {
			path: "a/b",
			opened: false,
		});
		expect(spliced).toEqual(flattenTree(tree, after));
	});

	it("removes the whole subtree, not just the first level", () => {
		const before = new Set(["a", "a/b"]);
		const after = new Set<string>();
		const spliced = spliceFolder(flattenTree(tree, before), after, {
			path: "a",
			opened: false,
		});
		expect(spliced?.map((r) => r.node.path)).toEqual(["a", "z.ts"]);
	});

	it("asks for a rebuild when the folder is not on screen", () => {
		expect(
			spliceFolder(flattenTree(tree, new Set()), new Set(["a/b"]), {
				path: "a/b",
				opened: true,
			}),
		).toBeNull();
	});

	it("asks for a rebuild when the rows contradict the change", () => {
		// 'a' already shows its children, so it cannot be the folder that opened.
		expect(
			spliceFolder(flattenTree(tree, new Set(["a"])), new Set(["a"]), {
				path: "a",
				opened: true,
			}),
		).toBeNull();
	});
});
