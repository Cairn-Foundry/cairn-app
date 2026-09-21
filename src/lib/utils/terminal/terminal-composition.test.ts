// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it } from "vitest";
import { keepHelperTextareaEmpty } from "./terminal-manager";

describe("keepHelperTextareaEmpty", () => {
	let textarea: HTMLTextAreaElement;

	const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

	beforeEach(() => {
		textarea = document.createElement("textarea");
		document.body.append(textarea);
		keepHelperTextareaEmpty(textarea);
	});

	it("clears what an ordinary keystroke left behind", async () => {
		textarea.value = "peut-";
		textarea.dispatchEvent(new Event("input"));
		await settle();
		expect(textarea.value).toBe("");
	});

	/**
	 * The value xterm slices the composed character out of: left to accumulate,
	 * its dead-key fallback sends the whole line instead of the one character.
	 */
	it("clears what a composition left behind", async () => {
		textarea.value = "peut-";
		textarea.dispatchEvent(new CompositionEvent("compositionstart"));
		textarea.value = "peut-ê";
		textarea.dispatchEvent(
			new CompositionEvent("compositionend", { data: "ê" }),
		);
		await settle();
		expect(textarea.value).toBe("");
	});

	/** xterm reads the textarea mid-composition; emptying it there loses the character. */
	it("leaves the value alone while a composition is running", async () => {
		textarea.value = "peut-";
		textarea.dispatchEvent(new Event("input"));
		textarea.dispatchEvent(new CompositionEvent("compositionstart"));
		textarea.value = "peut-^";
		textarea.dispatchEvent(new Event("input"));
		await settle();
		expect(textarea.value).toBe("peut-^");
	});
});
