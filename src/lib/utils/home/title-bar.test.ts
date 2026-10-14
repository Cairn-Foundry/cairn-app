// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { titleBarFillColor } from "./title-bar";

const base = { accentColor: "#6c8eff", titleBarColor: "#123456" };

describe("titleBarFillColor", () => {
	it("follows the theme", () => {
		expect(
			titleBarFillColor({ ...base, titleBarFill: "theme" }, "#ff0000"),
		).toBeNull();
	});

	it("takes the accent", () => {
		expect(titleBarFillColor({ ...base, titleBarFill: "accent" }, null)).toBe(
			"#6c8eff",
		);
	});

	it("takes the project's colour, and the theme outside a project", () => {
		expect(
			titleBarFillColor({ ...base, titleBarFill: "project" }, "#ff0000"),
		).toBe("#ff0000");
		expect(
			titleBarFillColor({ ...base, titleBarFill: "project" }, null),
		).toBeNull();
	});

	it("takes the chosen colour, and the theme until one is chosen", () => {
		expect(titleBarFillColor({ ...base, titleBarFill: "custom" }, null)).toBe(
			"#123456",
		);
		expect(
			titleBarFillColor(
				{ ...base, titleBarFill: "custom", titleBarColor: "" },
				null,
			),
		).toBeNull();
	});
});
