// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { inflateTree } from "./file-service";

describe("inflateTree", () => {
	it("rebuilds the hierarchy and the relative paths", () => {
		const tree = inflateTree({
			names: "src/\nlib/\na.ts\nb.ts\nREADME.md",
			parents: [-1, 0, 1, 0, -1],
			sep: "/",
		});
		expect(tree.map((n) => n.path)).toEqual(["src", "README.md"]);
		expect(tree[0].children?.map((n) => n.path)).toEqual([
			"src/lib",
			"src/b.ts",
		]);
		expect(tree[0].children?.[0].children?.[0]).toEqual({
			name: "a.ts",
			path: "src/lib/a.ts",
			isDir: false,
		});
		expect(tree[1].children).toBeUndefined();
	});

	it("answers an empty tree for an empty walk", () => {
		expect(inflateTree({ names: "", parents: [], sep: "/" })).toEqual([]);
	});
});
