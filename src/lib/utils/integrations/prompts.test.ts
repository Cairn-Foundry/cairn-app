// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import {
	buildBranchNamePrompt,
	buildCiFixPrompt,
	buildMrDescriptionPrompt,
	buildReviewCommentPrompt,
	buildReviewGuidePrompt,
	buildTicketPlanPrompt,
	buildTicketStartPrompt,
	renderPromptTemplate,
	type TicketPlanProject,
	ticketValues,
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

describe("buildReviewGuidePrompt context block", () => {
	const assignments = {
		reviewGuide: {
			providerId: "",
			model: "",
			promptTemplate: "[{{context}}]",
		},
	};
	const input = {
		base: "main",
		head: "feature",
		diff: "d",
		truncated: false,
		language: "en",
	};

	it("is empty without a merge request or a ticket", () => {
		expect(buildReviewGuidePrompt(input, assignments)).toBe("[]");
		expect(
			buildReviewGuidePrompt({ ...input, mrTitle: "  " }, assignments),
		).toBe("[]");
	});

	it("wraps a single part in line breaks", () => {
		expect(
			buildReviewGuidePrompt({ ...input, mrTitle: " Add login " }, assignments),
		).toBe("[\nMerge request: Add login\n]");
	});

	it("separates the parts with a blank line", () => {
		expect(
			buildReviewGuidePrompt(
				{
					...input,
					mrTitle: "Add login",
					mrDescription: " It adds login. ",
					ticket: { key: "CAI-1", title: "Login" },
				},
				assignments,
			),
		).toBe(
			"[\nMerge request: Add login\n\nDescription:\nIt adds login.\n\nTicket CAI-1: Login\n]",
		);
	});
});

describe("ticketValues", () => {
	it("is empty strings without a ticket", () => {
		const empty = {
			"ticket.key": "",
			"ticket.title": "",
			"ticket.url": "",
			ticket: "",
		};
		expect(ticketValues(null)).toStrictEqual(empty);
		expect(ticketValues(undefined)).toStrictEqual(empty);
	});

	it("carries the ticket fields and a sentence naming it", () => {
		expect(
			ticketValues({ key: "CAI-1", title: "Login", url: "https://x/CAI-1" }),
		).toStrictEqual({
			"ticket.key": "CAI-1",
			"ticket.title": "Login",
			"ticket.url": "https://x/CAI-1",
			ticket: " The branch works on ticket CAI-1: Login.",
		});
	});
});

describe("buildReviewGuidePrompt truncation note", () => {
	const HEAD =
		"\nThis diff was too large to include whole: it was cut on hunk boundaries.";
	const TAIL =
		"Give these files a chapter of their own saying they could not be read, rather than guessing what they hold or leaving them out of the tour.\n";
	const assignments = {
		reviewGuide: {
			providerId: "",
			model: "",
			promptTemplate: "[{{truncated}}]",
		},
	};
	const input = {
		base: "main",
		head: "feature",
		diff: "d",
		truncated: true,
		language: "en",
	};

	it("is empty when the diff was not cut", () => {
		expect(
			buildReviewGuidePrompt(
				{ ...input, truncated: false, omitted: ["a.ts"] },
				assignments,
			),
		).toBe("[]");
	});

	it("names no file when none was reported", () => {
		expect(buildReviewGuidePrompt(input, assignments)).toBe(`[${HEAD}${TAIL}]`);
		expect(buildReviewGuidePrompt({ ...input, omitted: [] }, assignments)).toBe(
			`[${HEAD}${TAIL}]`,
		);
	});

	it("lists every omitted file when there are few", () => {
		expect(
			buildReviewGuidePrompt(
				{ ...input, omitted: ["a.ts", "b.ts"] },
				assignments,
			),
		).toBe(
			`[${HEAD}\nThe files left out, entirely or in part:\n- a.ts\n- b.ts\n${TAIL}]`,
		);
	});

	it("lists forty files exactly without a remainder line", () => {
		const omitted = Array.from({ length: 40 }, (_, i) => `f${i}.ts`);
		const prompt = buildReviewGuidePrompt({ ...input, omitted }, assignments);
		expect(prompt).toContain("- f39.ts\n");
		expect(prompt).not.toContain("more");
	});

	it("counts a single file past the cap", () => {
		const omitted = Array.from({ length: 41 }, (_, i) => `f${i}.ts`);
		const prompt = buildReviewGuidePrompt({ ...input, omitted }, assignments);
		expect(prompt).toContain("- f39.ts\n- and 1 more\n");
	});

	it("caps the list at forty and counts the rest", () => {
		const omitted = Array.from({ length: 42 }, (_, i) => `f${i}.ts`);
		const prompt = buildReviewGuidePrompt({ ...input, omitted }, assignments);
		expect(prompt).toContain("- f39.ts\n- and 2 more\n");
		expect(prompt).not.toContain("f40.ts");
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

describe("buildTicketStartPrompt without optional parts", () => {
	it("says there is no description and leaves out labels and link", () => {
		expect(
			buildTicketStartPrompt({
				key: "#4",
				title: "Add dark mode",
				description: "  \n ",
				url: "",
				labels: [],
			}),
		).toBe(
			[
				"Start working on ticket #4: Add dark mode",
				"",
				"Description:",
				"(none)",
				"",
				"Read the ticket, explore the worktree, and propose a plan before changing code. Ask when the acceptance criteria are unclear.",
			].join("\n"),
		);
	});
});

describe("buildTicketPlanPrompt", () => {
	const projects: TicketPlanProject[] = [
		{
			name: "Alpha",
			tickets: [
				{
					key: "A-1",
					title: "Fix login",
					status: "Open",
					labels: ["bug", "ux"],
					assignees: [
						{ login: "ada", displayName: "Ada" },
						{ login: "bob", displayName: "Bob" },
					],
				},
				{ key: "A-2", title: "Bare", status: "", labels: [], assignees: [] },
			],
		},
		{ name: "Beta", tickets: [] },
	];
	const custom = {
		ticketPlan: {
			providerId: "",
			model: "",
			promptTemplate: "{{language}}\n{{tickets}}",
		},
	};

	it("renders the backlog grouped by project with status, labels and assignees", () => {
		expect(buildTicketPlanPrompt(projects, "fr", custom)).toBe(
			[
				"fr",
				"## Alpha",
				"- A-1: Fix login [Open, bug, ux] (Ada, Bob)",
				"- A-2: Bare",
				"",
				"## Beta",
				"(no open ticket)",
			].join("\n"),
		);
	});

	it("falls back to the default template", () => {
		const prompt = buildTicketPlanPrompt(projects, "en");
		expect(prompt).toContain("- A-1: Fix login [Open, bug, ux] (Ada, Bob)");
		expect(prompt).not.toContain("{{");
	});
});

describe("buildBranchNamePrompt", () => {
	it("gives the model the ticket and asks for the slug and the kind", () => {
		const prompt = buildBranchNamePrompt({
			key: "APP-214",
			title: "Suppression des sessions expirées lors de la déconnexion",
			kind: "Bug",
			description: "La session reste ouverte côté serveur.",
		});
		expect(prompt).toContain("APP-214");
		expect(prompt).toContain("Suppression des sessions expirées");
		expect(prompt).toContain("Bug");
		expect(prompt).toContain("La session reste ouverte côté serveur.");
		expect(prompt).toContain("`slug`");
		expect(prompt).toContain("`kind`");
	});

	it("leaves the description block out when the ticket has none", () => {
		const prompt = buildBranchNamePrompt({
			key: "X-1",
			title: "Add dark mode",
			kind: null,
			description: "",
		});
		expect(prompt).not.toContain("Description:");
	});

	/** A Jira description can run for pages; the branch name needs its head. */
	it("truncates a long description", () => {
		const prompt = buildBranchNamePrompt({
			key: "X-1",
			title: "t",
			kind: null,
			description: "a".repeat(5000),
		});
		expect(prompt).toContain("a".repeat(2000));
		expect(prompt).not.toContain("a".repeat(2001));
	});
});

describe("buildBranchNamePrompt placeholders", () => {
	const assignments = {
		branchName: {
			providerId: "",
			model: "",
			promptTemplate: "[{{ticket.kind}}|{{ticket.description}}]",
		},
	};

	it("blanks the kind and the description a ticket does not have", () => {
		expect(
			buildBranchNamePrompt(
				{ key: "X-1", title: "t", kind: null, description: "" },
				assignments,
			),
		).toBe("[|]");
	});

	it("passes the kind and frames a description", () => {
		expect(
			buildBranchNamePrompt(
				{ key: "X-1", title: "t", kind: "Bug", description: " why " },
				assignments,
			),
		).toBe("[Bug|\nDescription:\nwhy\n]");
	});
});
