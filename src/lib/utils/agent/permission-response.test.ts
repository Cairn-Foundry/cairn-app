import { describe, expect, it } from "vitest";
import {
	buildPermissionResponse,
	type PendingPermission,
} from "./permission-response";

function request(
	overrides: Partial<PendingPermission> = {},
): PendingPermission {
	return {
		runId: "run-1",
		requestId: "req-1",
		toolName: "Bash",
		input: { command: "ls" },
		...overrides,
	};
}

describe("buildPermissionResponse", () => {
	it("denies with the message the caller supplies", () => {
		expect(buildPermissionResponse(request(), "deny", "refusé")).toEqual({
			behavior: "deny",
			message: "refusé",
		});
	});

	it("allows with the input the CLI asked about, untouched", () => {
		const input = { command: "rm -rf /", cwd: "/repo" };
		expect(buildPermissionResponse(request({ input }), "allow", "no")).toEqual({
			behavior: "allow",
			updatedInput: input,
		});
	});

	it("passes the input by reference rather than reshaping it", () => {
		const input = { nested: { deep: [1, 2] } };
		const res = buildPermissionResponse(request({ input }), "allow", "no");
		expect(res.behavior).toBe("allow");
		if (res.behavior !== "allow") return;
		expect(res.updatedInput).toBe(input);
	});

	it("widens a permission only with the provider's own suggestions", () => {
		const suggestions = [{ type: "addRules", rules: ["Bash(ls:*)"] }];
		const res = buildPermissionResponse(
			request({ suggestions }),
			"always",
			"no",
		);
		expect(res).toEqual({
			behavior: "allow",
			updatedInput: { command: "ls" },
			updatedPermissions: suggestions,
		});
	});

	it("stays a plain allow when always has nothing to widen with", () => {
		for (const suggestions of [undefined, []]) {
			const res = buildPermissionResponse(
				request({ suggestions }),
				"always",
				"no",
			);
			expect(res).toEqual({
				behavior: "allow",
				updatedInput: { command: "ls" },
			});
			expect(res).not.toHaveProperty("updatedPermissions");
		}
	});

	it("never widens a plain allow, even when suggestions are offered", () => {
		const res = buildPermissionResponse(
			request({ suggestions: [{ type: "addRules" }] }),
			"allow",
			"no",
		);
		expect(res).not.toHaveProperty("updatedPermissions");
	});

	it("carries an empty input rather than dropping the field", () => {
		const res = buildPermissionResponse(request({ input: {} }), "allow", "no");
		expect(res).toEqual({ behavior: "allow", updatedInput: {} });
	});

	it("denies with an empty message when that is what was given", () => {
		expect(buildPermissionResponse(request(), "deny", "")).toEqual({
			behavior: "deny",
			message: "",
		});
	});

	it("ignores the input entirely on a denial", () => {
		const res = buildPermissionResponse(
			request({ input: { secret: "x" } }),
			"deny",
			"no",
		);
		expect(res).not.toHaveProperty("updatedInput");
	});
});
