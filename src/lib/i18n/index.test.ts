import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getLocale, setLocale, t } from "./index";

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
