// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { SYNTAX_TOKEN_KEYS } from "$lib/utils/editor/syntax-tokens";
import { PREVIEW_LINES } from "./syntax-theme";

const previewed = new Set(
	PREVIEW_LINES.flat()
		.map((segment) => segment.token)
		.filter(Boolean),
);

describe("PREVIEW_LINES", () => {
	it.each(SYNTAX_TOKEN_KEYS)("previews the %s category", (key) => {
		expect(previewed.has(key)).toBe(true);
	});

	it("previews nothing that is not customizable", () => {
		for (const token of previewed) {
			expect(SYNTAX_TOKEN_KEYS).toContain(token);
		}
	});
});
