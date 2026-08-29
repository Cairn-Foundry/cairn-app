import { describe, expect, it } from "vitest";
import {
	buildCiFixPrompt,
	buildMrDescriptionPrompt,
	buildReviewCommentPrompt,
	buildReviewGuidePrompt,
	buildTicketStartPrompt,
	renderPromptTemplate,
} from "./prompts";

describe("renderPromptTemplate", () => {
	it("replaces known placeholders and blanks unknown ones", () => {
		expect(
			renderPromptTemplate("a {{x}} b {{ y }} c {{z}}", { x: "1", y: "2" }),
		).toBe("a 1 b 2 c ");
	});
});

describe("buildCiFixPrompt", () => {
	it("renders the default template with the job, sha and excerpt", () => {
		const prompt = buildCiFixPrompt({ name: "lint" }, "  error: x  ", "abc123");
		expect(prompt).toContain("Job: lint");
		expect(prompt).toContain("Commit: abc123");
		expect(prompt).toContain("error: x");
		expect(prompt).not.toContain("{{");
	});

	it("prefers a custom template", () => {
		const prompt = buildCiFixPrompt({ name: "lint" }, "boom", "abc", {
			ciFix: {
				providerId: "",
				model: "",
				promptTemplate: "Fix {{job}} at {{sha}}",
			},
		});
		expect(prompt).toBe("Fix lint at abc");
	});
});

describe("buildReviewGuidePrompt", () => {
	const input = {
		base: "main",
		head: "feature",
		diff: "diff --git a/src/a.ts b/src/a.ts",
		truncated: false,
		language: "en",
	};

	it("carries the refs and the diff", () => {
		const prompt = buildReviewGuidePrompt(input);
		expect(prompt).toContain("Base: main");
		expect(prompt).toContain("Head: feature");
		expect(prompt).toContain("diff --git a/src/a.ts");
	});

	it("says nothing about a merge request the branch does not have", () => {
		const prompt = buildReviewGuidePrompt(input);
		expect(prompt).not.toContain("Merge request:");
		expect(prompt).not.toContain("Ticket");
	});

	it("hands over the merge request and the ticket when they exist", () => {
		const prompt = buildReviewGuidePrompt({
			...input,
			mrTitle: "Add login",
			mrDescription: "It adds login.",
			ticket: { key: "CAI-1", title: "Login" },
		});
		expect(prompt).toContain("Merge request: Add login");
		expect(prompt).toContain("It adds login.");
		expect(prompt).toContain("Ticket CAI-1: Login");
	});

	it("warns the model when the diff was cut", () => {
		expect(buildReviewGuidePrompt({ ...input, truncated: true })).toContain(
			"too large to include whole",
		);
		expect(buildReviewGuidePrompt(input)).not.toContain(
			"too large to include whole",
		);
	});
});

describe("buildReviewCommentPrompt", () => {
	it("carries the anchor, the excerpt and the remark", () => {
		const prompt = buildReviewCommentPrompt({
			path: "src/a.ts",
			line: 12,
			excerpt: "const a = 1;",
			title: "Off by one",
			body: "The loop runs once too many times.",
			language: "fr",
		});
		expect(prompt).toContain("File: src/a.ts");
		expect(prompt).toContain("Line: 12");
		expect(prompt).toContain("Off by one");
		expect(prompt).toContain("once too many times");
		expect(prompt).toContain("Write in fr.");
	});
});

describe("buildMrDescriptionPrompt", () => {
	it("mentions the base branch and the ticket when known", () => {
		const prompt = buildMrDescriptionPrompt("main", {
			key: "CAI-1",
			title: "Login",
			url: "https://j/CAI-1",
		});
		expect(prompt).toContain("git log main..HEAD");
		expect(prompt).toContain("CAI-1");
	});

	it("drops the ticket clause without a ticket", () => {
		expect(buildMrDescriptionPrompt("main", null)).not.toContain("ticket");
	});
});

describe("buildTicketStartPrompt", () => {
	it("quotes the ticket as is", () => {
		const prompt = buildTicketStartPrompt({
			key: "#4",
			title: "Add dark mode",
			description: "Users want it.",
			url: "https://g/4",
			labels: ["ui"],
		});
		expect(prompt).toContain("#4: Add dark mode");
		expect(prompt).toContain("Users want it.");
		expect(prompt).toContain("Labels: ui");
		expect(prompt).toContain("https://g/4");
	});
});
