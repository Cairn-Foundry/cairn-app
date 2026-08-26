import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IS_MAC } from "$lib/utils/platform";
import { installCopySelectionHandler } from "./copy-selection";

const write = vi.mocked(writeText);

/** The modifier the handler watches for on this platform. */
const modifier = IS_MAC ? { metaKey: true } : { ctrlKey: true };

function copyKey(init: KeyboardEventInit = {}): KeyboardEvent {
	return new KeyboardEvent("keydown", {
		key: "c",
		cancelable: true,
		...modifier,
		...init,
	});
}

function selectionOf(text: string) {
	vi.spyOn(window, "getSelection").mockReturnValue({
		toString: () => text,
	} as Selection);
}

let teardown: () => void;

beforeEach(() => {
	write.mockClear();
	write.mockResolvedValue(undefined);
	teardown = installCopySelectionHandler();
	selectionOf("selected text");
});

afterEach(() => {
	teardown();
	vi.restoreAllMocks();
	document.body.innerHTML = "";
});

describe("installCopySelectionHandler", () => {
	it("writes the selection the webview would otherwise drop", () => {
		window.dispatchEvent(copyKey());
		expect(write).toHaveBeenCalledWith("selected text");
	});

	it("takes over the event so the webview does not also handle it", () => {
		const event = copyKey();
		window.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(true);
	});

	it("stops listening once torn down", () => {
		teardown();
		window.dispatchEvent(copyKey());
		expect(write).not.toHaveBeenCalled();
	});

	it("ignores a copy with nothing selected", () => {
		selectionOf("");
		const event = copyKey();
		window.dispatchEvent(event);
		expect(write).not.toHaveBeenCalled();
		expect(event.defaultPrevented).toBe(false);
	});

	it("survives a browser that reports no selection at all", () => {
		vi.spyOn(window, "getSelection").mockReturnValue(null);
		expect(() => window.dispatchEvent(copyKey())).not.toThrow();
		expect(write).not.toHaveBeenCalled();
	});

	it("ignores another key held with the modifier", () => {
		window.dispatchEvent(copyKey({ key: "v" }));
		expect(write).not.toHaveBeenCalled();
	});

	it("copies on an uppercase C, as a shifted layout may report", () => {
		window.dispatchEvent(
			new KeyboardEvent("keydown", { key: "C", cancelable: true, ...modifier }),
		);
		expect(write).toHaveBeenCalledWith("selected text");
	});

	it("ignores the copy key without its modifier", () => {
		window.dispatchEvent(new KeyboardEvent("keydown", { key: "c" }));
		expect(write).not.toHaveBeenCalled();
	});

	it("stays out of the way when another modifier is held", () => {
		window.dispatchEvent(copyKey({ shiftKey: true }));
		window.dispatchEvent(copyKey({ altKey: true }));
		expect(write).not.toHaveBeenCalled();
	});

	it("leaves an input to copy on its own", () => {
		const input = document.createElement("input");
		document.body.append(input);
		input.focus();
		const event = copyKey();
		window.dispatchEvent(event);
		expect(write).not.toHaveBeenCalled();
		expect(event.defaultPrevented).toBe(false);
	});

	it("leaves a textarea to copy on its own", () => {
		const area = document.createElement("textarea");
		document.body.append(area);
		area.focus();
		window.dispatchEvent(copyKey());
		expect(write).not.toHaveBeenCalled();
	});

	it("leaves a contenteditable to copy on its own", () => {
		const editable = document.createElement("div");
		editable.setAttribute("contenteditable", "true");
		// jsdom does not derive isContentEditable from the attribute, so the
		// property the handler reads is set explicitly.
		Object.defineProperty(editable, "isContentEditable", { value: true });
		editable.tabIndex = 0;
		document.body.append(editable);
		editable.focus();
		window.dispatchEvent(copyKey());
		expect(write).not.toHaveBeenCalled();
	});

	it("still copies from an ordinary focused element", () => {
		const button = document.createElement("button");
		document.body.append(button);
		button.focus();
		window.dispatchEvent(copyKey());
		expect(write).toHaveBeenCalledWith("selected text");
	});

	it("copies a multiline selection whole", () => {
		selectionOf("line one\nline two");
		window.dispatchEvent(copyKey());
		expect(write).toHaveBeenCalledWith("line one\nline two");
	});

	/**
	 * The handler is a module-level function, so a second install registers the
	 * same reference and the DOM deduplicates it: installing twice copies once,
	 * and either teardown removes it.
	 */
	it("copies once even when installed twice", () => {
		const second = installCopySelectionHandler();
		window.dispatchEvent(copyKey());
		expect(write).toHaveBeenCalledTimes(1);
		second();
		write.mockClear();
		window.dispatchEvent(copyKey());
		expect(write).not.toHaveBeenCalled();
	});
});
