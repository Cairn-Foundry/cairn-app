// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IS_MAC } from "#lib/utils/platform";
import { installFieldUndoHandler } from "./field-undo";

const modifier = IS_MAC ? { metaKey: true } : { ctrlKey: true };

function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
	const e = new KeyboardEvent("keydown", {
		key,
		cancelable: true,
		bubbles: true,
		...modifier,
		...init,
	});
	document.activeElement?.dispatchEvent(e);
	return e;
}

function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
	el.dispatchEvent(new InputEvent("beforeinput", { bubbles: true }));
	el.value = value;
	el.dispatchEvent(
		new InputEvent("input", { bubbles: true, inputType: "insertFromPaste" }),
	);
}

function typeChars(
	el: HTMLInputElement | HTMLTextAreaElement,
	value: string,
	inputType = "insertText",
) {
	el.dispatchEvent(new InputEvent("beforeinput", { bubbles: true }));
	el.value = value;
	el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType }));
}

let teardown: () => void;
let input: HTMLInputElement;

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
	teardown = installFieldUndoHandler();
	input = document.createElement("input");
	input.value = "start";
	document.body.appendChild(input);
	input.focus();
});

afterEach(() => {
	teardown();
	document.body.innerHTML = "";
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.resetModules();
});

describe("installFieldUndoHandler", () => {
	it("undoes and redoes the edits of a field", () => {
		type(input, "one");
		type(input, "two");
		expect(press("z").defaultPrevented).toBe(true);
		expect(input.value).toBe("one");
		press("z");
		expect(input.value).toBe("start");
		press("z", { shiftKey: true });
		expect(input.value).toBe("one");
	});

	it("notifies bindings of the restored value", () => {
		type(input, "one");
		let seen = "";
		input.addEventListener("input", () => {
			seen = input.value;
		});
		press("z");
		expect(seen).toBe("start");
	});

	it("drops the redo branch after a new edit", () => {
		type(input, "one");
		press("z");
		type(input, "other");
		press("z", { shiftKey: true });
		expect(input.value).toBe("other");
	});

	it("leaves the code editor to its own history", () => {
		const host = document.createElement("div");
		host.className = "cm-editor";
		const inner = document.createElement("textarea");
		host.appendChild(inner);
		document.body.appendChild(host);
		inner.focus();
		expect(press("z").defaultPrevented).toBe(false);
	});

	it("ignores a plain z", () => {
		expect(
			press("z", { metaKey: false, ctrlKey: false }).defaultPrevented,
		).toBe(false);
	});

	it("undoes the edits of a textarea", () => {
		const area = document.createElement("textarea");
		area.value = "first";
		document.body.appendChild(area);
		area.focus();
		type(area, "second");
		press("z");
		expect(area.value).toBe("first");
	});

	it("leaves a checkbox to the webview", () => {
		const box = document.createElement("input");
		box.type = "checkbox";
		document.body.appendChild(box);
		box.focus();
		expect(press("z").defaultPrevented).toBe(false);
	});

	it("ignores a modified key that is neither undo nor redo", () => {
		type(input, "one");
		expect(press("x").defaultPrevented).toBe(false);
		expect(input.value).toBe("one");
	});

	it("records a value set by code since the last edit", () => {
		input.value = "programmatic";
		expect(press("z").defaultPrevented).toBe(true);
		expect(input.value).toBe("start");
		press("z", { shiftKey: true });
		expect(input.value).toBe("programmatic");
	});

	it("falls back to the end of the value when the selection cannot be read", () => {
		input.setSelectionRange(1, 2);
		Object.defineProperty(input, "selectionStart", {
			get() {
				throw new Error("selection unavailable");
			},
		});
		Object.defineProperty(input, "selectionEnd", {
			get() {
				throw new Error("selection unavailable");
			},
		});
		type(input, "one");
		press("z");
		expect(input.value).toBe("start");
		const readStart = Object.getOwnPropertyDescriptor(
			HTMLInputElement.prototype,
			"selectionStart",
		)?.get;
		const readEnd = Object.getOwnPropertyDescriptor(
			HTMLInputElement.prototype,
			"selectionEnd",
		)?.get;
		expect(readStart?.call(input)).toBe(5);
		expect(readEnd?.call(input)).toBe(5);
	});

	it("ignores an input event on a field that was never seeded", () => {
		const errors: unknown[] = [];
		const onError = (e: ErrorEvent) => errors.push(e.error);
		window.addEventListener("error", onError);
		const stray = document.createElement("input");
		stray.value = "x";
		document.body.appendChild(stray);
		stray.dispatchEvent(
			new InputEvent("input", { bubbles: true, inputType: "insertFromPaste" }),
		);
		window.removeEventListener("error", onError);
		expect(errors).toEqual([]);
		stray.focus();
		press("z");
		expect(stray.value).toBe("x");
	});

	it("keeps at most 200 entries of history", () => {
		for (let i = 1; i <= 205; i++) type(input, `v${i}`);
		for (let i = 0; i < 300; i++) press("z");
		expect(input.value).toBe("v6");
	});

	it("coalesces typing inside the coalesce window into one entry", () => {
		typeChars(input, "a");
		vi.advanceTimersByTime(100);
		typeChars(input, "ab");
		vi.advanceTimersByTime(100);
		typeChars(input, "abc");
		press("z");
		expect(input.value).toBe("start");
	});

	it("starts a new entry once the coalesce window has passed", () => {
		typeChars(input, "a");
		vi.advanceTimersByTime(100);
		typeChars(input, "ab");
		vi.advanceTimersByTime(600);
		typeChars(input, "abc");
		press("z");
		expect(input.value).toBe("ab");
		press("z");
		expect(input.value).toBe("start");
	});

	it("does not coalesce a paste into the typing before it", () => {
		typeChars(input, "a");
		vi.advanceTimersByTime(100);
		typeChars(input, "ab");
		typeChars(input, "abpasted", "insertFromPaste");
		press("z");
		expect(input.value).toBe("ab");
	});

	it("restores the selection each snapshot was taken with", () => {
		const field = document.createElement("input");
		field.value = "hello";
		field.setSelectionRange(1, 3);
		document.body.appendChild(field);
		field.focus();
		type(field, "other");
		press("z");
		expect(field.value).toBe("hello");
		expect(field.selectionStart).toBe(1);
		expect(field.selectionEnd).toBe(3);
	});

	it("restores a caret at the end when the selection cannot be read", () => {
		Object.defineProperty(input, "selectionStart", {
			get() {
				throw new Error("selection unavailable");
			},
		});
		Object.defineProperty(input, "selectionEnd", {
			get() {
				throw new Error("selection unavailable");
			},
		});
		type(input, "one");
		press("z");
		press("z", { shiftKey: true });
		expect(input.value).toBe("one");
		const readStart = Object.getOwnPropertyDescriptor(
			HTMLInputElement.prototype,
			"selectionStart",
		)?.get;
		const readEnd = Object.getOwnPropertyDescriptor(
			HTMLInputElement.prototype,
			"selectionEnd",
		)?.get;
		expect(readStart?.call(input)).toBe(3);
		expect(readEnd?.call(input)).toBe(3);
	});

	it("uses the start as the end when only the end cannot be read", () => {
		Object.defineProperty(input, "selectionEnd", {
			get() {
				throw new Error("selection unavailable");
			},
		});
		type(input, "one");
		press("z");
		press("z", { shiftKey: true });
		const readStart = Object.getOwnPropertyDescriptor(
			HTMLInputElement.prototype,
			"selectionStart",
		)?.get;
		const readEnd = Object.getOwnPropertyDescriptor(
			HTMLInputElement.prototype,
			"selectionEnd",
		)?.get;
		expect(readStart?.call(input)).toBe(3);
		expect(readEnd?.call(input)).toBe(3);
	});

	it("does not treat a beforeinput on a non-text target as a field", () => {
		const errors: unknown[] = [];
		const onError = (e: ErrorEvent) => errors.push(e.error);
		window.addEventListener("error", onError);
		const box = document.createElement("input");
		box.type = "checkbox";
		document.body.appendChild(box);
		box.dispatchEvent(new InputEvent("beforeinput", { bubbles: true }));
		window.removeEventListener("error", onError);
		expect(errors).toEqual([]);
	});

	it("does not leave a hole in the history after coalesced typing", () => {
		const errors: unknown[] = [];
		const onError = (e: ErrorEvent) => errors.push(e.error);
		window.addEventListener("error", onError);
		typeChars(input, "a");
		vi.advanceTimersByTime(100);
		typeChars(input, "ab");
		press("z");
		press("z", { shiftKey: true });
		press("z", { shiftKey: true });
		window.removeEventListener("error", onError);
		expect(errors).toEqual([]);
		expect(input.value).toBe("ab");
	});

	it("starts a new entry for typing right after a paste", () => {
		type(input, "pasted");
		typeChars(input, "pasted!");
		press("z");
		expect(input.value).toBe("pasted");
	});

	it("ignores a modified key with shift that is neither undo nor redo", () => {
		type(input, "one");
		expect(press("x", { shiftKey: true }).defaultPrevented).toBe(false);
		expect(input.value).toBe("one");
	});

	it("leaves a read-only field alone", () => {
		type(input, "one");
		input.readOnly = true;
		expect(press("z").defaultPrevented).toBe(false);
		expect(input.value).toBe("one");
	});

	it.skipIf(IS_MAC)("redoes with Ctrl+Y outside a Mac", () => {
		type(input, "one");
		press("z");
		expect(input.value).toBe("start");
		expect(press("y").defaultPrevented).toBe(true);
		expect(input.value).toBe("one");
	});

	it("tracks a field whose own listeners stop the events", () => {
		const field = document.createElement("input");
		field.value = "a";
		for (const name of ["focusin", "beforeinput", "input"]) {
			field.addEventListener(name, (e) => e.stopPropagation());
		}
		document.body.appendChild(field);
		field.focus();
		field.value = "b";
		field.dispatchEvent(new InputEvent("beforeinput", { bubbles: true }));
		field.value = "c";
		field.dispatchEvent(
			new InputEvent("input", { bubbles: true, inputType: "insertFromPaste" }),
		);
		field.value = "d";
		field.dispatchEvent(
			new InputEvent("input", { bubbles: true, inputType: "insertFromPaste" }),
		);
		press("z");
		expect(field.value).toBe("c");
		press("z");
		expect(field.value).toBe("b");
		press("z");
		expect(field.value).toBe("a");
	});

	it("stops tracking every event once torn down", () => {
		teardown();
		const seeded = document.createElement("input");
		seeded.value = "a";
		document.body.appendChild(seeded);
		seeded.focus();
		input.value = "code";
		input.dispatchEvent(new InputEvent("beforeinput", { bubbles: true }));
		input.value = "typed";
		input.dispatchEvent(
			new InputEvent("input", { bubbles: true, inputType: "insertFromPaste" }),
		);
		input.value = "other";
		input.focus();
		teardown = installFieldUndoHandler();
		press("z");
		expect(input.value).toBe("start");

		seeded.value = "b";
		seeded.focus();
		press("z");
		expect(seeded.value).toBe("b");
	});

	it("uses the meta key and no Ctrl+Y redo on a Mac", async () => {
		teardown();
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
		);
		vi.resetModules();
		const mac = await import("./field-undo");
		teardown = mac.installFieldUndoHandler();
		type(input, "one");
		type(input, "two");
		expect(press("z", { metaKey: false, ctrlKey: true }).defaultPrevented).toBe(
			false,
		);
		expect(press("z", { metaKey: true, ctrlKey: false }).defaultPrevented).toBe(
			true,
		);
		expect(input.value).toBe("one");
		expect(press("y", { metaKey: true, ctrlKey: false }).defaultPrevented).toBe(
			false,
		);
		expect(input.value).toBe("one");
		press("z", { metaKey: true, ctrlKey: false, shiftKey: true });
		expect(input.value).toBe("two");
		expect(
			press("z", { metaKey: false, ctrlKey: false }).defaultPrevented,
		).toBe(false);
		expect(press("z", { metaKey: true, ctrlKey: true }).defaultPrevented).toBe(
			false,
		);
	});
});
