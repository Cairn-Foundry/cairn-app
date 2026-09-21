// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import {
	branchKeySegment,
	renderBranchTemplate,
	ticketFromBranch,
} from "./branch-template";

describe("branchKeySegment", () => {
	it("lower-cases a Jira key and strips a GitLab hash", () => {
		expect(branchKeySegment("CAIRN-42")).toBe("cairn-42");
		expect(branchKeySegment("#123")).toBe("123");
	});
});

describe("renderBranchTemplate", () => {
	it("renders the default template", () => {
		expect(
			renderBranchTemplate("feat/{{key}}-{{slug}}", {
				key: "CAIRN-42",
				slug: "add-dark-mode",
			}),
		).toBe("feat/cairn-42-add-dark-mode");
	});

	it("uses the kind and drops an empty placeholder cleanly", () => {
		expect(
			renderBranchTemplate("{{kind}}/{{key}}-{{slug}}", {
				key: "#7",
				slug: "fix-login",
				kind: "Bug",
			}),
		).toBe("bug/7-fix-login");
		expect(
			renderBranchTemplate("{{kind}}/{{key}}-{{slug}}", {
				key: "#7",
				slug: "fix-login",
				kind: null,
			}),
		).toBe("7-fix-login");
	});

	it("collapses a missing slug without leaving a trailing dash", () => {
		expect(
			renderBranchTemplate("feat/{{key}}-{{slug}}", { key: "X-1", slug: "" }),
		).toBe("feat/x-1");
	});

	it("leaves a template without placeholders alone", () => {
		expect(renderBranchTemplate("wip", { key: "X-1", slug: "s" })).toBe("wip");
	});
});

describe("ticketFromBranch", () => {
	it("takes the ticket key the branch carries, and reads the rest as a title", () => {
		expect(ticketFromBranch("fix/PORE-3243-mikrotik-casing")).toEqual({
			id: "PORE-3243",
			title: "Mikrotik casing",
		});
	});

	it("finds the key wherever in the branch it sits", () => {
		expect(ticketFromBranch("cairn-42/dark-mode")).toEqual({
			id: "CAIRN-42",
			title: "Dark mode",
		});
		expect(ticketFromBranch("feat/x-9")).toEqual({ id: "X-9", title: "X 9" });
	});

	/** Most branches carry no ticket at all; the name is still what the work is. */
	it("falls back to the last segment when no key reads as a ticket", () => {
		expect(ticketFromBranch("feat/adopt-an-existing-worktree")).toEqual({
			id: "adopt-an-existing-worktree",
			title: "Adopt an existing worktree",
		});
		expect(ticketFromBranch("wip")).toEqual({ id: "wip", title: "Wip" });
	});

	it("reads an underscore as a separator too", () => {
		expect(ticketFromBranch("fix/CAIRN-7_broken_pipe")).toEqual({
			id: "CAIRN-7",
			title: "Broken pipe",
		});
	});

	it("has nothing to say about a branch with no name", () => {
		expect(ticketFromBranch("")).toBeNull();
		expect(ticketFromBranch("///")).toBeNull();
	});
});
