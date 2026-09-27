// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Terminal } from "@xterm/xterm";
import { describe, expect, it } from "vitest";
import {
	findLinkCandidates,
	readLogicalLine,
	resolveLinkPath,
} from "./terminal-links";

const paths = (text: string) =>
	findLinkCandidates(text).flatMap((c) =>
		c.kind === "path" ? [{ path: c.path, line: c.line, col: c.col }] : [],
	);

describe("findLinkCandidates", () => {
	it("reads a path with its line and column", () => {
		expect(paths("see src/lib/stores/conversation.ts:61:4 now")).toEqual([
			{ path: "src/lib/stores/conversation.ts", line: 61, col: 4 },
		]);
	});

	it("reads the compiler (line,col) form", () => {
		expect(paths("src/a.ts(12,3): error")).toEqual([
			{ path: "src/a.ts", line: 12, col: 3 },
		]);
	});

	it("defaults a bare path to the top of the file", () => {
		expect(paths("Edited ./README.md")).toEqual([
			{ path: "./README.md", line: 1, col: 1 },
		]);
	});

	it("spans the position suffix but not the sentence around it", () => {
		const text = "(in src/a.ts:3).";
		const [c] = findLinkCandidates(text);
		expect(text.slice(c.start, c.end)).toBe("src/a.ts:3");
	});

	it("drops the full stop ending a sentence", () => {
		expect(paths("Look at package.json.")).toEqual([
			{ path: "package.json", line: 1, col: 1 },
		]);
	});

	it("ignores plain words and numbers", () => {
		expect(paths("done in 3.14 seconds, all good")).toEqual([]);
	});

	it("leaves home-relative paths alone", () => {
		expect(paths("wrote ~/notes/today.md")).toEqual([]);
	});

	it("keeps a URL whole and does not read a path inside it", () => {
		const found = findLinkCandidates(
			"open https://example.com/docs/a.html, then src/b.ts",
		);
		expect(found.map((c) => c.kind)).toEqual(["url", "path"]);
		expect(found[0]).toMatchObject({ url: "https://example.com/docs/a.html" });
	});
});

describe("resolveLinkPath", () => {
	it("reads a relative path against the base", () => {
		expect(resolveLinkPath("./src/../lib/a.ts", "/wt")).toBe("/wt/lib/a.ts");
	});

	it("keeps an absolute path", () => {
		expect(resolveLinkPath("/etc/hosts", "/wt")).toBe("/etc/hosts");
	});

	it("resolves nothing relative without a base", () => {
		expect(resolveLinkPath("src/a.ts", null)).toBeNull();
	});

	it("refuses to climb above the root", () => {
		expect(resolveLinkPath("/../a.ts", "/wt")).toBeNull();
	});
});

describe("readLogicalLine", () => {
	const written = (cols: number, text: string) =>
		new Promise<Terminal>((resolve) => {
			const term = new Terminal({ cols, rows: 5, allowProposedApi: true });
			term.write(text, () => resolve(term));
		});

	it("joins a path wrapped over several rows", async () => {
		const term = await written(10, "go src/lib/stores/a.ts:9");
		const line = readLogicalLine(term.buffer.active, 1);
		expect(line.text.trimEnd()).toBe("go src/lib/stores/a.ts:9");
		const [c] = findLinkCandidates(line.text);
		expect(line.cells[c.start]).toEqual({ x: 4, y: 1 });
		expect(line.cells[c.end - 1]).toEqual({ x: 4, y: 3 });
		term.dispose();
	});

	it("stops at a line that was not wrapped into", async () => {
		const term = await written(20, "first\r\nsecond");
		expect(readLogicalLine(term.buffer.active, 1).text.trimEnd()).toBe(
			"second",
		);
		term.dispose();
	});
});
