import { describe, expect, it } from "vitest";
import {
	buildHandoffTranscript,
	priorTurns,
	withHandoffContext,
} from "./handoff";

const msg = (role: string, content: string) => ({ role, content });

describe("priorTurns", () => {
	it("keeps every exchanged turn, including the most recent answer", () => {
		const turns = priorTurns([
			msg("user", "what is your model"),
			msg("agent", "I am Claude Haiku 4.5"),
		]);
		expect(turns.map((m) => m.content)).toEqual([
			"what is your model",
			"I am Claude Haiku 4.5",
		]);
	});

	it("drops system lines, which are not turns", () => {
		const turns = priorTurns([
			msg("system", "Instance started"),
			msg("user", "hello"),
			msg("system", "Switched to Mistral API"),
			msg("agent", "hi"),
		]);
		expect(turns.map((m) => m.role)).toEqual(["user", "agent"]);
	});

	it("keeps only the last N turns", () => {
		const many = Array.from({ length: 30 }, (_, i) => msg("user", `m${i}`));
		expect(priorTurns(many, 2).map((m) => m.content)).toEqual(["m28", "m29"]);
	});

	it("returns nothing for a conversation that has not started", () => {
		expect(priorTurns([])).toEqual([]);
	});
});

describe("buildHandoffTranscript", () => {
	it("keeps user and agent turns, in order, labelled", () => {
		const out = buildHandoffTranscript([
			msg("user", "hello"),
			msg("agent", "hi there"),
		]);
		expect(out).toBe("user: hello\n\nassistant: hi there");
	});

	it("drops system lines and empty content", () => {
		const out = buildHandoffTranscript([
			msg("system", "Switched to OpenAI"),
			msg("user", "  "),
			msg("user", "real question"),
		]);
		expect(out).toBe("user: real question");
	});

	it("keeps only the last N messages", () => {
		const many = Array.from({ length: 30 }, (_, i) => msg("user", `m${i}`));
		const out = buildHandoffTranscript(many, 3);
		expect(out).toBe("user: m27\n\nuser: m28\n\nuser: m29");
	});

	it("drops the oldest turns first when over the character cap", () => {
		const out = buildHandoffTranscript(
			[msg("user", "a".repeat(50)), msg("user", "keep me")],
			10,
			40,
		);
		expect(out).toBe("user: keep me");
	});

	it("returns nothing when there is nothing to carry", () => {
		expect(buildHandoffTranscript([])).toBe("");
		expect(buildHandoffTranscript([msg("system", "x")])).toBe("");
	});

	it("never exceeds the character cap", () => {
		const many = Array.from({ length: 40 }, (_, i) =>
			msg(i % 2 === 0 ? "user" : "agent", "x".repeat(200)),
		);
		expect(buildHandoffTranscript(many, 40, 1000).length).toBeLessThanOrEqual(
			1000 + 40 * 2,
		);
	});
});

describe("withHandoffContext", () => {
	it("leaves the message untouched when there is no transcript", () => {
		expect(withHandoffContext("do the thing", "")).toBe("do the thing");
	});

	it("puts the prompt after the context block", () => {
		const out = withHandoffContext("do the thing", "user: earlier");
		expect(out).toContain("<earlier-conversation>");
		expect(out).toContain("user: earlier");
		expect(out.endsWith("do the thing")).toBe(true);
	});
});
