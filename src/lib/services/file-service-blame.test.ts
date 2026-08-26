import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { gitBlame } from "./file-service";

const mockInvoke = vi.mocked(invoke);

/** One line as the backend reports it, with the fields blame fills in. */
function line(overrides: Record<string, unknown> = {}) {
	return {
		line: 1,
		hash: "abc1234",
		author: "Ada",
		timestamp: 1_700_000_000,
		summary: "feat: add thing",
		...overrides,
	};
}

beforeEach(() => {
	mockInvoke.mockReset();
});

describe("gitBlame", () => {
	it("keys every line by its number", async () => {
		mockInvoke.mockResolvedValue([
			line({ line: 1 }),
			line({ line: 2 }),
			line({ line: 7 }),
		]);
		const blame = await gitBlame("/repo", "a.ts");
		expect([...blame.keys()]).toEqual([1, 2, 7]);
	});

	it("carries the hash and the summary through", async () => {
		mockInvoke.mockResolvedValue([
			line({ hash: "deadbee", summary: "fix: thing" }),
		]);
		const entry = (await gitBlame("/repo", "a.ts")).get(1);
		expect(entry).toMatchObject({ hash: "deadbee", summary: "fix: thing" });
	});

	it("names an unknown author rather than leaving the gutter blank", async () => {
		mockInvoke.mockResolvedValue([line({ author: "" })]);
		expect((await gitBlame("/repo", "a.ts")).get(1)?.author).toBe(
			"(unknown author)",
		);
	});

	it("labels a commit with no summary", async () => {
		mockInvoke.mockResolvedValue([line({ summary: "" })]);
		expect((await gitBlame("/repo", "a.ts")).get(1)?.summary).toBe(
			"(no summary)",
		);
	});

	it("formats the timestamp as a date", async () => {
		const timestamp = 1_700_000_000;
		mockInvoke.mockResolvedValue([line({ timestamp })]);
		expect((await gitBlame("/repo", "a.ts")).get(1)?.date).toBe(
			new Date(timestamp * 1000).toLocaleDateString(),
		);
	});

	it("says unknown for a line with no timestamp", async () => {
		mockInvoke.mockResolvedValue([line({ timestamp: 0 })]);
		expect((await gitBlame("/repo", "a.ts")).get(1)?.date).toBe("unknown");
	});

	it("answers an empty map for an empty file", async () => {
		mockInvoke.mockResolvedValue([]);
		expect((await gitBlame("/repo", "a.ts")).size).toBe(0);
	});

	it("answers an empty map rather than throwing on a binary file", async () => {
		mockInvoke.mockRejectedValue("fatal: cannot blame binary file");
		await expect(gitBlame("/repo", "logo.png")).resolves.toEqual(new Map());
	});

	it("still throws on a failure that is not the binary case", async () => {
		mockInvoke.mockRejectedValue("fatal: no such path");
		await expect(gitBlame("/repo", "gone.ts")).rejects.toBe(
			"fatal: no such path",
		);
	});

	it("recognises the binary case inside an Error too", async () => {
		mockInvoke.mockRejectedValue(new Error("git: binary file detected"));
		await expect(gitBlame("/repo", "a.bin")).resolves.toEqual(new Map());
	});

	it("keeps the last entry when the backend repeats a line number", async () => {
		mockInvoke.mockResolvedValue([
			line({ line: 1, hash: "first" }),
			line({ line: 1, hash: "second" }),
		]);
		const blame = await gitBlame("/repo", "a.ts");
		expect(blame.size).toBe(1);
		expect(blame.get(1)?.hash).toBe("second");
	});

	it("asks the backend for the path it was given", async () => {
		mockInvoke.mockResolvedValue([]);
		await gitBlame("/repo", "src/a.ts");
		expect(mockInvoke).toHaveBeenCalledWith("git_blame_file", {
			worktreePath: "/repo",
			filePath: "src/a.ts",
		});
	});
});
