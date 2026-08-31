// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { marked } from "marked";

const BLOCKED_TAGS = [
	"script",
	"iframe",
	"object",
	"embed",
	"style",
	"link",
	"meta",
	"form",
	"base",
];
const SAFE_URL = /^(https?:|mailto:|#|\/)/i;

export function sanitizeHtml(html: string): string {
	if (typeof DOMParser === "undefined") return html;
	const doc = new DOMParser().parseFromString(
		`<body>${html}</body>`,
		"text/html",
	);
	for (const tag of BLOCKED_TAGS) {
		for (const node of Array.from(doc.querySelectorAll(tag))) node.remove();
	}
	for (const el of Array.from(doc.body.querySelectorAll("*"))) {
		for (const attr of Array.from(el.attributes)) {
			const name = attr.name.toLowerCase();
			const value = attr.value.trim();
			const isUrlAttribute =
				name === "href" || name === "src" || name === "xlink:href";
			if (
				name.startsWith("on") ||
				(isUrlAttribute && !SAFE_URL.test(value)) ||
				name === "srcdoc"
			) {
				el.removeAttribute(attr.name);
			}
		}
		if (el.tagName === "A") el.setAttribute("rel", "noopener noreferrer");
	}
	return doc.body.innerHTML;
}

export function renderRemoteMarkdown(source: string): string {
	const html = marked.parse(source, {
		async: false,
		gfm: true,
		breaks: true,
	}) as string;
	return sanitizeHtml(html);
}
