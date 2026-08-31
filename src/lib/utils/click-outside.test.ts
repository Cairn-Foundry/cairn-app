// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clickOutside } from "./click-outside";

let panel: HTMLElement;
let inner: HTMLElement;
let outside: HTMLElement;
let toggle: HTMLElement;

/**
 * A pointerdown stamped well after the action armed itself, so the guard that
 * drops the click still in flight at arming time lets it through.
 */
function pointerDown(target: Element): void {
	const event = new PointerEvent("pointerdown", { bubbles: true });
	Object.defineProperty(event, "timeStamp", {
		value: performance.now() + 1000,
	});
	target.dispatchEvent(event);
}

beforeEach(() => {
	document.body.innerHTML = "";
	panel = document.createElement("div");
	inner = document.createElement("button");
	panel.append(inner);
	outside = document.createElement("div");
	toggle = document.createElement("button");
	toggle.className = "tools-toggle";
	document.body.append(panel, outside, toggle);
});

afterEach(() => {
	document.body.innerHTML = "";
});

describe("clickOutside", () => {
	it("fires on a click outside the node", () => {
		const callback = vi.fn();
		clickOutside(panel, callback);
		pointerDown(outside);
		expect(callback).toHaveBeenCalledTimes(1);
	});

	it("stays quiet on a click inside the node", () => {
		const callback = vi.fn();
		clickOutside(panel, callback);
		pointerDown(panel);
		expect(callback).not.toHaveBeenCalled();
	});

	it("stays quiet on a click on a descendant of the node", () => {
		const callback = vi.fn();
		clickOutside(panel, callback);
		pointerDown(inner);
		expect(callback).not.toHaveBeenCalled();
	});

	/**
	 * The pointerdown that opened the panel is still travelling when the action
	 * arms itself, so an event stamped at or before that moment is ignored -
	 * otherwise the panel would close on the very click that opened it.
	 */
	it("ignores the click that was already in flight when it armed", () => {
		const callback = vi.fn();
		clickOutside(panel, callback);
		const inFlight = new PointerEvent("pointerdown", { bubbles: true });
		Object.defineProperty(inFlight, "timeStamp", { value: 0 });
		outside.dispatchEvent(inFlight);
		expect(callback).not.toHaveBeenCalled();
	});

	it("still fires on the next click after the one it ignored", () => {
		const callback = vi.fn();
		clickOutside(panel, callback);
		const inFlight = new PointerEvent("pointerdown", { bubbles: true });
		Object.defineProperty(inFlight, "timeStamp", { value: 0 });
		outside.dispatchEvent(inFlight);
		pointerDown(outside);
		expect(callback).toHaveBeenCalledTimes(1);
	});

	it("spares the toggle the caller excludes", () => {
		const callback = vi.fn();
		clickOutside(panel, { callback, exclude: ".tools-toggle" });
		pointerDown(toggle);
		expect(callback).not.toHaveBeenCalled();
	});

	it("still fires elsewhere when an exclusion is set", () => {
		const callback = vi.fn();
		clickOutside(panel, { callback, exclude: ".tools-toggle" });
		pointerDown(outside);
		expect(callback).toHaveBeenCalledTimes(1);
	});

	it("spares a descendant of the excluded element", () => {
		const label = document.createElement("span");
		toggle.append(label);
		const callback = vi.fn();
		clickOutside(panel, { callback, exclude: ".tools-toggle" });
		pointerDown(label);
		expect(callback).not.toHaveBeenCalled();
	});

	it("hears a click an inner handler stopped, since it listens in capture", () => {
		const callback = vi.fn();
		clickOutside(panel, callback);
		outside.addEventListener("pointerdown", (e) => e.stopPropagation());
		pointerDown(outside);
		expect(callback).toHaveBeenCalledTimes(1);
	});

	it("calls the callback the last update gave it", () => {
		const first = vi.fn();
		const second = vi.fn();
		const action = clickOutside(panel, first);
		action?.update?.(second);
		pointerDown(outside);
		expect(first).not.toHaveBeenCalled();
		expect(second).toHaveBeenCalledTimes(1);
	});

	it("takes a new exclusion on update", () => {
		const callback = vi.fn();
		const action = clickOutside(panel, callback);
		action?.update?.({ callback, exclude: ".tools-toggle" });
		pointerDown(toggle);
		expect(callback).not.toHaveBeenCalled();
	});

	it("stops listening once destroyed", () => {
		const callback = vi.fn();
		const action = clickOutside(panel, callback);
		action?.destroy?.();
		pointerDown(outside);
		expect(callback).not.toHaveBeenCalled();
	});

	it("fires on every outside click, not only the first", () => {
		const callback = vi.fn();
		clickOutside(panel, callback);
		pointerDown(outside);
		pointerDown(outside);
		expect(callback).toHaveBeenCalledTimes(2);
	});

	it("leaves two panels independent", () => {
		const other = document.createElement("div");
		document.body.append(other);
		const first = vi.fn();
		const second = vi.fn();
		clickOutside(panel, first);
		clickOutside(other, second);
		pointerDown(panel);
		expect(first).not.toHaveBeenCalled();
		expect(second).toHaveBeenCalledTimes(1);
	});

	it("treats a click on the document body as outside", () => {
		const callback = vi.fn();
		clickOutside(panel, callback);
		pointerDown(document.body);
		expect(callback).toHaveBeenCalledTimes(1);
	});
});
