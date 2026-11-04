// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	lspDidChange,
	lspDidClose,
	lspDidOpen,
	lspDidSave,
} from "#lib/services/lsp-service";
import {
	clearDiagnosticsFor,
	ensureDocument,
	forgetDocument,
} from "#lib/stores/language-server";
import { LSP_CHANGE_DEBOUNCE_MS } from "#lib/utils/timing";
import type { LspContentChange } from "./document-model";
import { LspDocSync } from "./lsp-doc-sync";

vi.mock("#lib/services/lsp-service", () => ({
	lspDidChange: vi.fn(),
	lspDidClose: vi.fn(),
	lspDidOpen: vi.fn(),
	lspDidSave: vi.fn(),
}));
vi.mock("#lib/stores/language-server", () => ({
	clearDiagnosticsFor: vi.fn(),
	ensureDocument: vi.fn(),
	forgetDocument: vi.fn(),
}));

const ensure = vi.mocked(ensureDocument);

const docRef = (path: string) => ({ serverId: "ts", root: "/wt", path });
const edit = (text: string): LspContentChange => ({ text });

let sync: LspDocSync;

async function openDoc(absolute: string) {
	ensure.mockResolvedValueOnce(docRef(absolute));
	return sync.open("/wt", absolute, "typescript", () => "content");
}

beforeEach(() => {
	vi.useFakeTimers();
	for (const fn of [lspDidChange, lspDidClose, lspDidOpen, lspDidSave]) {
		vi.mocked(fn)
			.mockReset()
			.mockResolvedValue(undefined as never);
	}
	ensure.mockReset();
	vi.mocked(clearDiagnosticsFor).mockReset();
	vi.mocked(forgetDocument).mockReset();
	sync = new LspDocSync();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("LspDocSync open", () => {
	it("returns null and tracks nothing for a file no server covers", async () => {
		ensure.mockResolvedValueOnce(null);
		const doc = await sync.open("/wt", "/wt/a.txt", "plaintext", () => "x");
		expect(doc).toBeNull();
		expect(sync.get("/wt/a.txt")).toBeNull();
		expect(lspDidOpen).not.toHaveBeenCalled();
	});

	it("tracks the document and announces its text", async () => {
		const doc = await openDoc("/wt/a.ts");
		expect(doc).toEqual(docRef("/wt/a.ts"));
		expect(sync.get("/wt/a.ts")).toEqual(docRef("/wt/a.ts"));
		expect(ensure).toHaveBeenCalledWith("/wt", "/wt/a.ts");
		expect(lspDidOpen).toHaveBeenCalledWith(
			docRef("/wt/a.ts"),
			"typescript",
			"content",
		);
	});

	it("forgets a document the server refused to open", async () => {
		vi.mocked(lspDidOpen).mockRejectedValueOnce(new Error("refused"));
		const doc = await openDoc("/wt/a.ts");
		expect(doc).toEqual(docRef("/wt/a.ts"));
		expect(sync.get("/wt/a.ts")).toBeNull();
		expect(forgetDocument).toHaveBeenCalledWith(docRef("/wt/a.ts"));
	});
});

describe("LspDocSync change", () => {
	it("batches the edits of a burst into one debounced didChange", async () => {
		await openDoc("/wt/a.ts");
		sync.change("/wt/a.ts", [edit("a")]);
		vi.advanceTimersByTime(LSP_CHANGE_DEBOUNCE_MS - 1);
		sync.change("/wt/a.ts", [edit("b"), edit("c")]);
		vi.advanceTimersByTime(LSP_CHANGE_DEBOUNCE_MS - 1);
		expect(lspDidChange).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(lspDidChange).toHaveBeenCalledTimes(1);
		expect(lspDidChange).toHaveBeenCalledWith(docRef("/wt/a.ts"), [
			edit("a"),
			edit("b"),
			edit("c"),
		]);
	});

	it("ignores an empty change list and an unknown document", async () => {
		await openDoc("/wt/a.ts");
		sync.change("/wt/a.ts", []);
		sync.change("/wt/other.ts", [edit("a")]);
		vi.advanceTimersByTime(LSP_CHANGE_DEBOUNCE_MS);
		expect(lspDidChange).not.toHaveBeenCalled();
	});

	it("keeps the queues of two documents apart", async () => {
		await openDoc("/wt/a.ts");
		await openDoc("/wt/b.ts");
		sync.change("/wt/a.ts", [edit("a")]);
		sync.change("/wt/b.ts", [edit("b")]);
		vi.advanceTimersByTime(LSP_CHANGE_DEBOUNCE_MS);
		expect(vi.mocked(lspDidChange).mock.calls).toEqual([
			[docRef("/wt/a.ts"), [edit("a")]],
			[docRef("/wt/b.ts"), [edit("b")]],
		]);
	});

	it("swallows a failing didChange", async () => {
		vi.mocked(lspDidChange).mockRejectedValueOnce(new Error("down"));
		await openDoc("/wt/a.ts");
		sync.change("/wt/a.ts", [edit("a")]);
		expect(() => vi.advanceTimersByTime(LSP_CHANGE_DEBOUNCE_MS)).not.toThrow();
		expect(lspDidChange).toHaveBeenCalledTimes(1);
	});
});

describe("LspDocSync flush, saved and close", () => {
	it("sends nothing when no edit is queued", async () => {
		const doc = (await openDoc("/wt/a.ts")) as ReturnType<typeof docRef>;
		sync.flush(doc);
		expect(lspDidChange).not.toHaveBeenCalled();
	});

	it("flushes queued edits before announcing the save", async () => {
		await openDoc("/wt/a.ts");
		sync.change("/wt/a.ts", [edit("a")]);
		sync.saved("/wt/a.ts", "saved text");
		expect(vi.mocked(lspDidChange).mock.invocationCallOrder[0]).toBeLessThan(
			vi.mocked(lspDidSave).mock.invocationCallOrder[0],
		);
		expect(lspDidChange).toHaveBeenCalledWith(docRef("/wt/a.ts"), [edit("a")]);
		expect(lspDidSave).toHaveBeenCalledWith(docRef("/wt/a.ts"), "saved text");
		vi.advanceTimersByTime(LSP_CHANGE_DEBOUNCE_MS);
		expect(lspDidChange).toHaveBeenCalledTimes(1);
	});

	it("restarts the debounce window for edits made after a flush", async () => {
		await openDoc("/wt/a.ts");
		sync.change("/wt/a.ts", [edit("a")]);
		vi.advanceTimersByTime(LSP_CHANGE_DEBOUNCE_MS / 2);
		sync.saved("/wt/a.ts", "text");
		sync.change("/wt/a.ts", [edit("b")]);
		vi.advanceTimersByTime(LSP_CHANGE_DEBOUNCE_MS / 2);
		expect(lspDidChange).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(LSP_CHANGE_DEBOUNCE_MS / 2);
		expect(lspDidChange).toHaveBeenCalledTimes(2);
	});

	it("does not resend flushed edits with the next batch", async () => {
		await openDoc("/wt/a.ts");
		sync.change("/wt/a.ts", [edit("a")]);
		sync.saved("/wt/a.ts", "text");
		sync.change("/wt/a.ts", [edit("b")]);
		vi.advanceTimersByTime(LSP_CHANGE_DEBOUNCE_MS);
		expect(vi.mocked(lspDidChange).mock.calls).toEqual([
			[docRef("/wt/a.ts"), [edit("a")]],
			[docRef("/wt/a.ts"), [edit("b")]],
		]);
	});

	it("ignores the save of an unknown document", () => {
		sync.saved("/wt/unknown.ts", "text");
		expect(lspDidSave).not.toHaveBeenCalled();
	});

	it("closes a document and drops its queued edits", async () => {
		await openDoc("/wt/a.ts");
		sync.change("/wt/a.ts", [edit("a")]);
		sync.close("/wt/a.ts");
		vi.advanceTimersByTime(LSP_CHANGE_DEBOUNCE_MS);
		expect(lspDidChange).not.toHaveBeenCalled();
		expect(sync.get("/wt/a.ts")).toBeNull();
		expect(clearDiagnosticsFor).toHaveBeenCalledWith("/wt/a.ts");
		expect(lspDidClose).toHaveBeenCalledWith(docRef("/wt/a.ts"));
	});

	it("leaves no timer or queue behind for a reopened document", async () => {
		await openDoc("/wt/a.ts");
		sync.change("/wt/a.ts", [edit("a")]);
		vi.advanceTimersByTime(LSP_CHANGE_DEBOUNCE_MS / 2);
		sync.close("/wt/a.ts");
		await openDoc("/wt/a.ts");
		sync.change("/wt/a.ts", [edit("b")]);
		vi.advanceTimersByTime(LSP_CHANGE_DEBOUNCE_MS / 2);
		expect(lspDidChange).not.toHaveBeenCalled();
		vi.advanceTimersByTime(LSP_CHANGE_DEBOUNCE_MS / 2);
		expect(vi.mocked(lspDidChange).mock.calls).toEqual([
			[docRef("/wt/a.ts"), [edit("b")]],
		]);
	});

	it("ignores the close of an unknown document", () => {
		sync.close("/wt/unknown.ts");
		expect(lspDidClose).not.toHaveBeenCalled();
		expect(clearDiagnosticsFor).not.toHaveBeenCalled();
	});

	it("closes every held document at once", async () => {
		await openDoc("/wt/a.ts");
		await openDoc("/wt/b.ts");
		sync.closeAll();
		expect(vi.mocked(lspDidClose).mock.calls).toEqual([
			[docRef("/wt/a.ts")],
			[docRef("/wt/b.ts")],
		]);
		expect(sync.get("/wt/a.ts")).toBeNull();
		expect(sync.get("/wt/b.ts")).toBeNull();
	});
});
