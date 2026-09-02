// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { foldable, syntaxTree } from "@codemirror/language";
import type { EditorState, Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

// The enclosing scopes of the first visible line, pinned above the code so the
// function - and the class or block around it - stays readable while scrolling
// inside a body taller than the viewport.

/** Beyond this the header eats the viewport instead of helping to read it. */
const MAX_LINES = 5;

export interface StickyLine {
	number: number;
	text: string;
}

/**
 * A scope worth pinning is a node whose fold range spans several lines - what
 * the fold gutter would offer to collapse. Testing `foldable` rather than the
 * node type keeps this language-agnostic: every grammar that folds a body gets
 * the header for free, and the ones that do not fold get nothing rather than
 * something wrong.
 */
export function stickyLinesAt(state: EditorState, pos: number): StickyLine[] {
	const lines: StickyLine[] = [];
	let seen = -1;

	const cursor = syntaxTree(state).resolveInner(pos, 1).cursor();
	do {
		const line = state.doc.lineAt(cursor.from);
		if (
			line.number !== seen &&
			line.from < pos &&
			foldable(state, line.from, line.to)
		) {
			seen = line.number;
			lines.unshift({ number: line.number, text: line.text });
		}
	} while (cursor.parent());

	return lines.slice(-MAX_LINES);
}

export function buildStickyScroll(enabled: boolean): Extension {
	if (!enabled) return [];
	return ViewPlugin.fromClass(
		class {
			private dom: HTMLElement;
			private rendered = "";

			private onScroll: () => void;

			constructor(private view: EditorView) {
				this.dom = document.createElement("div");
				this.dom.className = "cm-sticky-scroll";
				view.dom.appendChild(this.dom);
				this.onScroll = () => this.render();
				view.scrollDOM.addEventListener("scroll", this.onScroll, {
					passive: true,
				});
				view.requestMeasure({ read: () => this.render() });
			}

			update(update: ViewUpdate) {
				if (
					update.docChanged ||
					update.viewportChanged ||
					update.geometryChanged
				) {
					update.view.requestMeasure({ read: () => this.render() });
				}
			}

			destroy() {
				this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
				this.dom.remove();
			}

			private render() {
				const { view } = this;
				const scrollerTop = view.scrollDOM.getBoundingClientRect().top;
				const block = view.lineBlockAtHeight(
					scrollerTop + this.dom.offsetHeight - view.documentTop,
				);
				const lines = stickyLinesAt(view.state, block.from);

				const key = lines.map((l) => l.number).join(",");
				if (key === this.rendered) return;
				this.rendered = key;

				this.dom.textContent = "";
				this.dom.style.display = lines.length ? "block" : "none";
				for (const line of lines) {
					const row = document.createElement("div");
					row.className = "cm-sticky-scroll-line";
					const number = document.createElement("span");
					number.className = "cm-sticky-scroll-number";
					number.textContent = String(line.number);
					const text = document.createElement("span");
					text.textContent = line.text;
					row.append(number, text);
					row.onclick = () => {
						const target = view.state.doc.line(line.number);
						view.dispatch({
							selection: { anchor: target.from },
							effects: EditorView.scrollIntoView(target.from, {
								y: "start",
								yMargin: this.dom.offsetHeight,
							}),
						});
						view.focus();
					};
					this.dom.appendChild(row);
				}
			}
		},
	);
}

/**
 * The header overlays the top of the editor rather than sitting in the
 * scroller: the scroller's children are the content itself, so a sticky child
 * there would scroll away with the lines it is meant to outlive. Each row jumps
 * the caret back to the scope it names.
 */
export const stickyScrollTheme: Extension = EditorView.theme({
	"&": { position: "relative" },
	".cm-sticky-scroll": {
		position: "absolute",
		top: "0",
		left: "0",
		right: "0",
		zIndex: "3",
		whiteSpace: "pre",
		overflow: "hidden",
		backgroundColor: "var(--bg-2)",
		borderBottom: "1px solid var(--stroke-1)",
		boxShadow: "0 2px 6px oklch(0 0 0 / 0.18)",
		fontFamily: "var(--font-mono)",
	},
	".cm-sticky-scroll-line": {
		display: "flex",
		gap: "12px",
		padding: "0 16px 0 10px",
		lineHeight: "1.65",
		textOverflow: "ellipsis",
		overflow: "hidden",
		cursor: "pointer",
	},
	".cm-sticky-scroll-line:hover": {
		backgroundColor: "var(--bg-3)",
	},
	".cm-sticky-scroll-number": {
		flex: "none",
		textAlign: "right",
		opacity: "0.55",
	},
});
