// The unified-diff parser is not exported; it is reached through the service
// calls that use it, with invoke mocked to hand over the diff text. That keeps
// the parser tested through the API the app actually calls.

import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	type DiffHunk,
	gitFileDiff,
	gitStagedFileDiff,
	hunkToPatch,
	isBinaryPath,
	langFromPath,
} from "./file-service";

const mockInvoke = vi.mocked(invoke);

/** Hands the next shell call the diff text it should answer with. */
function shellAnswers(stdout: string) {
	mockInvoke.mockResolvedValue({ stdout, stderr: "", success: true });
}

const diffOf = (worktree = "/repo", path = "a.ts") =>
	gitFileDiff(worktree, path);

beforeEach(() => {
	mockInvoke.mockReset();
});

describe("diff parsing: gutter marks", () => {
	it("marks a pure addition as added", async () => {
		shellAnswers(`@@ -1,2 +1,3 @@\n line one\n+inserted\n line two`);
		const { lineMap } = await diffOf();
		expect([...lineMap]).toEqual([[2, "added"]]);
	});

	it("marks a replaced line as modified, not as added", async () => {
		shellAnswers(`@@ -1,2 +1,2 @@\n context\n-old\n+new`);
		const { lineMap } = await diffOf();
		expect(lineMap.get(2)).toBe("modified");
	});

	it("marks a deletion with no replacement on the surviving line", async () => {
		shellAnswers(`@@ -1,3 +1,2 @@\n first\n-removed\n last`);
		const { lineMap } = await diffOf();
		expect(lineMap.get(2)).toBe("deleted");
	});

	it("marks a deletion at the very top of the file on line one", async () => {
		shellAnswers(`@@ -1,2 +1,1 @@\n-gone\n kept`);
		const { lineMap } = await diffOf();
		expect(lineMap.get(1)).toBe("deleted");
	});

	it("treats a multi-line block replaced by one line as modified", async () => {
		shellAnswers(`@@ -1,3 +1,1 @@\n-a\n-b\n+merged`);
		const { lineMap } = await diffOf();
		expect(lineMap.get(1)).toBe("modified");
		expect([...lineMap.values()]).not.toContain("deleted");
	});

	it("keeps a pure deletion and a later addition apart", async () => {
		shellAnswers(`@@ -1,4 +1,4 @@\n keep\n-dropped\n context\n+appended`);
		const { lineMap } = await diffOf();
		expect(lineMap.get(2)).toBe("deleted");
		expect(lineMap.get(3)).toBe("added");
	});

	it("does not overwrite an existing mark with a deletion", async () => {
		shellAnswers(`@@ -1,3 +1,3 @@\n-old\n+new\n-alsogone\n`);
		const { lineMap } = await diffOf();
		expect(lineMap.get(1)).toBe("modified");
	});
});

describe("diff parsing: hunks", () => {
	it("reads the line numbers off the hunk header", async () => {
		shellAnswers(`@@ -10,3 +20,4 @@\n ctx\n+added`);
		const { hunks } = await diffOf();
		expect(hunks).toHaveLength(1);
		expect(hunks[0].oldStart).toBe(10);
		expect(hunks[0].newStart).toBe(20);
	});

	it("accepts a header without a line count", async () => {
		shellAnswers(`@@ -1 +1 @@\n-a\n+b`);
		const { hunks } = await diffOf();
		expect(hunks[0]).toMatchObject({ oldStart: 1, newStart: 1 });
	});

	it("carries every line with its marker, marker stripped from the content", async () => {
		shellAnswers(`@@ -1,2 +1,2 @@\n kept\n-old\n+new`);
		const { hunks } = await diffOf();
		expect(hunks[0].lines).toEqual([
			{ type: " ", content: "kept" },
			{ type: "-", content: "old" },
			{ type: "+", content: "new" },
		]);
	});

	it("tracks the last line the hunk covers", async () => {
		shellAnswers(`@@ -1,3 +1,3 @@\n one\n two\n+three`);
		const { hunks } = await diffOf();
		expect(hunks[0].newEnd).toBe(3);
	});

	it("splits several hunks of one file", async () => {
		shellAnswers(`@@ -1,2 +1,2 @@\n a\n+b\n@@ -20,2 +21,2 @@\n c\n+d`);
		const { hunks } = await diffOf();
		expect(hunks).toHaveLength(2);
		expect(hunks.map((h) => h.newStart)).toEqual([1, 21]);
	});

	it("drops the file headers rather than taking them for content", async () => {
		shellAnswers(`--- a/x.ts\n+++ b/x.ts\n@@ -1,1 +1,1 @@\n-old\n+new`);
		const { hunks } = await diffOf();
		expect(hunks[0].lines).toEqual([
			{ type: "-", content: "old" },
			{ type: "+", content: "new" },
		]);
	});

	it("ignores the no-newline marker git appends", async () => {
		shellAnswers(`@@ -1,1 +1,1 @@\n-old\n+new\n\\ No newline at end of file`);
		const { hunks } = await diffOf();
		expect(hunks[0].lines).toHaveLength(2);
	});

	it("keeps no empty hunk", async () => {
		shellAnswers(`@@ -1,0 +1,0 @@\n@@ -5,1 +5,1 @@\n+real`);
		const { hunks } = await diffOf();
		expect(hunks).toHaveLength(1);
		expect(hunks[0].newStart).toBe(5);
	});

	it("skips a malformed header instead of throwing", async () => {
		shellAnswers(`@@ nonsense @@\n+orphan\n@@ -1,1 +1,1 @@\n+kept`);
		const { hunks } = await diffOf();
		expect(hunks).toHaveLength(1);
		expect(hunks[0].lines).toEqual([{ type: "+", content: "kept" }]);
	});

	it("ignores content before the first hunk header", async () => {
		shellAnswers(
			`diff --git a/x b/x\nindex 111..222 100644\n@@ -1,1 +1,1 @@\n+only`,
		);
		const { hunks } = await diffOf();
		expect(hunks[0].lines).toEqual([{ type: "+", content: "only" }]);
	});

	it("answers an empty result for an unchanged file", async () => {
		shellAnswers("");
		const { hunks, lineMap } = await diffOf();
		expect(hunks).toEqual([]);
		expect(lineMap.size).toBe(0);
	});
});

describe("gitFileDiff", () => {
	it("diffs against HEAD in the worktree it is given", async () => {
		shellAnswers("");
		await gitFileDiff("/repo", "src/a.ts");
		expect(mockInvoke).toHaveBeenCalledWith("run_shell_command", {
			program: "git",
			args: ["diff", "HEAD", "--", "src/a.ts"],
			cwd: "/repo",
		});
	});

	it("passes a path with spaces and accents through as one argument", async () => {
		shellAnswers("");
		await gitFileDiff("/repo", "dossier été/mon fichier.ts");
		const call = mockInvoke.mock.calls[0][1] as { args: string[] };
		expect(call.args).toContain("dossier été/mon fichier.ts");
	});
});

describe("gitStagedFileDiff", () => {
	it("reads the staged side with --cached", async () => {
		shellAnswers("");
		await gitStagedFileDiff("/repo", "a.ts");
		const call = mockInvoke.mock.calls[0][1] as { args: string[] };
		expect(call.args).toContain("--cached");
	});
});

describe("hunkToPatch", () => {
	const hunk: DiffHunk = {
		oldStart: 3,
		newStart: 3,
		newEnd: 5,
		lines: [
			{ type: " ", content: "context" },
			{ type: "-", content: "old" },
			{ type: "+", content: "new" },
		],
	};

	it("writes a patch git apply accepts", () => {
		expect(hunkToPatch("src/a.ts", hunk)).toBe(
			"--- a/src/a.ts\n" +
				"+++ b/src/a.ts\n" +
				"@@ -3,2 +3,2 @@\n" +
				" context\n" +
				"-old\n" +
				"+new\n",
		);
	});

	it("counts the old side from deletions and context", () => {
		const patch = hunkToPatch("a.ts", {
			...hunk,
			lines: [
				{ type: "-", content: "one" },
				{ type: "-", content: "two" },
				{ type: " ", content: "kept" },
			],
		});
		expect(patch).toContain("@@ -3,3 +3,1 @@");
	});

	it("counts the new side from additions and context", () => {
		const patch = hunkToPatch("a.ts", {
			...hunk,
			lines: [
				{ type: "+", content: "one" },
				{ type: "+", content: "two" },
				{ type: " ", content: "kept" },
			],
		});
		expect(patch).toContain("@@ -3,1 +3,3 @@");
	});

	it("ends with a newline, which git apply requires", () => {
		expect(hunkToPatch("a.ts", hunk).endsWith("\n")).toBe(true);
	});

	it("keeps an empty line in the hunk", () => {
		const patch = hunkToPatch("a.ts", {
			...hunk,
			lines: [{ type: " ", content: "" }],
		});
		expect(patch).toContain("@@ -3,1 +3,1 @@\n \n");
	});

	it("writes a path with spaces unquoted, as the unified format does", () => {
		expect(hunkToPatch("my file.ts", hunk)).toContain("--- a/my file.ts");
	});

	it("round-trips a parsed hunk back to a patch", async () => {
		shellAnswers(`@@ -3,2 +3,2 @@\n context\n-old\n+new`);
		const { hunks } = await diffOf();
		expect(hunkToPatch("src/a.ts", hunks[0])).toBe(
			hunkToPatch("src/a.ts", hunk),
		);
	});
});

describe("langFromPath", () => {
	it("reads the mode off the extension", () => {
		expect(langFromPath("a.ts")).toBe(langFromPath("b.ts"));
		expect(langFromPath("main.rs")).not.toBe("text");
		expect(langFromPath("index.html")).not.toBe("text");
	});

	it("ignores the case of the extension", () => {
		expect(langFromPath("A.TS")).toBe(langFromPath("a.ts"));
	});

	it("falls back to text for an unknown or missing extension", () => {
		expect(langFromPath("file.unknownext")).toBe("text");
		expect(langFromPath("Makefile")).toBe("text");
		expect(langFromPath("")).toBe("text");
	});

	it("reads the last extension of a double-barrelled name", () => {
		expect(langFromPath("archive.tar.ts")).toBe(langFromPath("a.ts"));
	});

	it("treats a dotfile's name as its extension", () => {
		expect(typeof langFromPath(".gitignore")).toBe("string");
	});

	it("reads the extension through a full path with directories", () => {
		expect(langFromPath("/a/b/c/main.rs")).toBe(langFromPath("main.rs"));
	});
});

describe("isBinaryPath", () => {
	it("recognises a binary extension", () => {
		expect(isBinaryPath("logo.png")).toBe(true);
		expect(isBinaryPath("db.sqlite3")).toBe(true);
	});

	it("leaves source files alone", () => {
		expect(isBinaryPath("a.ts")).toBe(false);
		expect(isBinaryPath("README.md")).toBe(false);
	});

	it("ignores the case of the extension", () => {
		expect(isBinaryPath("LOGO.PNG")).toBe(true);
	});

	it("says no for a file with no extension", () => {
		expect(isBinaryPath("Makefile")).toBe(false);
		expect(isBinaryPath("")).toBe(false);
	});
});
