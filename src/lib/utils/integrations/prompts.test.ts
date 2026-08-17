import { describe, expect, it } from "vitest";
import {
	buildCiFixPrompt,
	buildMrDescriptionPrompt,
	buildReviewAddressPrompt,
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

describe("buildReviewAddressPrompt", () => {
	it("renders the file, line, excerpt and comment", () => {
		const prompt = buildReviewAddressPrompt({
			path: "src/a.ts",
			line: 12,
			excerpt: "const a = 1;",
			comment: "Rename this.",
		});
		expect(prompt).toContain("File: src/a.ts");
		expect(prompt).toContain("Line: 12");
		expect(prompt).toContain("> Rename this.");
	});

	it("marks a general comment with no line", () => {
		expect(
			buildReviewAddressPrompt({
				path: "",
				line: null,
				excerpt: "",
				comment: "hi",
			}),
		).toContain("Line: -");
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
