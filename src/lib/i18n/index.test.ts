// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getGreetingPools, getLocale, setLocale, t } from "./index";

const reloadMock = vi.fn();

beforeAll(() => {
	vi.stubGlobal("location", { ...window.location, reload: reloadMock });
});

beforeEach(() => {
	localStorage.clear();
	reloadMock.mockClear();
});

describe("t", () => {
	it("returns a string for a known key", () => {
		expect(typeof t("common.close")).toBe("string");
	});

	it("returns the English translation by default", () => {
		expect(t("common.close")).toBe("Close");
	});

	it("returns a function for function-valued keys", () => {
		expect(typeof t("common.stepOf")).toBe("function");
	});

	it("function-valued keys produce the expected string", () => {
		const stepOf = t("common.stepOf") as (
			step: number,
			total: number,
		) => string;
		expect(stepOf(1, 3)).toBe("Step 1 of 3");
	});
});

describe("t", () => {
	it("falls back to the key itself and logs when the key is unknown", () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		expect(t("nope.missing" as Parameters<typeof t>[0])).toBe("nope.missing");
		expect(spy).toHaveBeenCalledOnce();
		spy.mockRestore();
	});
});

describe("getGreetingPools", () => {
	it("returns the English pools by default", () => {
		const pools = getGreetingPools();
		expect(pools.morning.length).toBeGreaterThan(0);
		expect(pools.splashes.length).toBeGreaterThan(0);
	});

	it("returns the French pools when French is stored", () => {
		const english = getGreetingPools();
		localStorage.setItem("cairn:locale", "fr");
		expect(getGreetingPools()).not.toEqual(english);
	});
});

describe("getLocale", () => {
	it("returns the default locale when nothing is stored", () => {
		expect(getLocale()).toBe("en");
	});

	it("returns stored locale", () => {
		localStorage.setItem("cairn:locale", "fr");
		expect(getLocale()).toBe("fr");
	});

	it("falls back to default for unknown stored value", () => {
		localStorage.setItem("cairn:locale", "xx");
		expect(getLocale()).toBe("en");
	});
});

describe("without localStorage", () => {
	it("falls back to the default locale and still reloads", () => {
		vi.stubGlobal("localStorage", undefined);
		expect(getLocale()).toBe("en");
		setLocale("fr");
		expect(reloadMock).toHaveBeenCalledOnce();
		vi.unstubAllGlobals();
		vi.stubGlobal("location", { ...window.location, reload: reloadMock });
	});
});

describe("setLocale", () => {
	it("persists locale to localStorage", () => {
		setLocale("fr");
		expect(localStorage.getItem("cairn:locale")).toBe("fr");
	});

	it("triggers a page reload", () => {
		setLocale("fr");
		expect(reloadMock).toHaveBeenCalledOnce();
	});
});
