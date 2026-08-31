// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	buildPipelinesUrl,
	fallbackForgeLink,
	forgeLabel,
	forgeLink,
} from "./links";

const forgeWebLink = vi.hoisted(() => vi.fn());
const capabilitiesOf = vi.hoisted(() => vi.fn());

vi.mock("$lib/services/integration-service", () => ({ forgeWebLink }));
vi.mock("$lib/stores/integrations", () => ({ capabilitiesOf }));

const remote = "git@gitlab.acme.io:group/repo.git";

beforeEach(() => {
	forgeWebLink.mockReset();
	capabilitiesOf.mockReset();
});

describe("fallbackForgeLink", () => {
	it("builds every target from the remote", () => {
		expect(
			fallbackForgeLink(remote, {
				type: "file",
				path: "src/a.ts",
				line: 3,
				ref: "main",
			}),
		).toBe("https://gitlab.acme.io/group/repo/-/blob/main/src/a.ts#L3");
		expect(fallbackForgeLink(remote, { type: "commit", sha: "abc" })).toBe(
			"https://gitlab.acme.io/group/repo/-/commit/abc",
		);
		expect(fallbackForgeLink(remote, { type: "branch", name: "dev" })).toBe(
			"https://gitlab.acme.io/group/repo/-/tree/dev",
		);
		expect(
			fallbackForgeLink(remote, { type: "compare", base: "main", head: "dev" }),
		).toBe("https://gitlab.acme.io/group/repo/-/compare/main...dev");
	});
});

describe("forgeLink", () => {
	it("asks the bound forge when the project has the capability", async () => {
		capabilitiesOf.mockReturnValue({
			tracker: null,
			forge: {
				kind: "gitlab",
				label: "GitLab",
				webUrl: "",
				terms: { mergeRequest: "mr" },
			},
			ci: null,
		});
		forgeWebLink.mockResolvedValue("https://forge/commit/abc");
		await expect(
			forgeLink("p1", remote, { type: "commit", sha: "abc" }),
		).resolves.toBe("https://forge/commit/abc");
		expect(forgeWebLink).toHaveBeenCalledWith("p1", {
			type: "commit",
			sha: "abc",
		});
	});

	it("uses the remote when there is no forge binding", async () => {
		capabilitiesOf.mockReturnValue({ tracker: null, forge: null, ci: null });
		await expect(
			forgeLink("p1", remote, { type: "commit", sha: "abc" }),
		).resolves.toBe("https://gitlab.acme.io/group/repo/-/commit/abc");
		expect(forgeWebLink).not.toHaveBeenCalled();
	});

	it("falls back to the remote when the forge fails", async () => {
		capabilitiesOf.mockReturnValue({
			tracker: null,
			forge: {
				kind: "gitlab",
				label: "GitLab",
				webUrl: "",
				terms: { mergeRequest: "mr" },
			},
			ci: null,
		});
		forgeWebLink.mockRejectedValue(new Error("network"));
		await expect(
			forgeLink("p1", remote, { type: "branch", name: "dev" }),
		).resolves.toBe("https://gitlab.acme.io/group/repo/-/tree/dev");
	});
});

describe("forgeLabel", () => {
	it("prefers the bound forge label", () => {
		expect(forgeLabel({ label: "GitLab (acme)" }, remote)).toBe(
			"GitLab (acme)",
		);
	});

	it("falls back to the remote host, and hides without either", () => {
		expect(forgeLabel(null, remote)).toBe("gitlab.acme.io");
		expect(forgeLabel(null, "")).toBeNull();
	});
});

describe("buildPipelinesUrl", () => {
	const gitlab = {
		kind: "gitlab",
		webUrl: "https://gitlab.acme.io/acme/backend",
	};

	it("opens the pipeline list of the branch, never a single pipeline", () => {
		expect(buildPipelinesUrl(gitlab, "hotfix/roles-in-progress-slots")).toBe(
			"https://gitlab.acme.io/acme/backend/-/pipelines?ref=hotfix%2Froles-in-progress-slots",
		);
	});

	it("falls back to the whole index when no branch is known", () => {
		expect(buildPipelinesUrl(gitlab, "")).toBe(
			"https://gitlab.acme.io/acme/backend/-/pipelines",
		);
	});

	it("uses the Actions shape on GitHub", () => {
		expect(
			buildPipelinesUrl(
				{ kind: "github", webUrl: "https://github.com/acme/repo" },
				"feat/x",
			),
		).toBe("https://github.com/acme/repo/actions?query=branch%3Afeat%2Fx");
	});

	it("returns nothing without a forge, so the caller can fall back", () => {
		expect(buildPipelinesUrl(null, "main")).toBe("");
	});
});
