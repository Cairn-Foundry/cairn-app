import { describe, expect, it } from "vitest";
import { toGitError } from "$lib/services/git-service";
import { describeGitError } from "./git-error";

describe("toGitError", () => {
	it("passes a classified error through untouched", () => {
		const error = { code: "auth_failed" as const, raw: "denied" };
		expect(toGitError(error)).toBe(error);
	});

	it("wraps anything else as unknown while keeping its text", () => {
		expect(toGitError("boom")).toEqual({ code: "unknown", raw: "boom" });
	});
});

describe("describeGitError", () => {
	it("translates a known code and keeps the raw output", () => {
		const described = describeGitError({
			code: "no_remote",
			raw: "fatal: No configured push destination.",
		});
		expect(described.title).toBe("No remote configured");
		expect(described.hint).not.toBe("");
		expect(described.raw).toBe("fatal: No configured push destination.");
	});

	it("exposes the recovery action of the codes that have one", () => {
		expect(describeGitError({ code: "no_upstream", raw: "" }).action).toBe(
			"setUpstream",
		);
		expect(describeGitError({ code: "non_fast_forward", raw: "" }).action).toBe(
			"pullThenPush",
		);
		expect(describeGitError({ code: "lock_exists", raw: "" }).action).toBe(
			"removeLock",
		);
		expect(
			describeGitError({ code: "auth_failed", raw: "" }).action,
		).toBeNull();
	});

	it("falls back to the unknown message for an unmapped code", () => {
		const described = describeGitError({
			code: "brand_new_code" as never,
			raw: "fatal: whatever",
		});
		expect(described.title).toBe("Git operation failed");
		expect(described.raw).toBe("fatal: whatever");
	});
});
