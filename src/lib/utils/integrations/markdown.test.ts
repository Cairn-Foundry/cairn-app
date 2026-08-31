// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { renderRemoteMarkdown, sanitizeHtml } from "./markdown";

describe("sanitizeHtml", () => {
	it("drops scripts, event handlers and javascript urls", () => {
		const html =
			'<p onclick="x()">hi</p><script>alert(1)</script><a href="javascript:alert(1)">l</a><img src="data:text/html,x">';
		const out = sanitizeHtml(html);
		expect(out).not.toContain("<script");
		expect(out).not.toContain("onclick");
		expect(out).not.toContain("javascript:");
		expect(out).not.toContain("src=");
	});

	it("keeps ordinary links and images", () => {
		const out = sanitizeHtml(
			'<a href="https://example.com">l</a><img src="https://x/y.png">',
		);
		expect(out).toContain('href="https://example.com"');
		expect(out).toContain('rel="noopener noreferrer"');
		expect(out).toContain('src="https://x/y.png"');
	});
});

describe("renderRemoteMarkdown", () => {
	it("renders markdown and strips inline html threats", () => {
		const out = renderRemoteMarkdown("**bold** <img src=x onerror=alert(1)>");
		expect(out).toContain("<strong>bold</strong>");
		expect(out).not.toContain("onerror");
	});
});
