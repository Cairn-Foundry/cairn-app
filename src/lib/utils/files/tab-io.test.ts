// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileVersioned, writeFile } from "#lib/services/file-service";
import { docFromString } from "./document-model";
import type { Tab } from "./files-persistence";
import { diskContentOf, readTabFile, writeTab } from "./tab-io";

vi.mock("#lib/services/file-service", () => ({
	readFileVersioned: vi.fn(),
	writeFile: vi.fn(),
	isWriteConflict: (outcome: { kind?: string }) => outcome.kind === "conflict",
}));

const read = vi.mocked(readFileVersioned);
const write = vi.mocked(writeFile);

function tabOf(text: string, extra: Partial<Tab> = {}): Tab {
	return {
		path: "a.ts",
		doc: docFromString(text),
		savedDoc: docFromString(text),
		cursorPos: 0,
		scrollTop: 0,
		...extra,
	};
}

beforeEach(() => {
	read.mockReset();
	write.mockReset();
});

describe("readTabFile", () => {
	it("reads an LF file as is and keeps its version", async () => {
		read.mockResolvedValue({ text: "a\nb", version: "v1" });
		const result = await readTabFile("/wt/a.ts");
		expect(read).toHaveBeenCalledWith("/wt/a.ts");
		expect(result.doc.toString()).toBe("a\nb");
		expect(result.lineEndings).toBe("LF");
		expect(result.version).toBe("v1");
	});

	it("holds a CRLF file with LF inside and remembers the endings", async () => {
		read.mockResolvedValue({ text: "a\r\nb\r\n", version: "v2" });
		const result = await readTabFile("/wt/a.ts");
		expect(result.doc.toString()).toBe("a\nb\n");
		expect(result.lineEndings).toBe("CRLF");
		expect(result.version).toBe("v2");
	});

	it("reads an unreadable file as an empty document", async () => {
		read.mockResolvedValue({ text: null, version: null });
		const result = await readTabFile("/wt/bin");
		expect(result.doc.toString()).toBe("");
		expect(result.lineEndings).toBe("LF");
		expect(result.version).toBeNull();
	});
});

describe("diskContentOf", () => {
	it("writes LF content unchanged", () => {
		expect(diskContentOf(tabOf("a\nb", { lineEndings: "LF" }))).toBe("a\nb");
	});

	it("restores CRLF endings", () => {
		expect(diskContentOf(tabOf("a\nb", { lineEndings: "CRLF" }))).toBe(
			"a\r\nb",
		);
	});

	it("defaults to LF when the tab has no recorded endings", () => {
		expect(diskContentOf(tabOf("a\nb"))).toBe("a\nb");
	});
});

describe("writeTab", () => {
	it("writes with the version the tab was read with and records the new one", async () => {
		write.mockResolvedValue({ version: "v2" });
		const tab = tabOf("x", { version: "v1", conflicted: true });
		const outcome = await writeTab(tab, "x", "/wt/a.ts");
		expect(write).toHaveBeenCalledWith("/wt/a.ts", "x", "v1");
		expect(outcome).toEqual({ written: true });
		expect(tab.version).toBe("v2");
		expect(tab.conflicted).toBe(false);
	});

	it("writes unconditionally when the tab has no version", async () => {
		write.mockResolvedValue({ version: null });
		const tab = tabOf("x");
		await writeTab(tab, "x", "/wt/a.ts");
		expect(write).toHaveBeenCalledWith("/wt/a.ts", "x", null);
		expect(tab.version).toBeNull();
	});

	it("reports a conflict on a changed file and leaves the tab alone", async () => {
		write.mockResolvedValue({
			kind: "conflict",
			expectedVersion: "v1",
			actualVersion: "v3",
		});
		const tab = tabOf("x", { version: "v1" });
		const outcome = await writeTab(tab, "x", "/wt/a.ts");
		expect(outcome).toEqual({ written: false, deleted: false });
		expect(tab.version).toBe("v1");
		expect(tab.conflicted).toBeUndefined();
	});

	it("reports a conflict on a deleted file", async () => {
		write.mockResolvedValue({
			kind: "conflict",
			expectedVersion: "v1",
			actualVersion: null,
		});
		const outcome = await writeTab(tabOf("x", { version: "v1" }), "x", "/p");
		expect(outcome).toEqual({ written: false, deleted: true });
	});
});
