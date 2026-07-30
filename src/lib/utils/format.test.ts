import { describe, expect, it } from "vitest";
import { formatBytes, formatDate, slugify } from "./format";

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

describe("formatBytes", () => {
	it("keeps bytes without a decimal", () => {
		expect(formatBytes(0)).toBe("0 B");
		expect(formatBytes(512)).toBe("512 B");
	});

	it("switches unit at 1024", () => {
		expect(formatBytes(1024)).toBe("1.0 KB");
		expect(formatBytes(1023)).toBe("1023 B");
	});

	it("formats megabytes with one decimal", () => {
		expect(formatBytes(48 * 1024 * 1024)).toBe("48.0 MB");
		expect(formatBytes(1_572_864)).toBe("1.5 MB");
	});

	it("caps at gigabytes", () => {
		expect(formatBytes(5 * 1024 ** 4)).toBe("5120.0 GB");
	});

	it("clamps negative values", () => {
		expect(formatBytes(-10)).toBe("0 B");
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
