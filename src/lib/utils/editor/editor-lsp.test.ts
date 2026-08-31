// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { activeParameterRange, applyEditsToText } from "./editor-lsp";

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

	it("gives up rather than guess when the label does not hold the parameter", () => {
		const mismatched = {
			label: "greet(a, b)",
			parameters: [{ label: "nowhere: string" }],
		};
		expect(activeParameterRange(mismatched, 0)).toBeNull();
	});
});
