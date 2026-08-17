import { describe, expect, it } from "vitest";
import { parseCommitMessage, renderCommitPrompt } from "./commit-message";

describe("parseCommitMessage", () => {
	it("splits the subject from the body on the first blank line", () => {
		const parsed = parseCommitMessage(
			"feat(git): generate the commit message\n\nReads the staged diff.\nAnswers with the message.",
		);
		expect(parsed.title).toBe("feat(git): generate the commit message");
		expect(parsed.body).toBe(
			"Reads the staged diff.\nAnswers with the message.",
		);
	});

	it("reads a subject-only answer", () => {
		const parsed = parseCommitMessage("fix(tests): stop leaking the runner");
		expect(parsed.title).toBe("fix(tests): stop leaking the runner");
		expect(parsed.body).toBe("");
	});

	it("skips leading blank lines", () => {
		expect(parseCommitMessage("\n\nchore: bump").title).toBe("chore: bump");
	});

	it("drops a Subject: label the provider echoed back", () => {
		const parsed = parseCommitMessage(
			"Subject: feat: add page\n\nBody: the page.",
		);
		expect(parsed.title).toBe("feat: add page");
		expect(parsed.body).toBe("the page.");
	});

	it("handles CRLF", () => {
		const parsed = parseCommitMessage("feat: a\r\n\r\nbody\r\nmore");
		expect(parsed.title).toBe("feat: a");
		expect(parsed.body).toBe("body\nmore");
	});

	it("answers empty fields for an empty answer", () => {
		expect(parseCommitMessage("   \n  ")).toEqual({ title: "", body: "" });
	});

	it("skips reasoning the agent wrote before the message", () => {
		// Observed: the agent restated the convention, then wrote the message.
		// Read from the top, its reasoning became the subject.
		const parsed = parseCommitMessage(
			"The convention is clear: `type(scope): description, FEAT-000`. The images show a 16x16 ore texture.\n\nfeat(textures): add amber ore texture, FEAT-000\n\nDraw a 16x16 amber ore block texture.",
		);
		expect(parsed.title).toBe(
			"feat(textures): add amber ore texture, FEAT-000",
		);
		expect(parsed.body).toBe("Draw a 16x16 amber ore block texture.");
	});

	it("does not mistake a reasoning sentence containing a colon for a subject", () => {
		const parsed = parseCommitMessage(
			"Note: the diff touches two files.\n\nfix(git): drop the stale index",
		);
		expect(parsed.title).toBe("fix(git): drop the stale index");
	});

	it("keeps a subject that is already the first line", () => {
		const parsed = parseCommitMessage("feat: a thing\n\nThe body.");
		expect(parsed.title).toBe("feat: a thing");
		expect(parsed.body).toBe("The body.");
	});

	it("reads from the top when the convention is not conventional commits", () => {
		const parsed = parseCommitMessage("Add the amber ore texture\n\nDetails.");
		expect(parsed.title).toBe("Add the amber ore texture");
		expect(parsed.body).toBe("Details.");
	});

	it("accepts a breaking-change marker and a scope", () => {
		expect(parseCommitMessage("chore\n\nfeat(api)!: drop v1").title).toBe(
			"feat(api)!: drop v1",
		);
	});

	it("ignores a prose line that starts with a type word", () => {
		// "fix" here opens a sentence, and what follows is far too long to be a
		// subject, so it must not win over the real one below.
		const parsed = parseCommitMessage(
			`fix: ${"a".repeat(200)}\n\nfix(git): the real subject`,
		);
		expect(parsed.title).toBe("fix(git): the real subject");
	});
});

describe("renderCommitPrompt", () => {
	it("asks for the ticket when the instance carries one", () => {
		const rendered = renderCommitPrompt("Subject rules.{{ticket}}", "CAI-42");
		expect(rendered).toContain("CAI-42");
	});

	it("expands to nothing without a ticket", () => {
		expect(renderCommitPrompt("Subject rules.{{ticket}}", "")).toBe(
			"Subject rules.",
		);
	});

	it("leaves a template with no placeholder alone", () => {
		expect(renderCommitPrompt("Write a message.", "CAI-1")).toBe(
			"Write a message.",
		);
	});
});
