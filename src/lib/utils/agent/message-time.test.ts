import { describe, expect, it } from "vitest";
import { formatClock, formatDate } from "$lib/utils/format";
import { messageClock, messageDate } from "./message-time";

const TS = new Date(2026, 0, 15, 10, 2, 0).getTime();

describe("messageClock", () => {
	it("reads the clock off the timestamp", () => {
		expect(messageClock({ ts: TS })).toBe(formatClock(TS));
	});

	it("shows a message written before turns carried a date as it was written", () => {
		expect(messageClock({ time: "10:02" })).toBe("10:02");
	});

	it("prefers the timestamp when a message carries both", () => {
		expect(messageClock({ ts: TS, time: "23:59" })).toBe(formatClock(TS));
	});

	it("says nothing rather than a fake time when there is neither", () => {
		expect(messageClock({})).toBe("");
	});
});

describe("messageDate", () => {
	it("gives the full date once there is a timestamp", () => {
		expect(messageDate({ ts: TS })).toBe(formatDate(TS));
	});

	it("cannot invent a day for a legacy clock face", () => {
		expect(messageDate({ time: "10:02" })).toBe("10:02");
	});
});
