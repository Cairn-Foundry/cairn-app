// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import {
	recallExpansion,
	rememberExpansion,
} from "$lib/utils/git/diff-expansion-memory";

describe("diff expansion memory", () => {
	it("gives back what was remembered for a signature", () => {
		const value = { expansions: [{ top: 20, bottom: 0 }], fileLines: ["a"] };
		rememberExpansion("sig-a", value);
		expect(recallExpansion("sig-a")).toBe(value);
		expect(recallExpansion("sig-other")).toBeUndefined();
	});

	it("forgets the oldest entry past its cap", () => {
		for (let i = 0; i < 101; i++)
			rememberExpansion(`cap-${i}`, { expansions: [], fileLines: [] });
		expect(recallExpansion("cap-0")).toBeUndefined();
		expect(recallExpansion("cap-100")).toBeDefined();
	});
});
