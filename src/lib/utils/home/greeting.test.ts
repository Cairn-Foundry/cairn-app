// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from "vitest";
import { getGreetingPools } from "$lib/i18n";
import { pickGreeting, pickTagline } from "./greeting";

const pools = getGreetingPools();

/** Monday through Friday at a fixed hour, so only the hour bucket varies. */
const weekday = (hour: number) => new Date(2024, 0, 3, hour, 0);

afterEach(() => {
	vi.restoreAllMocks();
});

describe("pickGreeting", () => {
	it("greets the morning from five to noon", () => {
		for (const hour of [5, 8, 11]) {
			expect(pools.morning, `${hour}h`).toContain(pickGreeting(weekday(hour)));
		}
	});

	it("greets the afternoon from noon to six", () => {
		for (const hour of [12, 15, 17]) {
			expect(pools.afternoon, `${hour}h`).toContain(
				pickGreeting(weekday(hour)),
			);
		}
	});

	it("greets the evening from six to eleven", () => {
		for (const hour of [18, 21, 22]) {
			expect(pools.evening, `${hour}h`).toContain(pickGreeting(weekday(hour)));
		}
	});

	it("greets the night on either side of midnight", () => {
		for (const hour of [23, 0, 3, 4]) {
			expect(pools.night, `${hour}h`).toContain(pickGreeting(weekday(hour)));
		}
	});

	it("switches bucket exactly on the hour boundary", () => {
		expect(pools.night).toContain(pickGreeting(weekday(4)));
		expect(pools.morning).toContain(pickGreeting(weekday(5)));
		expect(pools.morning).toContain(pickGreeting(weekday(11)));
		expect(pools.afternoon).toContain(pickGreeting(weekday(12)));
		expect(pools.afternoon).toContain(pickGreeting(weekday(17)));
		expect(pools.evening).toContain(pickGreeting(weekday(18)));
		expect(pools.evening).toContain(pickGreeting(weekday(22)));
		expect(pools.night).toContain(pickGreeting(weekday(23)));
	});

	it("greets the weekend whatever the hour, ahead of the time of day", () => {
		for (const day of [6, 7]) {
			for (const hour of [3, 9, 14, 20]) {
				const date = new Date(2024, 0, day, hour, 0);
				expect(pools.weekend, `${day}/${hour}h`).toContain(pickGreeting(date));
			}
		}
	});

	it("picks within the bucket, using the whole pool over many draws", () => {
		const seen = new Set<string>();
		for (let i = 0; i < 200; i++) seen.add(pickGreeting(weekday(9)));
		expect(seen.size).toBeGreaterThan(1);
		for (const greeting of seen) expect(pools.morning).toContain(greeting);
	});

	it("takes the first of a pool when the draw lands at zero", () => {
		vi.spyOn(Math, "random").mockReturnValue(0);
		expect(pickGreeting(weekday(9))).toBe(pools.morning[0]);
	});

	it("stays inside the pool when the draw lands just under one", () => {
		vi.spyOn(Math, "random").mockReturnValue(0.999999);
		expect(pickGreeting(weekday(9))).toBe(pools.morning.at(-1));
	});

	it("reads the clock itself when given no date", () => {
		expect(typeof pickGreeting()).toBe("string");
		expect(pickGreeting().length).toBeGreaterThan(0);
	});
});

describe("pickTagline", () => {
	it("picks from the splash pool", () => {
		expect(pools.splashes).toContain(pickTagline());
	});

	it("varies across visits rather than returning a fixed line", () => {
		const seen = new Set<string>();
		for (let i = 0; i < 200; i++) seen.add(pickTagline());
		expect(seen.size).toBeGreaterThan(1);
	});

	it("takes the first splash when the draw lands at zero", () => {
		vi.spyOn(Math, "random").mockReturnValue(0);
		expect(pickTagline()).toBe(pools.splashes[0]);
	});
});
