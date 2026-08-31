// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { integrationKey } from "./instance-key";

describe("integrationKey", () => {
	it("joins the project and the instance with a colon", () => {
		expect(integrationKey("p1", "i1")).toBe("p1:i1");
	});

	it("keeps two instances of one project apart", () => {
		expect(integrationKey("p", "a")).not.toBe(integrationKey("p", "b"));
	});

	it("keeps the same instance id in two projects apart", () => {
		expect(integrationKey("a", "i")).not.toBe(integrationKey("b", "i"));
	});

	/**
	 * A colon inside an id would make two different pairs share a key. Both ids
	 * are `crypto.randomUUID()`, which never contains one, so the ambiguity is
	 * unreachable - and the key format is persisted, so it is documented here
	 * rather than changed.
	 */
	it("is ambiguous only for ids that carry a colon, which UUIDs never do", () => {
		expect(integrationKey("a:b", "c")).toBe(integrationKey("a", "b:c"));
		expect(crypto.randomUUID()).not.toContain(":");
	});

	it("handles an empty half", () => {
		expect(integrationKey("", "i")).toBe(":i");
		expect(integrationKey("p", "")).toBe("p:");
	});
});
