import { describe, expect, it } from "vitest";
import {
	formatBytes,
	formatCount,
	formatDate,
	formatDuration,
	formatTokens,
	formatUsd,
	slugify,
} from "./format";

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

describe("formatCount", () => {
	it("leaves a small number alone", () => {
		expect(formatCount(999)).toBe("999");
	});

	it("groups thousands with a space", () => {
		expect(formatCount(1000)).toBe("1 000");
		expect(formatCount(1234567)).toBe("1 234 567");
	});

	it("keeps the sign in front of the groups", () => {
		expect(formatCount(-12345)).toBe("-12 345");
	});
});

describe("formatDuration", () => {
	it("keeps a tenth of a second under ten seconds", () => {
		expect(formatDuration(2400)).toBe("2.4s");
	});

	it("rounds to the second below a minute", () => {
		expect(formatDuration(45400)).toBe("45s");
	});

	it("splits minutes and seconds past a minute", () => {
		expect(formatDuration(122000)).toBe("2min2s");
	});

	it("drops the seconds when there are none", () => {
		expect(formatDuration(120000)).toBe("2min");
	});

	it("goes to hours and minutes past an hour", () => {
		expect(formatDuration(3600000)).toBe("1h");
		expect(formatDuration(3900000)).toBe("1h5min");
	});
});

describe("formatUsd", () => {
	it("keeps enough decimals for a single cheap turn", () => {
		expect(formatUsd(0.0032)).toBe("$0.0032");
	});

	it("reads as money at the scale of a day of work", () => {
		expect(formatUsd(4.5)).toBe("$4.50");
	});

	it("drops the decimals once the amount is large", () => {
		expect(formatUsd(1234.56)).toBe("$1 235");
	});

	it("says nothing rather than $0.0000 when nothing was spent", () => {
		expect(formatUsd(0)).toBe("$0");
	});
});

describe("formatTokens", () => {
	it("groups small counts the ordinary way", () => {
		expect(formatTokens(9999)).toBe("9 999");
	});

	it("abbreviates thousands past ten thousand", () => {
		expect(formatTokens(12480)).toBe("12k");
	});

	it("abbreviates millions with a decimal until ten million", () => {
		expect(formatTokens(1_250_000)).toBe("1.3M");
		expect(formatTokens(12_500_000)).toBe("13M");
	});
});
