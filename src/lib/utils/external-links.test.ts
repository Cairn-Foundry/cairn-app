// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openUrl } from "$lib/services/opener-service";
import { interceptExternalLinks } from "./external-links";

let release: () => void;

function link(href: string, blank = false): HTMLAnchorElement {
	const a = document.createElement("a");
	a.href = href;
	if (blank) a.target = "_blank";
	a.append(document.createElement("span"));
	document.body.append(a);
	return a;
}

function click(el: Element, init: MouseEventInit = {}): MouseEvent {
	const event = new MouseEvent("click", {
		bubbles: true,
		cancelable: true,
		composed: true,
		...init,
	});
	el.dispatchEvent(event);
	return event;
}

beforeEach(() => {
	document.body.innerHTML = "";
	vi.mocked(openUrl).mockReset().mockResolvedValue(undefined);
	release = interceptExternalLinks();
});

afterEach(() => release());

describe("interceptExternalLinks", () => {
	it("opens a target=_blank link in the system browser", () => {
		const inner = link("https://forge/mr/1", true).querySelector(
			"span",
		) as Element;
		const event = click(inner);
		expect(openUrl).toHaveBeenCalledWith("https://forge/mr/1");
		expect(event.defaultPrevented).toBe(true);
	});

	it("opens any link clicked with Ctrl or Shift", () => {
		click(link("https://a.test/"), { ctrlKey: true });
		click(link("mailto:x@y.z"), { shiftKey: true });
		expect(vi.mocked(openUrl).mock.calls).toEqual([
			["https://a.test/"],
			["mailto:x@y.z"],
		]);
	});

	it("leaves a plain click on an ordinary link alone", () => {
		const event = click(link("https://a.test/"));
		expect(openUrl).not.toHaveBeenCalled();
		expect(event.defaultPrevented).toBe(false);
	});

	it("ignores a scheme the desktop is not trusted with", () => {
		click(link("file:///etc/passwd", true));
		expect(openUrl).not.toHaveBeenCalled();
	});

	it("ignores a click another handler already took", () => {
		const a = link("https://a.test/", true);
		a.addEventListener("click", (e) => e.preventDefault());
		click(a);
		expect(openUrl).not.toHaveBeenCalled();
	});

	it("stops listening once released", () => {
		release();
		click(link("https://a.test/", true));
		expect(openUrl).not.toHaveBeenCalled();
		release = () => {};
	});
});
