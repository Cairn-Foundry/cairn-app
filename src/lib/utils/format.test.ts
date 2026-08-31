// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import {
	formatBytes,
	formatClock,
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

	it("drops accented letters rather than transliterating them", () => {
		expect(slugify("Créer une instance")).toBe("cr-er-une-instance");
	});

	it("drops emoji and non-latin scripts", () => {
		expect(slugify("fix: café")).toBe("fix-caf");
		expect(slugify("日本語")).toBe("");
	});

	it("collapses a newline or a tab like any other separator", () => {
		expect(slugify("foo\n\tbar")).toBe("foo-bar");
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

	it("falls back to zero rather than rendering NaN", () => {
		expect(formatBytes(Number.NaN)).toBe("0 B");
		expect(formatBytes(Number.NEGATIVE_INFINITY)).toBe("0 B");
	});

	it("keeps a positive infinity out of the unit ladder", () => {
		expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("0 B");
	});
});

describe("formatDate", () => {
	const parts = (ts: number) =>
		new Intl.DateTimeFormat(undefined, {
			dateStyle: "medium",
			timeStyle: "short",
		}).formatToParts(new Date(ts));

	it("carries the date and the time of the timestamp", () => {
		const ts = Date.UTC(2024, 2, 14, 15, 9);
		const out = formatDate(ts);
		const wanted = parts(ts).filter((p) => p.type !== "literal");
		expect(wanted.length).toBeGreaterThan(0);
		for (const part of wanted) expect(out).toContain(part.value);
	});

	it("renders the epoch rather than todays date", () => {
		expect(formatDate(0)).not.toBe(formatDate(Date.UTC(2024, 2, 14)));
		for (const part of parts(0).filter((p) => p.type !== "literal")) {
			expect(formatDate(0)).toContain(part.value);
		}
	});

	it("says nothing when the timestamp is not a number", () => {
		expect(formatDate(Number.NaN)).toBe("");
		expect(formatDate(Number.POSITIVE_INFINITY)).toBe("");
	});
});

describe("formatClock", () => {
	const utc = (ts: number, locale: string) =>
		new Intl.DateTimeFormat(locale, {
			hour: "2-digit",
			minute: "2-digit",
			timeZone: "UTC",
		}).format(new Date(ts));

	it("stamps a message with hours and minutes", () => {
		const ts = Date.UTC(2024, 0, 1, 9, 5);
		expect(formatClock(ts, "en-GB")).toMatch(/^\d{2}:\d{2}$/);
		expect(utc(ts, "en-GB")).toBe("09:05");
	});

	it("follows the locale it is given", () => {
		const ts = Date.UTC(2024, 0, 1, 13, 30);
		expect(utc(ts, "en-GB")).toBe("13:30");
		expect(utc(ts, "en-US")).toBe("01:30 PM");
	});

	it("pads a single digit hour", () => {
		expect(utc(Date.UTC(2024, 0, 1, 0, 0), "en-GB")).toBe("00:00");
		expect(formatClock(Date.UTC(2024, 0, 1, 0, 0), "en-GB")).toMatch(
			/^\d{2}:\d{2}$/,
		);
	});

	it("says nothing when the timestamp is not a number", () => {
		expect(formatClock(Number.NaN, "en-GB")).toBe("");
		expect(formatClock(Number.NEGATIVE_INFINITY, "en-GB")).toBe("");
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

	it("groups exactly at each thousand boundary", () => {
		expect(formatCount(100)).toBe("100");
		expect(formatCount(999999)).toBe("999 999");
		expect(formatCount(1000000)).toBe("1 000 000");
	});

	it("rounds a fractional count", () => {
		expect(formatCount(1000.6)).toBe("1 001");
	});

	it("falls back to zero rather than rendering NaN", () => {
		expect(formatCount(Number.NaN)).toBe("0");
		expect(formatCount(Number.POSITIVE_INFINITY)).toBe("0");
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

	it("switches unit exactly at each boundary", () => {
		expect(formatDuration(9999)).toBe("10.0s");
		expect(formatDuration(10000)).toBe("10s");
		expect(formatDuration(59999)).toBe("60s");
		expect(formatDuration(60000)).toBe("1min");
	});

	it("clamps a negative duration", () => {
		expect(formatDuration(-5000)).toBe("0.0s");
	});

	it("falls back to zero rather than rendering NaN", () => {
		expect(formatDuration(Number.NaN)).toBe("0.0s");
		expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("0.0s");
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

	it("switches precision exactly at each boundary", () => {
		expect(formatUsd(0.0099)).toBe("$0.0099");
		expect(formatUsd(0.01)).toBe("$0.01");
		expect(formatUsd(99.99)).toBe("$99.99");
		expect(formatUsd(100)).toBe("$100");
	});

	it("keeps a refund negative", () => {
		expect(formatUsd(-4.5)).toBe("$-4.50");
		expect(formatUsd(-0.0032)).toBe("$-0.0032");
	});

	it("falls back to zero rather than rendering NaN", () => {
		expect(formatUsd(Number.NaN)).toBe("$0");
		expect(formatUsd(Number.NEGATIVE_INFINITY)).toBe("$0");
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

	it("switches unit exactly at each boundary", () => {
		expect(formatTokens(9999)).toBe("9 999");
		expect(formatTokens(10000)).toBe("10k");
		expect(formatTokens(999_999)).toBe("1000k");
		expect(formatTokens(1_000_000)).toBe("1.0M");
		expect(formatTokens(9_999_999)).toBe("10.0M");
		expect(formatTokens(10_000_000)).toBe("10M");
	});

	it("keeps a negative count negative", () => {
		expect(formatTokens(-1500)).toBe("-1 500");
		expect(formatTokens(-2_000_000)).toBe("-2.0M");
	});

	it("falls back to zero rather than rendering NaN", () => {
		expect(formatTokens(Number.NaN)).toBe("0");
		expect(formatTokens(Number.POSITIVE_INFINITY)).toBe("0");
	});
});
