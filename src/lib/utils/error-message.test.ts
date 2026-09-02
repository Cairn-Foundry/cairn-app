// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { errorMessage } from "$lib/utils/error-message";

describe("errorMessage", () => {
	it("reads the message of an Error", () => {
		expect(errorMessage(new Error("boom"))).toBe("boom");
	});

	it("passes a string rejection through", () => {
		expect(errorMessage("the CLI did not answer")).toBe(
			"the CLI did not answer",
		);
	});

	it("reads the usual message field of an object rejection", () => {
		expect(errorMessage({ message: "invalid args" })).toBe("invalid args");
		expect(errorMessage({ error: "unknown command" })).toBe("unknown command");
	});

	it("falls back to JSON rather than [object Object]", () => {
		expect(errorMessage({ code: 42 })).toBe('{"code":42}');
	});

	it("ignores an empty message field", () => {
		expect(errorMessage({ message: "  ", reason: "no provider" })).toBe(
			"no provider",
		);
	});

	it("survives a value JSON cannot render", () => {
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		expect(errorMessage(cyclic)).toBe("[object Object]");
	});

	it("renders null and undefined without throwing", () => {
		expect(errorMessage(null)).toBe("null");
		expect(errorMessage(undefined)).toBe("undefined");
	});
});
