// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lspSignatureHelp } from "#lib/services/lsp-service";
import { openUrl } from "#lib/services/opener-service";
import {
	activeParameterRange,
	applyEditsToText,
	buildLspExtensions,
	buildSymbolClickAffordance,
	offsetToPosition,
	positionToOffset,
	rangeToOffsets,
} from "./editor-lsp";

vi.mock("#lib/services/lsp-service", () => ({
	lspCompletion: vi.fn(),
	lspHover: vi.fn(),
	lspSignatureHelp: vi.fn(),
}));

vi.mock("#lib/services/opener-service", () => ({
	openUrl: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});

afterEach(() => {
	vi.useRealTimers();
});

const at = (line: number, character: number) => ({ line, character });

describe("applyEditsToText", () => {
	it("replaces a range on a single line", () => {
		expect(
			applyEditsToText("const user = 1;", [
				{ range: { start: at(0, 6), end: at(0, 10) }, newText: "account" },
			]),
		).toBe("const account = 1;");
	});

	it("applies several edits without shifting the later ones", () => {
		const text = "a user;\nb user;\n";
		const edits = [
			{ range: { start: at(0, 2), end: at(0, 6) }, newText: "account" },
			{ range: { start: at(1, 2), end: at(1, 6) }, newText: "account" },
		];
		expect(applyEditsToText(text, edits)).toBe("a account;\nb account;\n");
	});

	it("inserts on an empty range", () => {
		expect(
			applyEditsToText("ab", [
				{ range: { start: at(0, 1), end: at(0, 1) }, newText: "X" },
			]),
		).toBe("aXb");
	});

	it("spans several lines", () => {
		expect(
			applyEditsToText("one\ntwo\nthree", [
				{ range: { start: at(0, 1), end: at(2, 2) }, newText: "-" },
			]),
		).toBe("o-ree");
	});

	it("clamps a character beyond the end of its line", () => {
		expect(
			applyEditsToText("ab\ncd", [
				{ range: { start: at(0, 99), end: at(0, 99) }, newText: "!" },
			]),
		).toBe("ab!\ncd");
	});

	it("clamps a line beyond the end of the document", () => {
		expect(
			applyEditsToText("ab", [
				{ range: { start: at(9, 0), end: at(9, 0) }, newText: "!" },
			]),
		).toBe("ab!");
	});

	it("addresses the line after a leading newline", () => {
		expect(
			applyEditsToText("\nab", [
				{ range: { start: at(1, 0), end: at(1, 0) }, newText: "X" },
			]),
		).toBe("\nXab");
	});

	it("appends at the end when the line is the one just past the last", () => {
		expect(
			applyEditsToText("ab", [
				{ range: { start: at(1, 0), end: at(1, 0) }, newText: "!" },
			]),
		).toBe("ab!");
	});

	it("clamps a negative character to the start of the line", () => {
		expect(
			applyEditsToText("ab", [
				{ range: { start: at(0, -3), end: at(0, -3) }, newText: "X" },
			]),
		).toBe("Xab");
	});

	it("leaves the text untouched when there is nothing to do", () => {
		expect(applyEditsToText("ab", [])).toBe("ab");
	});
});

describe("activeParameterRange", () => {
	const signature = {
		label: "greet(name: string, times: number): void",
		parameters: [{ label: "name: string" }, { label: "times: number" }],
	};

	it("finds a parameter given as a substring of the label", () => {
		expect(activeParameterRange(signature, 0)).toEqual([6, 18]);
		expect(activeParameterRange(signature, 1)).toEqual([20, 33]);
	});

	it("takes a parameter given as offsets as it is", () => {
		const withOffsets = {
			label: "greet(name, times)",
			parameters: [{ label: [6, 10] as [number, number] }],
		};
		expect(activeParameterRange(withOffsets, 0)).toEqual([6, 10]);
	});

	it("has nothing to highlight without an active parameter", () => {
		expect(activeParameterRange(signature, undefined)).toBeNull();
		expect(activeParameterRange(signature, 9)).toBeNull();
		expect(activeParameterRange({ label: "f()" }, 0)).toBeNull();
	});

	it("finds a parameter that opens the label", () => {
		expect(
			activeParameterRange(
				{ label: "name: string", parameters: [{ label: "name: string" }] },
				0,
			),
		).toEqual([0, 12]);
	});

	it("gives up rather than guess when the label does not hold the parameter", () => {
		const mismatched = {
			label: "greet(a, b)",
			parameters: [{ label: "nowhere: string" }],
		};
		expect(activeParameterRange(mismatched, 0)).toBeNull();
	});
});

describe("position conversion", () => {
	const doc = Text.of(["one", "two", "three"]);

	it("turns an offset into a zero-based line and character", () => {
		expect(offsetToPosition(doc, 0)).toEqual(at(0, 0));
		expect(offsetToPosition(doc, 5)).toEqual(at(1, 1));
		expect(offsetToPosition(doc, 8)).toEqual(at(2, 0));
	});

	it("clamps an offset outside the document", () => {
		expect(offsetToPosition(doc, -4)).toEqual(at(0, 0));
		expect(offsetToPosition(doc, 99)).toEqual(at(2, 5));
	});

	it("turns a position into an offset", () => {
		expect(positionToOffset(doc, at(0, 0))).toBe(0);
		expect(positionToOffset(doc, at(1, 2))).toBe(6);
		expect(positionToOffset(doc, at(2, 5))).toBe(13);
	});

	it("clamps a position past its line or past the document", () => {
		expect(positionToOffset(doc, at(0, 99))).toBe(3);
		expect(positionToOffset(doc, at(1, -3))).toBe(4);
		expect(positionToOffset(doc, at(99, 0))).toBe(8);
		expect(positionToOffset(doc, at(-5, 1))).toBe(1);
	});

	it("converts a range to offsets", () => {
		expect(rangeToOffsets(doc, { start: at(0, 1), end: at(1, 1) })).toEqual({
			from: 1,
			to: 5,
		});
	});

	it("swaps a reversed range", () => {
		expect(rangeToOffsets(doc, { start: at(1, 1), end: at(0, 1) })).toEqual({
			from: 1,
			to: 5,
		});
	});
});

describe("signature help", () => {
	const docRef = { root: "/repo", path: "/repo/a.ts" } as never;
	const help = {
		signatures: [
			{
				label: "greet(name: string, times: number)",
				parameters: [{ label: "name: string" }, { label: "times: number" }],
			},
		],
		activeSignature: 0,
		activeParameter: 0,
	};
	let view: EditorView;
	let getDoc: () => unknown;

	beforeEach(() => {
		vi.mocked(lspSignatureHelp).mockReset();
		getDoc = () => docRef;
	});

	afterEach(() => {
		view.destroy();
	});

	function mount(doc: string) {
		view = new EditorView({
			doc,
			extensions: [buildLspExtensions(() => getDoc() as never)],
			parent: document.body,
		});
	}

	function type(text: string) {
		const head = view.state.selection.main.head;
		view.dispatch({
			changes: { from: head, insert: text },
			selection: { anchor: head + text.length },
		});
	}

	const tooltip = () => view.dom.querySelector(".cm-lsp-signature");

	async function openTooltip() {
		vi.mocked(lspSignatureHelp).mockResolvedValue(help);
		mount("greet");
		view.dispatch({ selection: { anchor: 5 } });
		type("(");
		await vi.waitFor(() => expect(tooltip()).not.toBeNull());
	}

	it("asks the server at the cursor when a call is opened", async () => {
		await openTooltip();
		expect(lspSignatureHelp).toHaveBeenCalledTimes(1);
		expect(lspSignatureHelp).toHaveBeenCalledWith(docRef, at(0, 6));
		expect(
			tooltip()?.querySelector(".cm-lsp-signature-active")?.textContent,
		).toBe("name: string");
	});

	async function openWith(custom: unknown) {
		vi.mocked(lspSignatureHelp).mockResolvedValue(custom as never);
		mount("greet");
		view.dispatch({ selection: { anchor: 5 } });
		type("(");
		await vi.waitFor(() => expect(tooltip()).not.toBeNull());
	}

	it("renders plain string documentation under the label", async () => {
		await openWith({
			signatures: [{ label: "greet()", documentation: "Says hello" }],
		});
		expect(
			tooltip()?.querySelector(".cm-lsp-signature-label")?.textContent,
		).toBe("greet()");
		expect(tooltip()?.querySelector(".cm-lsp-prose p")?.textContent).toBe(
			"Says hello",
		);
	});

	it("shows the whole label around the emphasized parameter", async () => {
		await openTooltip();
		const label = tooltip()?.querySelector(".cm-lsp-signature-label");
		expect(label?.textContent).toBe("greet(name: string, times: number)");
		expect(label?.firstChild?.textContent).toBe("greet(");
		expect(label?.lastChild?.textContent).toBe(", times: number)");
	});

	it("emphasizes a parameter that opens the label", async () => {
		await openWith({
			signatures: [
				{ label: "name: string", parameters: [{ label: "name: string" }] },
			],
			activeParameter: 0,
		});
		expect(
			tooltip()?.querySelector(".cm-lsp-signature-active")?.textContent,
		).toBe("name: string");
	});

	it("renders no documentation block when the signature has none", async () => {
		await openWith({ signatures: [{ label: "greet()" }] });
		expect(tooltip()?.querySelector(".cm-lsp-prose")).toBeNull();
	});

	it("takes the first signature when none is marked active", async () => {
		await openWith({
			signatures: [{ label: "first()" }, { label: "second()" }],
		});
		expect(
			tooltip()?.querySelector(".cm-lsp-signature-label")?.textContent,
		).toBe("first()");
	});

	it("takes the signature the server marks active", async () => {
		await openWith({
			signatures: [{ label: "first()" }, { label: "second()" }],
			activeSignature: 1,
		});
		expect(
			tooltip()?.querySelector(".cm-lsp-signature-label")?.textContent,
		).toBe("second()");
	});

	it("falls back to the first signature when the active one does not exist", async () => {
		await openWith({
			signatures: [{ label: "first()" }, { label: "second()" }],
			activeSignature: 7,
		});
		expect(
			tooltip()?.querySelector(".cm-lsp-signature-label")?.textContent,
		).toBe("first()");
	});

	it("alternates prose and code blocks across several fences", async () => {
		await openWith({
			signatures: [
				{
					label: "greet()",
					documentation: "a\n```\nx\n```\nb\n```\ny\n```\nc",
				},
			],
		});
		const blocks = [
			...(tooltip()?.querySelectorAll(".cm-lsp-prose, .cm-lsp-code") ?? []),
		];
		expect(blocks.map((b) => b.tagName)).toEqual([
			"DIV",
			"PRE",
			"DIV",
			"PRE",
			"DIV",
		]);
	});

	it("detaches the href of a documentation link and opens it in the browser", async () => {
		await openWith({
			signatures: [
				{
					label: "greet()",
					documentation: "see [the docs](https://example.com/docs)",
				},
			],
		});
		const anchor = tooltip()?.querySelector("a") as HTMLAnchorElement;
		expect(anchor.hasAttribute("href")).toBe(false);
		anchor.click();
		await vi.waitFor(() =>
			expect(openUrl).toHaveBeenCalledWith("https://example.com/docs"),
		);
	});

	it("renders markup documentation given as an object", async () => {
		await openWith({
			signatures: [
				{
					label: "greet()",
					documentation: { kind: "markdown", value: "**Loud** hello" },
				},
			],
		});
		expect(tooltip()?.querySelector(".cm-lsp-prose strong")?.textContent).toBe(
			"Loud",
		);
	});

	it("joins documentation given as a list of parts", async () => {
		await openWith({
			signatures: [
				{
					label: "greet()",
					documentation: ["first", { kind: "markdown", value: "second" }],
				},
			],
		});
		const paragraphs = [
			...(tooltip()?.querySelectorAll(".cm-lsp-prose p") ?? []),
		];
		expect(paragraphs.map((p) => p.textContent)).toEqual(["first", "second"]);
	});

	it("shows the plain label when the active parameter is not inside it", async () => {
		await openWith({
			signatures: [{ label: "greet(name)", parameters: [{ label: "absent" }] }],
			activeParameter: 0,
		});
		expect(tooltip()?.querySelector(".cm-lsp-signature-active")).toBeNull();
		expect(
			tooltip()?.querySelector(".cm-lsp-signature-label")?.textContent,
		).toBe("greet(name)");
	});

	it("shows no documentation block for blank documentation", async () => {
		await openWith({
			signatures: [{ label: "greet()", documentation: "   " }],
		});
		expect(tooltip()?.querySelector(".cm-lsp-prose")).toBeNull();
	});

	it("renders a code fence as a pre block between prose blocks", async () => {
		await openWith({
			signatures: [
				{
					label: "greet()",
					documentation: "intro\n```ts\nconst a = 1;\n```\noutro",
				},
			],
		});
		const blocks = [
			...(tooltip()?.querySelectorAll(".cm-lsp-prose, .cm-lsp-code") ?? []),
		];
		expect(blocks.map((b) => b.tagName)).toEqual(["DIV", "PRE", "DIV"]);
		expect(blocks.map((b) => b.textContent)).toEqual([
			"intro\n",
			"const a = 1;\n",
			"outro\n",
		]);
	});

	it("skips the blank prose around a code fence", async () => {
		await openWith({
			signatures: [{ label: "greet()", documentation: "```\nonly code\n```" }],
		});
		expect(tooltip()?.querySelectorAll(".cm-lsp-prose")).toHaveLength(0);
		expect(tooltip()?.querySelectorAll(".cm-lsp-code")).toHaveLength(1);
	});

	it("asks again on a comma", async () => {
		await openTooltip();
		type(",");
		await vi.waitFor(() => expect(lspSignatureHelp).toHaveBeenCalledTimes(2));
		expect(lspSignatureHelp).toHaveBeenLastCalledWith(docRef, at(0, 7));
	});

	it("does not ask while typing inside an argument", async () => {
		mount("greet");
		view.dispatch({ selection: { anchor: 5 } });
		type("a");
		expect(lspSignatureHelp).not.toHaveBeenCalled();
	});

	it("stays inert while no server covers the file", () => {
		getDoc = () => null;
		mount("greet");
		view.dispatch({ selection: { anchor: 5 } });
		type("(");
		expect(lspSignatureHelp).not.toHaveBeenCalled();
		expect(tooltip()).toBeNull();
	});

	it("closes the tooltip when the call is closed", async () => {
		await openTooltip();
		type(")");
		expect(tooltip()).toBeNull();
		expect(lspSignatureHelp).toHaveBeenCalledTimes(1);
	});

	it("closes the tooltip on a semicolon", async () => {
		await openTooltip();
		type(";");
		expect(tooltip()).toBeNull();
	});

	it("does nothing on a closer when no tooltip is showing", () => {
		mount("greet");
		view.dispatch({ selection: { anchor: 5 } });
		type(")");
		expect(lspSignatureHelp).not.toHaveBeenCalled();
		expect(tooltip()).toBeNull();
	});

	it("keeps the tooltip when typing arguments", async () => {
		await openTooltip();
		type("a");
		expect(tooltip()).not.toBeNull();
		expect(lspSignatureHelp).toHaveBeenCalledTimes(1);
	});

	it("keeps the tooltip when the cursor moves within the call", async () => {
		await openTooltip();
		view.dispatch({ selection: { anchor: 6 } });
		expect(tooltip()).not.toBeNull();
	});

	it("follows an edit made before the call", async () => {
		await openTooltip();
		view.dispatch({ changes: { from: 0, insert: "xx" } });
		expect(tooltip()).not.toBeNull();
		view.dispatch({ selection: { anchor: 8 } });
		expect(tooltip()).not.toBeNull();
		view.dispatch({ selection: { anchor: 7 } });
		expect(tooltip()).toBeNull();
	});

	it("closes the tooltip when the cursor leaves before the call", async () => {
		await openTooltip();
		view.dispatch({ selection: { anchor: 2 } });
		expect(tooltip()).toBeNull();
	});

	it("keeps the tooltip when text is inserted at the call start behind the cursor", async () => {
		await openTooltip();
		view.dispatch({
			changes: { from: 6, insert: "a" },
			selection: { anchor: 6 },
		});
		expect(tooltip()).not.toBeNull();
	});

	it("asks when a call is opened at the very start of the document", async () => {
		vi.mocked(lspSignatureHelp).mockResolvedValue(help);
		mount("");
		type("(");
		await vi.waitFor(() =>
			expect(lspSignatureHelp).toHaveBeenCalledWith(docRef, at(0, 1)),
		);
	});

	it("leaves the state alone when an edit lands before any tooltip", () => {
		const errors = vi.spyOn(console, "error").mockImplementation(() => {});
		mount("greet");
		view.dispatch({ changes: { from: 0, insert: "xx" } });
		expect(tooltip()).toBeNull();
		expect(errors).not.toHaveBeenCalled();
		errors.mockRestore();
	});

	it("closes the tooltip when the server answers null", async () => {
		await openTooltip();
		vi.mocked(lspSignatureHelp).mockResolvedValue(null);
		type(",");
		await vi.waitFor(() => expect(tooltip()).toBeNull());
	});

	it("dispatches nothing on a closer when no tooltip is showing", () => {
		const updates: unknown[] = [];
		view = new EditorView({
			doc: "greet",
			extensions: [
				buildLspExtensions(() => docRef),
				EditorView.updateListener.of((update) => updates.push(update)),
			],
			parent: document.body,
		});
		view.dispatch({ selection: { anchor: 5 } });
		updates.length = 0;
		type(")");
		expect(updates).toHaveLength(1);
	});

	it("dispatches nothing when the server answers empty and no tooltip is showing", async () => {
		const updates: unknown[] = [];
		vi.mocked(lspSignatureHelp).mockResolvedValue({ signatures: [] });
		view = new EditorView({
			doc: "greet",
			extensions: [
				buildLspExtensions(() => docRef),
				EditorView.updateListener.of((update) => updates.push(update)),
			],
			parent: document.body,
		});
		view.dispatch({ selection: { anchor: 5 } });
		updates.length = 0;
		type("(");
		await vi.waitFor(() => expect(lspSignatureHelp).toHaveBeenCalledTimes(1));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(updates).toHaveLength(1);
	});

	it("closes the tooltip when the server no longer has a signature", async () => {
		await openTooltip();
		vi.mocked(lspSignatureHelp).mockResolvedValue({ signatures: [] });
		type(",");
		await vi.waitFor(() => expect(tooltip()).toBeNull());
	});

	it("shows nothing when the server answers null", async () => {
		vi.mocked(lspSignatureHelp).mockResolvedValue(null);
		mount("greet");
		view.dispatch({ selection: { anchor: 5 } });
		type("(");
		await vi.waitFor(() => expect(lspSignatureHelp).toHaveBeenCalledTimes(1));
		await Promise.resolve();
		expect(tooltip()).toBeNull();
	});

	it("swallows a server failure", async () => {
		vi.mocked(lspSignatureHelp).mockRejectedValue(new Error("boom"));
		mount("greet");
		view.dispatch({ selection: { anchor: 5 } });
		type("(");
		await vi.waitFor(() => expect(lspSignatureHelp).toHaveBeenCalledTimes(1));
		await Promise.resolve();
		expect(tooltip()).toBeNull();
	});
});

describe("symbol click affordance", () => {
	let view: EditorView;

	beforeEach(() => {
		view = new EditorView({
			doc: "hello world",
			extensions: [buildSymbolClickAffordance((mods) => mods.shiftKey)],
			parent: document.body,
		});
		vi.spyOn(view, "posAtCoords").mockReturnValue(2);
	});

	afterEach(() => {
		view.destroy();
	});

	const armedText = () =>
		view.dom.querySelector(".cm-lsp-symbol-armed")?.textContent ?? null;

	it("underlines the word under the pointer while the modifier is held", () => {
		view.dom.dispatchEvent(new MouseEvent("mousemove", { shiftKey: true }));
		expect(armedText()).toBe("hello");
	});

	it("does not underline without the modifier", () => {
		view.dom.dispatchEvent(new MouseEvent("mousemove"));
		expect(armedText()).toBeNull();
	});

	it("clears the underline when the modifier is released", () => {
		view.dom.dispatchEvent(new MouseEvent("mousemove", { shiftKey: true }));
		document.dispatchEvent(new KeyboardEvent("keyup"));
		expect(armedText()).toBeNull();
	});

	it("arms on a key press while the pointer rests on a word", () => {
		view.dom.dispatchEvent(new MouseEvent("mousemove"));
		document.dispatchEvent(new KeyboardEvent("keydown", { shiftKey: true }));
		expect(armedText()).toBe("hello");
	});

	it("arms nothing when the pointer is outside the text", () => {
		vi.mocked(view.posAtCoords).mockReturnValue(null);
		view.dom.dispatchEvent(new MouseEvent("mousemove", { shiftKey: true }));
		expect(armedText()).toBeNull();
	});

	it("arms nothing when the pointer rests between words", () => {
		view.dispatch({ changes: { from: 5, insert: " " } });
		vi.mocked(view.posAtCoords).mockReturnValue(6);
		view.dom.dispatchEvent(new MouseEvent("mousemove", { shiftKey: true }));
		expect(armedText()).toBeNull();
	});

	it("arms nothing on a key press before the pointer ever entered", () => {
		document.dispatchEvent(new KeyboardEvent("keydown", { shiftKey: true }));
		expect(armedText()).toBeNull();
	});

	it("stays disarmed on a key press after the pointer left", () => {
		view.dom.dispatchEvent(new MouseEvent("mousemove"));
		view.dom.dispatchEvent(new MouseEvent("mouseleave"));
		document.dispatchEvent(new KeyboardEvent("keydown", { shiftKey: true }));
		expect(armedText()).toBeNull();
	});

	it("dispatches nothing while the armed range does not change", () => {
		const updates: unknown[] = [];
		view.destroy();
		view = new EditorView({
			doc: "hello world",
			extensions: [
				buildSymbolClickAffordance((mods) => mods.shiftKey),
				EditorView.updateListener.of((update) => updates.push(update)),
			],
			parent: document.body,
		});
		vi.spyOn(view, "posAtCoords").mockReturnValue(2);
		view.dom.dispatchEvent(new MouseEvent("mousemove"));
		view.dom.dispatchEvent(new MouseEvent("mousemove"));
		expect(updates).toHaveLength(0);
		view.dom.dispatchEvent(new MouseEvent("mousemove", { shiftKey: true }));
		view.dom.dispatchEvent(new MouseEvent("mousemove", { shiftKey: true }));
		expect(updates).toHaveLength(1);
	});

	it("re-arms when only the end of the word under the pointer moved", () => {
		view.dom.dispatchEvent(new MouseEvent("mousemove", { shiftKey: true }));
		view.dispatch({ changes: { from: 5, insert: "xx" } });
		view.dom.dispatchEvent(new MouseEvent("mousemove", { shiftKey: true }));
		expect(armedText()).toBe("helloxx");
	});

	it("stops listening once the view is destroyed", () => {
		const isArmed = vi.fn((mods: { shiftKey: boolean }) => mods.shiftKey);
		const other = new EditorView({
			doc: "hello world",
			extensions: [buildSymbolClickAffordance(isArmed)],
			parent: document.body,
		});
		vi.spyOn(other, "posAtCoords").mockReturnValue(2);
		other.dom.dispatchEvent(new MouseEvent("mousemove", { shiftKey: true }));
		const dispatch = vi.spyOn(other, "dispatch");
		isArmed.mockClear();
		other.destroy();

		other.dom.dispatchEvent(new MouseEvent("mousemove", { shiftKey: true }));
		other.dom.dispatchEvent(new MouseEvent("mouseleave"));
		document.dispatchEvent(new KeyboardEvent("keydown", { shiftKey: true }));
		document.dispatchEvent(new KeyboardEvent("keyup", { shiftKey: true }));

		expect(isArmed).not.toHaveBeenCalled();
		expect(dispatch).not.toHaveBeenCalled();
	});

	it("clears the underline when the pointer leaves", () => {
		view.dom.dispatchEvent(new MouseEvent("mousemove", { shiftKey: true }));
		view.dom.dispatchEvent(new MouseEvent("mouseleave"));
		expect(armedText()).toBeNull();
	});
});
