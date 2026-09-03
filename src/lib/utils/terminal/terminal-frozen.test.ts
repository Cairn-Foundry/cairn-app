// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { capFrozen, FROZEN_MAX } from "./terminal-manager";

describe("capFrozen", () => {
	it("leaves a backlog under the cap untouched", () => {
		expect(capFrozen("hello")).toBe("hello");
	});

	it("keeps the newest characters once over the cap", () => {
		const text = `${"o".repeat(FROZEN_MAX)}new`;
		const capped = capFrozen(text);
		expect(capped).toHaveLength(FROZEN_MAX);
		expect(capped.endsWith("new")).toBe(true);
	});

	it("stays bounded across repeated hibernate cycles", () => {
		let frozen = "";
		for (let i = 0; i < 50; i++) {
			frozen = capFrozen("x".repeat(FROZEN_MAX / 2) + frozen);
		}
		expect(frozen.length).toBeLessThanOrEqual(FROZEN_MAX);
	});
});
