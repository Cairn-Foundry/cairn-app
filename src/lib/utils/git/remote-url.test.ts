// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import {
	buildBranchUrl,
	buildCommitUrl,
	buildCompareUrl,
	buildFileUrl,
	buildMergeRequestUrl,
	parseRemoteUrl,
} from "./remote-url";

describe("parseRemoteUrl", () => {
	it("parses an scp-like ssh remote", () => {
		expect(parseRemoteUrl("git@gitlab.com:group/sub/repo.git")).toEqual({
			host: "gitlab.com",
			path: "group/sub/repo",
			webUrl: "https://gitlab.com/group/sub/repo",
		});
	});

	it("parses an ssh:// remote with a port", () => {
		expect(
			parseRemoteUrl("ssh://git@gitlab.example.com:2222/group/repo.git"),
		).toEqual({
			host: "gitlab.example.com",
			path: "group/repo",
			webUrl: "https://gitlab.example.com/group/repo",
		});
	});

	it("parses an https remote carrying credentials", () => {
		expect(parseRemoteUrl("https://user@gitlab.com/group/repo.git")).toEqual({
			host: "gitlab.com",
			path: "group/repo",
			webUrl: "https://gitlab.com/group/repo",
		});
	});

	it("rejects empty, local and unsupported remotes", () => {
		expect(parseRemoteUrl("")).toBeNull();
		expect(parseRemoteUrl("/srv/git/repo.git")).toBeNull();
		expect(parseRemoteUrl("file:///srv/git/repo.git")).toBeNull();
	});
});

describe("buildMergeRequestUrl", () => {
	it("builds a GitLab merge request link", () => {
		expect(
			buildMergeRequestUrl(
				"git@gitlab.com:group/repo.git",
				"feat/my-branch",
				"main",
			),
		).toBe(
			"https://gitlab.com/group/repo/-/merge_requests/new?merge_request%5Bsource_branch%5D=feat%2Fmy-branch&merge_request%5Btarget_branch%5D=main",
		);
	});

	it("builds a GitHub compare link", () => {
		expect(
			buildMergeRequestUrl(
				"https://github.com/owner/repo.git",
				"feat/my-branch",
				"main",
			),
		).toBe(
			"https://github.com/owner/repo/compare/main...feat%2Fmy-branch?expand=1",
		);
	});

	it("returns null without a usable remote or branch", () => {
		expect(buildMergeRequestUrl("", "feat/x", "main")).toBeNull();
		expect(
			buildMergeRequestUrl("git@gitlab.com:group/repo.git", "", "main"),
		).toBeNull();
	});
});

describe("deep link fallbacks", () => {
	const gitlab = "git@gitlab.acme.io:group/sub/repo.git";
	const github = "https://github.com/acme/repo.git";

	it("builds file links, with an optional line", () => {
		expect(buildFileUrl(gitlab, "main", "src/a b.ts", 12)).toBe(
			"https://gitlab.acme.io/group/sub/repo/-/blob/main/src/a%20b.ts#L12",
		);
		expect(buildFileUrl(github, "feat/x", "src/a.ts")).toBe(
			"https://github.com/acme/repo/blob/feat%2Fx/src/a.ts",
		);
		expect(buildFileUrl(github, "", "src/a.ts")).toBeNull();
	});

	it("builds commit and branch links", () => {
		expect(buildCommitUrl(gitlab, "abc")).toBe(
			"https://gitlab.acme.io/group/sub/repo/-/commit/abc",
		);
		expect(buildCommitUrl(github, "abc")).toBe(
			"https://github.com/acme/repo/commit/abc",
		);
		expect(buildBranchUrl(gitlab, "feat/x")).toBe(
			"https://gitlab.acme.io/group/sub/repo/-/tree/feat%2Fx",
		);
		expect(buildBranchUrl(github, "main")).toBe(
			"https://github.com/acme/repo/tree/main",
		);
	});

	it("builds compare links", () => {
		expect(buildCompareUrl(gitlab, "main", "feat/x")).toBe(
			"https://gitlab.acme.io/group/sub/repo/-/compare/main...feat%2Fx",
		);
		expect(buildCompareUrl(github, "main", "feat/x")).toBe(
			"https://github.com/acme/repo/compare/main...feat%2Fx",
		);
		expect(buildCompareUrl("nope", "main", "x")).toBeNull();
	});
});
