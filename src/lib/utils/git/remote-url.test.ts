import { describe, expect, it } from "vitest";
import { buildMergeRequestUrl, parseRemoteUrl } from "./remote-url";

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
