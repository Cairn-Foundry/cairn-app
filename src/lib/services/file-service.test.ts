// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	copyPath,
	createFileOrDir,
	deletePath,
	type FlatTree,
	fileMtimes,
	gitLineHistory,
	gitStatus,
	inflateTree,
	isWriteConflict,
	listDirNames,
	listDirNamesDeep,
	openCliInTerminal,
	openInTerminal,
	quickSearch,
	readDirTree,
	readDirTreeCached,
	readFileBase64,
	readFilePreview,
	renamePath,
	revealInFileManager,
	searchInFiles,
	writeFile,
} from "./file-service";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
	mockInvoke.mockReset();
	mockInvoke.mockResolvedValue(undefined);
});

const FLAT: FlatTree = { names: "src/\na.ts", parents: [-1, 0], sep: "/" };
const INFLATED = [
	{
		name: "src",
		path: "src",
		isDir: true,
		children: [{ name: "a.ts", path: "src/a.ts", isDir: false }],
	},
];

describe("inflateTree", () => {
	it("rebuilds the hierarchy and the relative paths", () => {
		const tree = inflateTree({
			names: "src/\nlib/\na.ts\nb.ts\nREADME.md",
			parents: [-1, 0, 1, 0, -1],
			sep: "/",
		});
		expect(tree.map((n) => n.path)).toEqual(["src", "README.md"]);
		expect(tree[0].children?.map((n) => n.path)).toEqual([
			"src/lib",
			"src/b.ts",
		]);
		expect(tree[0].children?.[0].children?.[0]).toEqual({
			name: "a.ts",
			path: "src/lib/a.ts",
			isDir: false,
		});
		expect(tree[1].children).toBeUndefined();
	});

	it("answers an empty tree for an empty walk", () => {
		expect(inflateTree({ names: "", parents: [], sep: "/" })).toEqual([]);
	});
});

describe("readDirTree", () => {
	it("inflates the flat tree read for the worktree, hiding ignored files by default", async () => {
		mockInvoke.mockResolvedValue(FLAT);
		await expect(readDirTree("/tree/default")).resolves.toEqual(INFLATED);
		expect(mockInvoke).toHaveBeenCalledWith("read_dir_tree", {
			path: "/tree/default",
			showIgnored: false,
		});
	});

	it("asks for the ignored files when told to", async () => {
		mockInvoke.mockResolvedValue(FLAT);
		await readDirTree("/tree/ignored", true);
		expect(mockInvoke).toHaveBeenCalledWith("read_dir_tree", {
			path: "/tree/ignored",
			showIgnored: true,
		});
	});

	it("shares one read between concurrent callers of the same path and flag", async () => {
		mockInvoke.mockResolvedValue(FLAT);
		await Promise.all([
			readDirTree("/tree/shared"),
			readDirTree("/tree/shared"),
		]);
		expect(mockInvoke).toHaveBeenCalledTimes(1);
	});

	it("keeps the two ignore modes of a path apart", async () => {
		mockInvoke.mockResolvedValue(FLAT);
		await Promise.all([
			readDirTree("/tree/apart", false),
			readDirTree("/tree/apart", true),
		]);
		expect(mockInvoke).toHaveBeenCalledTimes(2);
	});
});

describe("readDirTreeCached", () => {
	it("inflates the cached tree, hiding ignored files by default", async () => {
		mockInvoke.mockResolvedValue(FLAT);
		await expect(readDirTreeCached("/w")).resolves.toEqual(INFLATED);
		expect(mockInvoke).toHaveBeenCalledWith("read_dir_tree_cached", {
			path: "/w",
			showIgnored: false,
		});
	});

	it("forwards the ignore flag", async () => {
		mockInvoke.mockResolvedValue(FLAT);
		await readDirTreeCached("/w", true);
		expect(mockInvoke).toHaveBeenCalledWith("read_dir_tree_cached", {
			path: "/w",
			showIgnored: true,
		});
	});

	it("answers null when nothing is cached", async () => {
		mockInvoke.mockResolvedValue(null);
		await expect(readDirTreeCached("/w")).resolves.toBeNull();
	});
});

describe("directory listing", () => {
	it("lists the names of a directory", async () => {
		mockInvoke.mockResolvedValue(["a", "b"]);
		await expect(listDirNames("/w")).resolves.toEqual(["a", "b"]);
		expect(mockInvoke).toHaveBeenCalledWith("list_dir_names", { path: "/w" });
	});

	it("lists the names of a directory down to a depth", async () => {
		mockInvoke.mockResolvedValue({ "": ["a"] });
		await expect(listDirNamesDeep("/w", 3)).resolves.toEqual({ "": ["a"] });
		expect(mockInvoke).toHaveBeenCalledWith("list_dir_names_deep", {
			path: "/w",
			depth: 3,
		});
	});
});

describe("quickSearch", () => {
	it("caps the hits at 50 by default", async () => {
		mockInvoke.mockResolvedValue([{ path: "a", isDir: false }]);
		await expect(quickSearch("/w", "a", true, false)).resolves.toEqual([
			{ path: "a", isDir: false },
		]);
		expect(mockInvoke).toHaveBeenCalledWith("quick_search", {
			path: "/w",
			query: "a",
			includeIgnored: true,
			refresh: false,
			limit: 50,
		});
	});

	it("forwards an explicit limit and refresh", async () => {
		await quickSearch("/w", "q", false, true, 7);
		expect(mockInvoke).toHaveBeenCalledWith("quick_search", {
			path: "/w",
			query: "q",
			includeIgnored: false,
			refresh: true,
			limit: 7,
		});
	});
});

describe("file metadata and previews", () => {
	it("reads the modification times of the paths", async () => {
		mockInvoke.mockResolvedValue({ "/w/a": 5 });
		await expect(fileMtimes(["/w/a"])).resolves.toEqual({ "/w/a": 5 });
		expect(mockInvoke).toHaveBeenCalledWith("file_mtimes", { paths: ["/w/a"] });
	});

	it("reads a file preview", async () => {
		mockInvoke.mockResolvedValue({ size: 4, headHex: "00ff" });
		await expect(readFilePreview("/w/a")).resolves.toEqual({
			size: 4,
			headHex: "00ff",
		});
		expect(mockInvoke).toHaveBeenCalledWith("read_file_preview", {
			path: "/w/a",
		});
	});

	it("reads a file as base64", async () => {
		mockInvoke.mockResolvedValue("AAEC");
		await expect(readFileBase64("/w/a")).resolves.toBe("AAEC");
		expect(mockInvoke).toHaveBeenCalledWith("read_file_base64", {
			path: "/w/a",
		});
	});
});

describe("isWriteConflict", () => {
	it("recognises a conflict outcome", () => {
		expect(
			isWriteConflict({
				kind: "conflict",
				expectedVersion: "a",
				actualVersion: "b",
			}),
		).toBe(true);
	});

	it("does not take a plain write for a conflict", () => {
		expect(isWriteConflict({ version: "v2" })).toBe(false);
		expect(isWriteConflict({ version: null })).toBe(false);
	});

	it("does not take another kind for a conflict", () => {
		expect(
			isWriteConflict({ kind: "other", version: "v" } as unknown as Parameters<
				typeof isWriteConflict
			>[0]),
		).toBe(false);
	});
});

describe("writeFile", () => {
	it("writes unconditionally by default", async () => {
		mockInvoke.mockResolvedValue({ version: "v1" });
		await expect(writeFile("/w/a", "body")).resolves.toEqual({ version: "v1" });
		expect(mockInvoke).toHaveBeenCalledWith("write_file", {
			path: "/w/a",
			content: "body",
			expectedVersion: null,
			checkOnly: false,
		});
	});

	it("forwards the expected version and the check-only flag", async () => {
		await writeFile("/w/a", "body", "v1", true);
		expect(mockInvoke).toHaveBeenCalledWith("write_file", {
			path: "/w/a",
			content: "body",
			expectedVersion: "v1",
			checkOnly: true,
		});
	});
});

describe("path operations", () => {
	it("deletes a path", async () => {
		await deletePath("/w/a");
		expect(mockInvoke).toHaveBeenCalledWith("delete_path", { path: "/w/a" });
	});

	it("renames a path", async () => {
		await renamePath("/w/a", "/w/b");
		expect(mockInvoke).toHaveBeenCalledWith("rename_path", {
			from: "/w/a",
			to: "/w/b",
		});
	});

	it("creates a file or a directory", async () => {
		await createFileOrDir("/w/d", true);
		expect(mockInvoke).toHaveBeenCalledWith("create_file_or_dir", {
			path: "/w/d",
			isDir: true,
		});
	});

	it("copies a path", async () => {
		await copyPath("/w/a", "/w/b");
		expect(mockInvoke).toHaveBeenCalledWith("copy_path", {
			from: "/w/a",
			to: "/w/b",
		});
	});

	it("reveals a path in the file manager", async () => {
		await revealInFileManager("/w/a");
		expect(mockInvoke).toHaveBeenCalledWith("reveal_in_file_manager", {
			path: "/w/a",
		});
	});

	it("opens a path in a terminal", async () => {
		await openInTerminal("/w");
		expect(mockInvoke).toHaveBeenCalledWith("open_in_terminal", { path: "/w" });
	});

	it("opens a CLI in a terminal", async () => {
		await openCliInTerminal("/w", ["claude", "--resume", "s1"]);
		expect(mockInvoke).toHaveBeenCalledWith("open_cli_in_terminal", {
			cwd: "/w",
			argv: ["claude", "--resume", "s1"],
		});
	});
});

describe("searchInFiles", () => {
	it("flattens the options into the payload", async () => {
		const hits = [
			{
				path: "a",
				line: 1,
				col: 2,
				text: "x",
				matchStart: 0,
				matchEnd: 1,
			},
		];
		mockInvoke.mockResolvedValue(hits);
		await expect(
			searchInFiles("/w", "x", {
				caseSensitive: true,
				isRegex: false,
				includeGlob: "*.ts",
				excludeGlob: "dist",
			}),
		).resolves.toBe(hits);
		expect(mockInvoke).toHaveBeenCalledWith("search_in_files", {
			root: "/w",
			query: "x",
			caseSensitive: true,
			isRegex: false,
			includeGlob: "*.ts",
			excludeGlob: "dist",
		});
	});
});

describe("gitStatus", () => {
	it("reads the status of the worktree", async () => {
		mockInvoke.mockResolvedValue({ "a.ts": "modified" });
		await expect(gitStatus("/status/one")).resolves.toEqual({
			"a.ts": "modified",
		});
		expect(mockInvoke).toHaveBeenCalledWith("git_status", {
			worktreePath: "/status/one",
		});
	});

	it("shares one read between concurrent callers", async () => {
		mockInvoke.mockResolvedValue({});
		await Promise.all([gitStatus("/status/two"), gitStatus("/status/two")]);
		expect(mockInvoke).toHaveBeenCalledTimes(1);
	});
});

describe("gitLineHistory", () => {
	const SOH = "\u0001";
	const US = "\u001f";
	const record = (...fields: string[]) => `${SOH}${fields.join(US)}`;
	const answer = (stdout: string) =>
		mockInvoke.mockResolvedValue({ stdout, stderr: "", success: true });

	it("asks git for the history of the line, capped at 30 commits", async () => {
		answer("");
		await expect(gitLineHistory("/w", "src/a.ts", 12)).resolves.toEqual([]);
		expect(mockInvoke).toHaveBeenCalledWith("run_shell_command", {
			program: "git",
			args: [
				"log",
				"-L12,12:src/a.ts",
				"--no-color",
				"-n30",
				"--format=%x01%H%x1f%an%x1f%ae%x1f%at%x1f%s",
			],
			cwd: "/w",
		});
	});

	it("parses each commit with its added and removed lines", async () => {
		answer(
			[
				record("abcdef1234567", "Ada", "ada@x.io", "100", "fix: a | b"),
				"",
				"diff --git a/a.ts b/a.ts",
				"--- a/a.ts",
				"+++ b/a.ts",
				"@@ -1,1 +1,1 @@",
				"-old",
				"+new",
				" context",
				record("1234567abcdef", "Bob", "bob@x.io", "50", "init"),
				"+first",
			].join("\n"),
		);
		await expect(gitLineHistory("/w", "a.ts", 1)).resolves.toEqual([
			{
				hash: "abcdef1234567",
				shortHash: "abcdef1",
				author: "Ada",
				email: "ada@x.io",
				timestamp: 100000,
				subject: "fix: a | b",
				changes: [
					{ type: "-", content: "old" },
					{ type: "+", content: "new" },
				],
			},
			{
				hash: "1234567abcdef",
				shortHash: "1234567",
				author: "Bob",
				email: "bob@x.io",
				timestamp: 50000,
				subject: "init",
				changes: [{ type: "+", content: "first" }],
			},
		]);
	});

	it("keeps a subject that itself contains the field separator", async () => {
		answer(record("h1", "Ada", "a@x", "1", "left", "right"));
		const [entry] = await gitLineHistory("/w", "a.ts", 1);
		expect(entry.subject).toBe(`left${US}right`);
	});

	it("fills in what a commit leaves out", async () => {
		answer(record("h1", "", "a@x", "nope", ""));
		const [entry] = await gitLineHistory("/w", "a.ts", 1);
		expect(entry.author).toBe("(unknown author)");
		expect(entry.subject).toBe("(no subject)");
		expect(entry.timestamp).toBe(0);
	});

	it("defaults the email of a truncated record to empty", async () => {
		answer(record("h1", "Ada"));
		const [entry] = await gitLineHistory("/w", "a.ts", 1);
		expect(entry.email).toBe("");
		expect(entry.timestamp).toBe(0);
	});

	it("skips a record without a hash", async () => {
		answer(
			[record(""), "+orphan", record("h2", "Ada", "a@x", "1", "s")].join("\n"),
		);
		const entries = await gitLineHistory("/w", "a.ts", 1);
		expect(entries.map((e) => e.hash)).toEqual(["h2"]);
		expect(entries[0].changes).toEqual([]);
	});

	it("ignores diff lines that come before the first commit", async () => {
		answer(
			["+stray", "-stray", record("h1", "Ada", "a@x", "1", "s")].join("\n"),
		);
		const entries = await gitLineHistory("/w", "a.ts", 1);
		expect(entries).toHaveLength(1);
		expect(entries[0].changes).toEqual([]);
	});

	it("raises what git said when it fails", async () => {
		mockInvoke.mockResolvedValue({
			stdout: "",
			stderr: "fatal: no such path",
			success: false,
		});
		await expect(gitLineHistory("/w", "a.ts", 1)).rejects.toThrow(
			"fatal: no such path",
		);
	});

	it("raises a generic message when git said nothing", async () => {
		mockInvoke.mockResolvedValue({ stdout: "", stderr: "", success: false });
		await expect(gitLineHistory("/w", "a.ts", 1)).rejects.toThrow(
			"git log -L failed",
		);
	});
});
