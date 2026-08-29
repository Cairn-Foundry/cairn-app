import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	amendCommit,
	commit,
	GIT_ERROR_CODES,
	type GitError,
	isKnownGitErrorCode,
	merge,
	push,
	toGitError,
} from "./git-service";

const mockInvoke = vi.mocked(invoke);

/** The payload the service handed to invoke on its last call. */
const lastPayload = () =>
	mockInvoke.mock.calls.at(-1)?.[1] as Record<string, unknown>;

beforeEach(() => {
	mockInvoke.mockReset();
	mockInvoke.mockResolvedValue(undefined);
});

describe("isKnownGitErrorCode", () => {
	it("accepts every code the classifier can produce", () => {
		for (const code of GIT_ERROR_CODES) {
			expect(isKnownGitErrorCode(code), code).toBe(true);
		}
	});

	it("rejects a code an older or newer backend might send", () => {
		expect(isKnownGitErrorCode("not_a_real_code")).toBe(false);
		expect(isKnownGitErrorCode("")).toBe(false);
	});

	it("is case sensitive, since the codes are a closed vocabulary", () => {
		expect(isKnownGitErrorCode("LOCK_EXISTS")).toBe(false);
	});
});

describe("toGitError", () => {
	it("passes a classified error through untouched", () => {
		const error: GitError = { code: "auth_failed", raw: "stderr text" };
		expect(toGitError(error)).toBe(error);
	});

	it("keeps the context a classified error carries", () => {
		const error: GitError = {
			code: "no_upstream",
			raw: "raw",
			context: "push",
		};
		expect(toGitError(error)).toEqual(error);
	});

	it("wraps a plain string rejection, keeping its text readable", () => {
		expect(toGitError("fatal: not a git repository")).toEqual({
			code: "unknown",
			raw: "fatal: not a git repository",
		});
	});

	it("wraps an Error, keeping its message in raw", () => {
		expect(toGitError(new Error("boom"))).toEqual({
			code: "unknown",
			raw: "Error: boom",
		});
	});

	it("wraps what a rejected promise may carry instead of an error", () => {
		expect(toGitError(undefined).code).toBe("unknown");
		expect(toGitError(null).raw).toBe("null");
		expect(toGitError(42).raw).toBe("42");
	});

	it("wraps an object that is not shaped like a git error", () => {
		expect(toGitError({ message: "nope" })).toEqual({
			code: "unknown",
			raw: "[object Object]",
		});
	});

	it("wraps a half-shaped error rather than trusting it", () => {
		expect(toGitError({ code: "auth_failed" }).code).toBe("unknown");
		expect(toGitError({ raw: "text" }).code).toBe("unknown");
		expect(toGitError({ code: 1, raw: "text" }).code).toBe("unknown");
	});

	/**
	 * The shape check does not verify the code against GIT_ERROR_CODES, so an
	 * unknown code from a newer backend passes through as-is rather than being
	 * flattened to "unknown". Callers guard with isKnownGitErrorCode.
	 */
	it("lets an unrecognised code through, as the shape check allows", () => {
		const error = { code: "from_a_newer_backend", raw: "text" };
		expect(toGitError(error)).toBe(error);
		expect(isKnownGitErrorCode(error.code)).toBe(false);
	});

	it("always answers with something a caller can render", () => {
		for (const value of [undefined, null, 0, "", [], {}, new Error("x")]) {
			const result = toGitError(value);
			expect(typeof result.code, String(value)).toBe("string");
			expect(typeof result.raw, String(value)).toBe("string");
		}
	});
});

describe("commit", () => {
	it("sends the message and the worktree", async () => {
		await commit("/repo", "feat: add thing");
		expect(mockInvoke).toHaveBeenCalledWith(
			"git_commit",
			expect.objectContaining({
				worktreePath: "/repo",
				message: "feat: add thing",
			}),
		);
	});

	it("defaults every flag to off rather than leaving it undefined", async () => {
		await commit("/repo", "msg");
		expect(lastPayload()).toEqual({
			worktreePath: "/repo",
			message: "msg",
			noVerify: false,
			signOff: false,
			allowEmpty: false,
			authorName: "",
			authorEmail: "",
		});
	});

	it("carries the flags the caller does set", async () => {
		await commit("/repo", "msg", {
			noVerify: true,
			signOff: true,
			allowEmpty: true,
		});
		expect(lastPayload()).toMatchObject({
			noVerify: true,
			signOff: true,
			allowEmpty: true,
		});
	});

	it("carries an author identity when one is applied", async () => {
		await commit("/repo", "msg", {
			authorName: "Ada",
			authorEmail: "ada@example.com",
		});
		expect(lastPayload()).toMatchObject({
			authorName: "Ada",
			authorEmail: "ada@example.com",
		});
	});

	it("keeps an explicit false rather than replacing it with the default", async () => {
		await commit("/repo", "msg", { noVerify: false });
		expect(lastPayload()).toMatchObject({ noVerify: false });
	});

	it("sends a multiline message whole", async () => {
		await commit("/repo", "subject\n\nbody line one\nbody line two");
		expect(lastPayload()).toMatchObject({
			message: "subject\n\nbody line one\nbody line two",
		});
	});

	it("answers with the hash the backend reports", async () => {
		mockInvoke.mockResolvedValue("abc1234");
		await expect(commit("/repo", "msg")).resolves.toBe("abc1234");
	});

	it("lets a git failure reach the caller", async () => {
		const error: GitError = { code: "nothing_to_commit", raw: "nothing" };
		mockInvoke.mockRejectedValue(error);
		await expect(commit("/repo", "msg")).rejects.toBe(error);
	});
});

describe("amendCommit", () => {
	it("defaults its flags to off, and carries no allowEmpty", async () => {
		await amendCommit("/repo", "msg");
		expect(lastPayload()).toEqual({
			worktreePath: "/repo",
			message: "msg",
			noVerify: false,
			signOff: false,
			authorName: "",
			authorEmail: "",
		});
	});

	it("carries the flags it is given", async () => {
		await amendCommit("/repo", "msg", { noVerify: true, authorName: "Ada" });
		expect(lastPayload()).toMatchObject({
			noVerify: true,
			authorName: "Ada",
		});
	});
});

describe("operations that can stop on conflicts", () => {
	it("reports a conflicted merge as a result, not as a failure", async () => {
		mockInvoke.mockResolvedValue({
			ok: true,
			hasConflicts: true,
			conflictedFiles: ["a.ts", "b.ts"],
			output: "CONFLICT",
		});
		const result = await merge("/repo", "feature");
		expect(result.hasConflicts).toBe(true);
		expect(result.conflictedFiles).toEqual(["a.ts", "b.ts"]);
	});

	it("reports a clean merge with no conflicted file", async () => {
		mockInvoke.mockResolvedValue({
			ok: true,
			hasConflicts: false,
			conflictedFiles: [],
			output: "Fast-forward",
		});
		await expect(merge("/repo", "feature")).resolves.toMatchObject({
			hasConflicts: false,
		});
	});

	it("still throws on a real failure", async () => {
		const error: GitError = { code: "dirty_worktree", raw: "uncommitted" };
		mockInvoke.mockRejectedValue(error);
		await expect(merge("/repo", "feature")).rejects.toBe(error);
	});
});

describe("push", () => {
	it("sends the branch, the upstream flag and force", async () => {
		mockInvoke.mockResolvedValue("");
		await push("/repo", true, "main");
		expect(lastPayload()).toEqual({
			worktreePath: "/repo",
			setUpstream: true,
			branch: "main",
			force: false,
			mode: "normal",
		});
	});

	it("defaults force to off", async () => {
		mockInvoke.mockResolvedValue("");
		await push("/repo", false, "main");
		expect(lastPayload()).toMatchObject({ force: false });
	});

	it("carries an explicit force", async () => {
		mockInvoke.mockResolvedValue("");
		await push("/repo", false, "main", true);
		expect(lastPayload()).toMatchObject({ force: true });
	});

	it("lets an auth failure through for the caller to classify", async () => {
		const error: GitError = { code: "auth_required", raw: "credentials" };
		mockInvoke.mockRejectedValue(error);
		await expect(push("/repo", false, "main")).rejects.toBe(error);
		expect(toGitError(error).code).toBe("auth_required");
	});
});
