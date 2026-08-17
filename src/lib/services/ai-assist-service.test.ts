import { describe, expect, it } from "vitest";
import { AnswerCollector, stripCodeFence } from "./ai-assist-service";

/** Replays a run's events in order and returns what the collector kept. */
function collect(events: [source: string, line: string][]): string {
	const collector = new AnswerCollector();
	for (const [source, line] of events) collector.push(source, line);
	return collector.answer();
}

describe("AnswerCollector", () => {
	it("keeps the answer, not the narration that preceded the tool call", () => {
		// Exactly what a CLI produced when asked for a commit message: it said
		// what it was about to do, read the diff, then answered.
		const answer = collect([
			["assistant", "Reading the staged diff."],
			["tool", "Bash(git diff --staged)"],
			[
				"assistant",
				"feat(textures): add amber ore texture and its review sheet, FEAT-000\n\nAdd the 16x16 amber_ore.png block texture.",
			],
		]);
		expect(answer.split("\n")[0]).toBe(
			"feat(textures): add amber ore texture and its review sheet, FEAT-000",
		);
		expect(answer).not.toContain("Reading the staged diff.");
	});

	it("keeps only the turn after the last of several tool calls", () => {
		const answer = collect([
			["assistant", "Let me look."],
			["tool", "Bash(git status)"],
			["assistant", "Now the diff."],
			["tool", "Bash(git diff --staged)"],
			["assistant", "fix(git): the answer"],
		]);
		expect(answer).toBe("fix(git): the answer");
	});

	it("joins several text blocks of the same turn", () => {
		const answer = collect([
			["tool", "Read(a)"],
			["assistant", "feat: subject"],
			["assistant", ""],
			["assistant", "The body."],
		]);
		expect(answer).toBe("feat: subject\n\nThe body.");
	});

	it("keeps an answer given with no tool call at all", () => {
		expect(collect([["assistant", "chore: bump"]])).toBe("chore: bump");
	});

	it("answers empty when the agent only ever narrated", () => {
		expect(
			collect([
				["assistant", "Reading the staged diff."],
				["tool", "Bash(git diff --staged)"],
			]),
		).toBe("");
	});

	it("ignores events that are neither text nor a tool call", () => {
		const answer = collect([
			["usage", "{}"],
			["assistant", "feat: a"],
			["session", "abc"],
		]);
		expect(answer).toBe("feat: a");
	});

	it("strips a fence the provider wrapped the answer in", () => {
		const answer = collect([
			["tool", "Bash(git diff --staged)"],
			["assistant", "```\nfeat: fenced subject\n```"],
		]);
		expect(answer).toBe("feat: fenced subject");
	});
});

describe("stripCodeFence", () => {
	it("removes a fence with a language tag", () => {
		expect(stripCodeFence("```text\nhello\n```")).toBe("hello");
	});

	it("leaves an unfenced answer alone", () => {
		expect(stripCodeFence("  hello  ")).toBe("hello");
	});

	it("leaves a fence that only opens", () => {
		expect(stripCodeFence("```\nhello")).toBe("```\nhello");
	});

	it("keeps a fence that is inside the message, not around it", () => {
		const text = "feat: a\n\nSee:\n```\ncode\n```\nend";
		expect(stripCodeFence(text)).toBe(text);
	});
});
