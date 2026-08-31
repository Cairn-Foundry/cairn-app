// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { branchKeySegment, renderBranchTemplate } from "./branch-template";

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
