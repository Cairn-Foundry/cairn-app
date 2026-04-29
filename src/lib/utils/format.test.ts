import { describe, expect, it } from "vitest";
import { formatDate, slugify } from "./format";

describe("slugify", () => {
	it("lowercases the input", () => {
		expect(slugify("Hello World")).toBe("hello-world");
	});

	it("replaces spaces with hyphens", () => {
		expect(slugify("foo bar baz")).toBe("foo-bar-baz");
	});

	it("removes leading and trailing hyphens", () => {
		expect(slugify("  hello  ")).toBe("hello");
	});

	it("replaces consecutive special chars with a single hyphen", () => {
		expect(slugify("hello---world")).toBe("hello-world");
		expect(slugify("hello!@#world")).toBe("hello-world");
	});

	it("keeps alphanumeric characters intact", () => {
		expect(slugify("abc123")).toBe("abc123");
	});

	it("handles empty string", () => {
		expect(slugify("")).toBe("");
	});

	it("handles string of only special characters", () => {
		expect(slugify("!@#$%")).toBe("");
	});

	it("typical ticket title", () => {
		expect(slugify("Add TOTP authentication")).toBe("add-totp-authentication");
	});
});

describe("formatDate", () => {
	it("returns a non-empty string", () => {
		expect(formatDate(Date.now()).length).toBeGreaterThan(0);
	});

	it("formats a known timestamp without throwing", () => {
		expect(() => formatDate(0)).not.toThrow();
	});
});
