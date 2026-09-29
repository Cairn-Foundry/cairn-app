// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import {
	branchKeySegment,
	branchKindSegment,
	DEFAULT_BRANCH_TEMPLATE,
	renderBranchTemplate,
	slugSegment,
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

	/**
	 * GitHub answers `issue` or `pull_request` for everything it tracks and
	 * GitLab defaults to `issue`, so kept as prefixes they would turn every
	 * ticket of those two into `issue/...`.
	 */
	it("treats a tracker-wide type as no type at all", () => {
		expect(branchKindSegment("issue")).toBe("feat");
		expect(branchKindSegment("pull_request")).toBe("feat");
		expect(branchKindSegment("merge_request")).toBe("feat");
		expect(branchKindSegment("Issue")).toBe("feat");
	});

	/** GitLab sends its own `issue_type`, which does say something. */
	it("still reads a GitLab issue type that names the work", () => {
		expect(branchKindSegment("incident")).toBe("fix");
		expect(branchKindSegment("test_case")).toBe("test-case");
	});

	/** A ticket typed by hand has no type, and a branch still needs its prefix. */
	it("falls back to feat for a ticket with no type", () => {
		expect(branchKindSegment(null)).toBe("feat");
		expect(branchKindSegment("  ")).toBe("feat");
		expect(branchKindSegment("!!")).toBe("feat");
	});
});

describe("titleSlug", () => {
	it("keeps the words of a French title, in order", () => {
		expect(
			titleSlug("Suppression des sessions expirées lors de la déconnexion"),
		).toBe("suppression-des-sessions-expirees-lors-de");
	});

	it("keeps the words of an English title, in order", () => {
		expect(titleSlug("Drop the stale sessions on logout of the user")).toBe(
			"drop-the-stale-sessions-on-logout",
		);
	});

	/**
	 * The reason the filler list is gone: it held `no`, `not`, `ne`, `pas` and
	 * `sans`, so the slug could name the opposite of the ticket.
	 */
	it("keeps a negation, which a filler list would have dropped", () => {
		expect(titleSlug("Do not send emails to unsubscribed users")).toBe(
			"do-not-send-emails-to-unsubscribed",
		);
		expect(titleSlug("Ne plus envoyer de mails sans consentement")).toBe(
			"ne-plus-envoyer-de-mails-sans",
		);
	});

	it("folds accents away and drops the elisions the split leaves behind", () => {
		expect(titleSlug("Éviter l'envoi d'un e-mail : doublon")).toBe(
			"eviter-envoi-un-mail-doublon",
		);
	});

	it("drops a ticket key the title repeats", () => {
		expect(titleSlug("[APP-214] Suppression des sessions", "APP-214")).toBe(
			"suppression-des-sessions",
		);
		expect(titleSlug("APP-214 : Suppression des sessions")).toBe(
			"suppression-des-sessions",
		);
	});

	it("keeps a title that is nothing but short words", () => {
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

describe("slugSegment", () => {
	/**
	 * The words are the model's answer. Passing them back through `titleSlug`
	 * rewrote them - `drop-stale-sessions-on-logout` lost its `on`, and a
	 * `do-not-retry` would have lost the `not` that carries the meaning.
	 */
	it("keeps every word the model chose", () => {
		expect(slugSegment("drop-stale-sessions-on-logout")).toBe(
			"drop-stale-sessions-on-logout",
		);
		expect(slugSegment("do-not-retry-failed-uploads")).toBe(
			"do-not-retry-failed-uploads",
		);
	});

	it("makes it safe for a ref, and nothing more", () => {
		expect(slugSegment("Clear Expired Sessions")).toBe(
			"clear-expired-sessions",
		);
		expect(slugSegment("fix/éviter le doublon")).toBe("fix-eviter-le-doublon");
		expect(slugSegment("--trimmed--")).toBe("trimmed");
	});

	it("stays bounded without leaving a trailing separator", () => {
		const slug = slugSegment("a".repeat(40) + "-" + "b".repeat(40));
		expect(slug.length).toBeLessThanOrEqual(52);
		expect(slug.endsWith("-")).toBe(false);
	});

	it("answers with nothing for an answer made of nothing", () => {
		expect(slugSegment("")).toBe("");
		expect(slugSegment("///")).toBe("");
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
