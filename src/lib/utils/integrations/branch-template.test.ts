// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import {
	branchKeySegment,
	branchKindSegment,
	DEFAULT_BRANCH_TEMPLATE,
	renderBranchTemplate,
	titleSlug,
} from "./branch-template";

describe("branchKeySegment", () => {
	it("keeps the case the tracker gave the key", () => {
		expect(branchKeySegment("APP-214")).toBe("APP-214");
		expect(branchKeySegment("CAIRN-42")).toBe("CAIRN-42");
	});

	it("strips a GitLab hash and any character git refuses", () => {
		expect(branchKeySegment("#123")).toBe("123");
		expect(branchKeySegment("PROJ 42")).toBe("PROJ-42");
	});
});

describe("branchKindSegment", () => {
	it("maps a tracker issue type to its conventional prefix", () => {
		expect(branchKindSegment("Bug")).toBe("fix");
		expect(branchKindSegment("User Story")).toBe("feat");
		expect(branchKindSegment("Sub-task")).toBe("feat");
		expect(branchKindSegment("Amélioration")).toBe("feat");
	});

	it("keeps a type it does not know, slugified", () => {
		expect(branchKindSegment("Change Request")).toBe("change-request");
	});

	/** A ticket typed by hand has no type, and a branch still needs its prefix. */
	it("falls back to feat for a ticket with no type", () => {
		expect(branchKindSegment(null)).toBe("feat");
		expect(branchKindSegment("  ")).toBe("feat");
		expect(branchKindSegment("!!")).toBe("feat");
	});
});

describe("titleSlug", () => {
	it("drops the filler words of a French title", () => {
		expect(
			titleSlug("Suppression des sessions expirées lors de la déconnexion"),
		).toBe("suppression-sessions-expirees-deconnexion");
	});

	it("drops the filler words of an English title", () => {
		expect(titleSlug("Drop the stale sessions on logout of the user")).toBe(
			"drop-stale-sessions-logout-user",
		);
	});

	it("folds accents and punctuation away", () => {
		expect(titleSlug("Éviter l'envoi d'un e-mail : doublon")).toBe(
			"eviter-envoi-mail-doublon",
		);
	});

	it("drops a ticket key the title repeats", () => {
		expect(titleSlug("[APP-214] Suppression des sessions", "APP-214")).toBe(
			"suppression-sessions",
		);
		expect(titleSlug("APP-214 : Suppression des sessions")).toBe(
			"suppression-sessions",
		);
	});

	it("keeps its words when they are all filler", () => {
		expect(titleSlug("Pour le tout")).toBe("pour-le-tout");
	});

	it("stays short enough to read in a branch list", () => {
		const slug = titleSlug(
			"Refonte complete du pipeline de deploiement continu des environnements de recette",
		);
		expect(slug.length).toBeLessThanOrEqual(52);
		expect(slug.split("-").length).toBeLessThanOrEqual(6);
	});

	it("answers with nothing for a title made of nothing", () => {
		expect(titleSlug("")).toBe("");
		expect(titleSlug("   ---   ")).toBe("");
	});
});

describe("renderBranchTemplate", () => {
	it("renders the default template with the key in its own case", () => {
		expect(
			renderBranchTemplate(DEFAULT_BRANCH_TEMPLATE, {
				key: "APP-214",
				slug: "drop-stale-sessions-on-logout",
				kind: "Bug",
			}),
		).toBe("fix/APP-214/drop-stale-sessions-on-logout");
	});

	it("still renders a template written the old way", () => {
		expect(
			renderBranchTemplate("feat/{{key}}-{{slug}}", {
				key: "CAIRN-42",
				slug: "add-dark-mode",
			}),
		).toBe("feat/CAIRN-42-add-dark-mode");
	});

	it("prefixes a ticket with no type rather than leaving the segment empty", () => {
		expect(
			renderBranchTemplate("{{kind}}/{{key}}-{{slug}}", {
				key: "#7",
				slug: "fix-login",
				kind: null,
			}),
		).toBe("feat/7-fix-login");
	});

	it("collapses a missing slug without leaving a trailing dash or slash", () => {
		expect(
			renderBranchTemplate("feat/{{key}}-{{slug}}", { key: "X-1", slug: "" }),
		).toBe("feat/X-1");
		expect(
			renderBranchTemplate(DEFAULT_BRANCH_TEMPLATE, {
				key: "X-1",
				slug: "",
				kind: null,
			}),
		).toBe("feat/X-1");
	});

	it("leaves a template without placeholders alone", () => {
		expect(renderBranchTemplate("wip", { key: "X-1", slug: "s" })).toBe("wip");
	});
});
