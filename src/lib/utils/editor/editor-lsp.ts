// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
	Completion,
	CompletionContext,
	CompletionResult,
} from "@codemirror/autocomplete";
import type { Diagnostic } from "@codemirror/lint";
import type { Text } from "@codemirror/state";
import {
	EditorState,
	type Extension,
	StateEffect,
	StateField,
} from "@codemirror/state";
import {
	Decoration,
	type DecorationSet,
	EditorView,
	hoverTooltip,
	showTooltip,
	type Tooltip,
	ViewPlugin,
} from "@codemirror/view";
import {
	type LspCompletionItem,
	type LspDiagnostic,
	type LspDocRef,
	type LspHoverResult,
	type LspPosition,
	type LspRange,
	type LspSignatureHelp,
	type LspTextEdit,
	lspCompletion,
	lspHover,
	lspSignatureHelp,
} from "$lib/services/lsp-service";
import type { ModifierState } from "$lib/types/shortcuts";
import { parseLinkTarget } from "$lib/utils/editor/editor-markdown-wysiwyg";
import { renderRemoteMarkdown } from "$lib/utils/integrations/markdown";

// The bridge between the language server protocol and CodeMirror: offset and
// position conversion, then completion, hover, signature help and go-to-symbol.

/** The document to query, or null while no server covers the open file. */
export type LspDocGetter = () => LspDocRef | null;
/** Opens a path a documentation link points at, as an editor tab. */
export type LspOpenFile = (path: string) => void;

// -- Position conversion -------------------------------------------------------

/** LSP counts lines and characters from zero; CodeMirror counts lines from one. */
export function offsetToPosition(doc: Text, offset: number): LspPosition {
	const clamped = Math.max(0, Math.min(offset, doc.length));
	const line = doc.lineAt(clamped);
	return { line: line.number - 1, character: clamped - line.from };
}

/** Clamped both ways: a server may point past a line the user has since edited. */
export function positionToOffset(doc: Text, position: LspPosition): number {
	const lineNumber = Math.max(1, Math.min(position.line + 1, doc.lines));
	const line = doc.line(lineNumber);
	return Math.min(line.from + Math.max(0, position.character), line.to);
}

/** Normalized so `from <= to`, since a server may send a reversed range. */
export function rangeToOffsets(
	doc: Text,
	range: LspRange,
): { from: number; to: number } {
	const from = positionToOffset(doc, range.start);
	const to = positionToOffset(doc, range.end);
	return from <= to ? { from, to } : { from: to, to: from };
}

/**
 * Applies a server's edits to a plain string. A rename touches files that are
 * not open in any editor, so the same edits have to land on text read from
 * disk, not only on a CodeMirror document.
 */
export function applyEditsToText(text: string, edits: LspTextEdit[]): string {
	const lineStarts = [0];
	for (let i = 0; i < text.length; i++) {
		if (text[i] === "\n") lineStarts.push(i + 1);
	}
	const offsetOf = (position: LspPosition): number => {
		if (position.line >= lineStarts.length) return text.length;
		const index = Math.max(0, position.line);
		const start = lineStarts[index];
		const end =
			index + 1 < lineStarts.length ? lineStarts[index + 1] - 1 : text.length;
		return Math.min(start + Math.max(0, position.character), end);
	};

	return edits
		.map((edit) => ({
			from: offsetOf(edit.range.start),
			to: offsetOf(edit.range.end),
			insert: edit.newText,
		}))
		.sort((a, b) => b.from - a.from)
		.reduce(
			(current, edit) =>
				current.slice(0, edit.from) + edit.insert + current.slice(edit.to),
			text,
		);
}

// -- Diagnostics ---------------------------------------------------------------

const SEVERITIES: Record<number, Diagnostic["severity"]> = {
	1: "error",
	2: "warning",
	3: "info",
	4: "info",
};

/** LSP severities onto CodeMirror's, where hint and info collapse into one. */
export function toEditorDiagnostics(
	doc: Text,
	diagnostics: LspDiagnostic[],
): Diagnostic[] {
	return diagnostics.map((d) => {
		const { from, to } = rangeToOffsets(doc, d.range);
		return {
			from,
			to: to === from ? Math.min(from + 1, doc.length) : to,
			severity: SEVERITIES[d.severity ?? 1] ?? "error",
			source: d.source,
			message: d.message,
		};
	});
}

// -- Markup rendering ----------------------------------------------------------

/**
 * Server documentation arrives as markdown. Code fences stay text nodes inside a
 * `pre`; the prose around them goes through the shared sanitiser, so a link or a
 * bold word reads as one instead of as its source - a language server is a third
 * party, and nothing it returns reaches innerHTML unsanitised.
 */
function renderMarkup(
	target: HTMLElement,
	markup: string,
	onOpenFile?: LspOpenFile,
): void {
	markup.split("```").forEach((block, index) => {
		if (!block.trim()) return;
		const isCode = index % 2 === 1;
		const el = document.createElement(isCode ? "pre" : "div");
		el.className = isCode ? "cm-lsp-code" : "cm-lsp-prose";
		if (isCode) {
			el.textContent = block.replace(/^[a-zA-Z]*\n/, "");
		} else {
			el.innerHTML = renderRemoteMarkdown(block.trim());
			wireMarkupLinks(el, block, onOpenFile);
		}
		target.appendChild(el);
	});
}

/**
 * The sanitiser drops any href outside http/mailto, so `file://` documentation
 * links arrive stripped. The destinations are read back from the markdown
 * source and routed here instead: a file opens as a tab, anything else goes to
 * the system browser.
 */
function wireMarkupLinks(
	el: HTMLElement,
	source: string,
	onOpenFile?: LspOpenFile,
): void {
	const hrefs = Array.from(source.matchAll(MARKDOWN_LINK)).map((m) => m[1]);
	const anchors = Array.from(el.querySelectorAll("a"));
	anchors.forEach((anchor, index) => {
		const href = anchor.getAttribute("href") ?? hrefs[index];
		if (!href) return;
		anchor.removeAttribute("href");
		anchor.onclick = (event) => {
			event.preventDefault();
			event.stopPropagation();
			openDocLink(href, onOpenFile);
		};
	});
}

const MARKDOWN_LINK = /\[[^\]]*\]\(\s*<?([^)\s>]+)>?[^)]*\)/g;
const FILE_URL = /^file:\/\//i;

function openDocLink(href: string, onOpenFile?: LspOpenFile): void {
	const clean = href.trim();
	if (FILE_URL.test(clean)) {
		const path = decodeURIComponent(clean.replace(FILE_URL, "").split("#")[0]);
		if (path && onOpenFile) onOpenFile(path);
		return;
	}

	const target = parseLinkTarget(clean);
	if (target.kind === "external") {
		void import("@tauri-apps/plugin-opener")
			.then((m) => m.openUrl(target.href))
			.catch(() => {});
	} else if (target.kind === "file" && onOpenFile) {
		onOpenFile(target.path);
	}
}

/** Flattens the several shapes markup content can take into plain text. */
function markupToString(
	value: LspHoverResult["contents"] | LspCompletionItem["documentation"],
): string {
	if (value === undefined || value === null) return "";
	if (typeof value === "string") return value;
	if (Array.isArray(value)) {
		return value
			.map((part) => (typeof part === "string" ? part : part.value))
			.join("\n\n");
	}
	return value.value;
}

// -- Completion ----------------------------------------------------------------

const COMPLETION_KINDS: Record<number, string> = {
	1: "text",
	2: "method",
	3: "function",
	4: "class",
	5: "property",
	6: "variable",
	7: "class",
	8: "interface",
	9: "namespace",
	10: "property",
	11: "type",
	12: "constant",
	13: "enum",
	14: "keyword",
	15: "text",
	16: "constant",
	17: "text",
	18: "text",
	19: "text",
	20: "constant",
	21: "constant",
	22: "class",
	23: "type",
	24: "keyword",
	25: "type",
};

/**
 * A server's `textEdit` carries its own range, and it is not always the word
 * CodeMirror would replace: an auto-import rewrites the line, a dotted path
 * swallows the segment before the cursor. Honouring its left edge is what keeps
 * that leading part from being left behind.
 *
 * Only the left edge: the range was computed against the document as it stood
 * when the request went out, and the user has kept typing since. Everything
 * left of the cursor has not moved, so that edge still holds; the right edge is
 * CodeMirror's, which is current by construction.
 */
function toCompletion(item: LspCompletionItem): Completion {
	const documentation = markupToString(item.documentation);
	const insert = item.textEdit?.newText ?? item.insertText ?? item.label;
	const range = item.textEdit?.range;

	return {
		label: item.label,
		type: COMPLETION_KINDS[item.kind ?? 1] ?? "text",
		detail: item.detail,
		apply: range
			? (view, _completion, from, to) => {
					const start = Math.min(
						positionToOffset(view.state.doc, range.start),
						from,
					);
					view.dispatch({
						changes: { from: start, to, insert },
						selection: { anchor: start + insert.length },
						userEvent: "input.complete",
					});
				}
			: insert,
		info: documentation
			? () => {
					const dom = document.createElement("div");
					dom.className = "cm-lsp-info";
					renderMarkup(dom, documentation);
					return dom;
				}
			: undefined,
	};
}

/** Characters that open a completion even with no word typed yet. */
const COMPLETION_TRIGGERS = new Set([".", ":", ">", "@", "/", "'", '"']);

/**
 * Completes on a word, or right after a trigger character. An `isIncomplete`
 * result drops `validFor`, so the next keystroke re-queries the server instead
 * of filtering a list the server said was partial.
 */
async function completionSource(
	context: CompletionContext,
	getDoc: LspDocGetter,
): Promise<CompletionResult | null> {
	const doc = getDoc();
	if (!doc) return null;

	const word = context.matchBefore(/[\w$]+/);
	const previous = context.state.sliceDoc(
		Math.max(0, context.pos - 1),
		context.pos,
	);
	if (!context.explicit && !word && !COMPLETION_TRIGGERS.has(previous))
		return null;

	let result: Awaited<ReturnType<typeof lspCompletion>>;
	try {
		result = await lspCompletion(
			doc,
			offsetToPosition(context.state.doc, context.pos),
		);
	} catch {
		return null;
	}
	const items = Array.isArray(result) ? result : (result?.items ?? []);
	if (items.length === 0) return null;

	// An incomplete list is the server saying "there are more, ask again once
	// you know what they are typing". Declaring it valid for the whole word
	// would have CodeMirror filter this truncated batch instead, and the item
	// the user is after would never arrive.
	const isIncomplete = !Array.isArray(result) && result?.isIncomplete === true;

	return {
		from: word ? word.from : context.pos,
		options: items.map(toCompletion),
		validFor: isIncomplete ? undefined : /^[\w$]*$/,
	};
}

// -- Hover ---------------------------------------------------------------------

/** Hover tooltips; a server that errors or says nothing shows nothing. */
function buildHover(getDoc: LspDocGetter, onOpenFile?: LspOpenFile): Extension {
	return hoverTooltip(async (view, pos) => {
		const doc = getDoc();
		if (!doc) return null;
		let result: LspHoverResult | null;
		try {
			result = await lspHover(doc, offsetToPosition(view.state.doc, pos));
		} catch {
			return null;
		}
		const markup = markupToString(result?.contents);
		if (!markup.trim()) return null;

		const range = result?.range
			? rangeToOffsets(view.state.doc, result.range)
			: { from: pos, to: pos };
		return {
			pos: range.from,
			end: range.to,
			above: true,
			create: () => {
				const dom = document.createElement("div");
				dom.className = "cm-lsp-hover";
				renderMarkup(dom, markup, onOpenFile);
				return { dom };
			},
		};
	});
}

// -- Signature help ------------------------------------------------------------

const setSignatureHelp = StateEffect.define<{
	pos: number;
	help: LspSignatureHelp;
} | null>();

/**
 * The label of the parameter being filled in, so it can be picked out of the
 * signature. A server gives it either as a substring or as a pair of offsets
 * into the label.
 */
export function activeParameterRange(
	signature: LspSignatureHelp["signatures"][number],
	active: number | undefined,
): [number, number] | null {
	const parameter = signature.parameters?.[active ?? -1];
	if (!parameter) return null;
	if (Array.isArray(parameter.label)) return parameter.label;
	const at = signature.label.indexOf(parameter.label);
	return at < 0 ? null : [at, at + parameter.label.length];
}

/** The signature with the active parameter emphasized inside its label. */
function signatureTooltip(pos: number, help: LspSignatureHelp): Tooltip | null {
	const signature =
		help.signatures[help.activeSignature ?? 0] ?? help.signatures[0];
	if (!signature) return null;
	const active = activeParameterRange(signature, help.activeParameter);

	return {
		pos,
		above: true,
		create: () => {
			const dom = document.createElement("div");
			dom.className = "cm-lsp-signature";
			const label = document.createElement("div");
			label.className = "cm-lsp-signature-label";
			if (active) {
				label.append(signature.label.slice(0, active[0]));
				const current = document.createElement("span");
				current.className = "cm-lsp-signature-active";
				current.textContent = signature.label.slice(active[0], active[1]);
				label.append(current, signature.label.slice(active[1]));
			} else {
				label.textContent = signature.label;
			}
			dom.appendChild(label);
			const documentation = markupToString(signature.documentation);
			if (documentation.trim()) renderMarkup(dom, documentation);
			return { dom };
		},
	};
}

/**
 * Where the tooltip is anchored, kept alongside the tooltip itself so an edit
 * can move it rather than throw it away. Null means nothing is showing.
 */
/** `anchor` is where the call started, so the tooltip survives typing arguments. */
interface SignatureState {
	anchor: number;
	tooltips: readonly Tooltip[];
}

const NO_SIGNATURE: SignatureState = { anchor: -1, tooltips: [] };

const signatureField = StateField.define<SignatureState>({
	create: () => NO_SIGNATURE,
	update(current, tr) {
		for (const effect of tr.effects) {
			if (!effect.is(setSignatureHelp)) continue;
			if (!effect.value) return NO_SIGNATURE;
			const tooltip = signatureTooltip(effect.value.pos, effect.value.help);
			return tooltip
				? { anchor: effect.value.pos, tooltips: [tooltip] }
				: NO_SIGNATURE;
		}
		if (current.tooltips.length === 0) return current;

		// Typing an argument is the moment the help is most wanted, so an edit
		// moves the anchor instead of closing it. Only leaving the call does.
		const anchor = tr.changes.mapPos(current.anchor, -1);
		const head = tr.state.selection.main.head;
		if (head < anchor) return NO_SIGNATURE;
		if (anchor === current.anchor) return current;
		const tooltip = current.tooltips[0];
		return { anchor, tooltips: [{ ...tooltip, pos: anchor }] };
	},
	provide: (field) =>
		showTooltip.computeN([field], (state) => state.field(field).tooltips),
});

const SIGNATURE_TRIGGERS = new Set(["(", ","]);
const SIGNATURE_CLOSERS = new Set([")", ";"]);

/** Opens on `(` or `,`, closes on `)` or `;` and on leaving the call. */
function buildSignatureHelp(getDoc: LspDocGetter): Extension {
	return [
		signatureField,
		EditorView.updateListener.of((update) => {
			if (!update.docChanged) return;
			const doc = getDoc();
			if (!doc) return;
			const head = update.state.selection.main.head;
			const typed = update.state.sliceDoc(Math.max(0, head - 1), head);
			const showing = update.state.field(signatureField).tooltips.length > 0;

			if (SIGNATURE_CLOSERS.has(typed)) {
				if (showing) {
					update.view.dispatch({ effects: setSignatureHelp.of(null) });
				}
				return;
			}
			// Only on a trigger. Typing inside an argument moves nothing the
			// tooltip shows - the active parameter changes on the comma - and
			// asking per keystroke would both saturate the server and race the
			// debounced `didChange` it has not seen yet.
			if (!SIGNATURE_TRIGGERS.has(typed)) return;

			void lspSignatureHelp(doc, offsetToPosition(update.state.doc, head))
				.then((help) => {
					if (!help || help.signatures.length === 0) {
						if (showing) {
							update.view.dispatch({ effects: setSignatureHelp.of(null) });
						}
						return;
					}
					update.view.dispatch({
						effects: setSignatureHelp.of({
							pos: update.view.state.selection.main.head,
							help,
						}),
					});
				})
				.catch(() => {});
		}),
		EditorView.domEventHandlers({
			keydown: (event, view) => {
				if (event.key !== "Escape") return false;
				if (view.state.field(signatureField).tooltips.length === 0)
					return false;
				view.dispatch({ effects: setSignatureHelp.of(null) });
				return true;
			},
		}),
	];
}

// -- Click affordance ----------------------------------------------------------

const armedMark = Decoration.mark({ class: "cm-lsp-symbol-armed" });

const setArmedRange = StateEffect.define<{ from: number; to: number } | null>();

const armedField = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(value, tr) {
		let next = value.map(tr.changes);
		for (const effect of tr.effects) {
			if (!effect.is(setArmedRange)) continue;
			next = effect.value
				? Decoration.set([armedMark.range(effect.value.from, effect.value.to)])
				: Decoration.none;
		}
		return next;
	},
	provide: (field) => EditorView.decorations.from(field),
});

/**
 * The affordance VS Code has: while the modifiers of the go-to-definition
 * click are held, the word under the pointer is underlined, so the click
 * announces itself before it is made.
 *
 * Modifier changes are listened for on the document rather than on the editor:
 * the pointer can rest on a symbol while the focus sits somewhere else, and
 * pressing Shift then has to arm the word all the same.
 */
export function buildSymbolClickAffordance(
	isArmed: (mods: ModifierState) => boolean,
): Extension {
	const plugin = ViewPlugin.define((view) => {
		let x = 0;
		let y = 0;
		let inside = false;
		let armed: { from: number; to: number } | null = null;

		const publish = (next: { from: number; to: number } | null) => {
			if (next?.from === armed?.from && next?.to === armed?.to) return;
			armed = next;
			view.dispatch({ effects: setArmedRange.of(next) });
		};

		const refresh = (mods: ModifierState) => {
			if (!inside || !isArmed(mods)) {
				publish(null);
				return;
			}
			const pos = view.posAtCoords({ x, y });
			const word = pos === null ? null : view.state.wordAt(pos);
			publish(word ? { from: word.from, to: word.to } : null);
		};

		const onMouseMove = (e: MouseEvent) => {
			x = e.clientX;
			y = e.clientY;
			inside = true;
			refresh(e);
		};
		const onMouseLeave = () => {
			inside = false;
			publish(null);
		};
		const onKey = (e: KeyboardEvent) => refresh(e);

		view.dom.addEventListener("mousemove", onMouseMove);
		view.dom.addEventListener("mouseleave", onMouseLeave);
		document.addEventListener("keydown", onKey);
		document.addEventListener("keyup", onKey);

		return {
			destroy() {
				view.dom.removeEventListener("mousemove", onMouseMove);
				view.dom.removeEventListener("mouseleave", onMouseLeave);
				document.removeEventListener("keydown", onKey);
				document.removeEventListener("keyup", onKey);
			},
		};
	});

	return [armedField, plugin, symbolArmedTheme];
}

const symbolArmedTheme: Extension = EditorView.theme({
	".cm-lsp-symbol-armed": {
		textDecoration: "underline",
		textUnderlineOffset: "2px",
		cursor: "pointer",
	},
});

const lspPanelsTheme: Extension = EditorView.theme({
	// A server can answer with a whole page of documentation. Capped to a
	// fraction of the viewport and scrolled, so the end of it is reachable
	// instead of being clipped off the window.
	".cm-lsp-hover, .cm-lsp-info, .cm-lsp-signature": {
		maxWidth: "460px",
		maxHeight: "min(50vh, 420px)",
		overflowY: "auto",
		overscrollBehavior: "contain",
		padding: "6px 8px",
		fontSize: "12px",
		lineHeight: "1.5",
	},
	".cm-lsp-signature-label": {
		fontFamily: "var(--font-mono)",
		fontSize: "11.5px",
	},
	".cm-lsp-signature-active": {
		color: "var(--accent)",
		fontWeight: "600",
	},
	".cm-lsp-prose": { whiteSpace: "normal" },
	// Markdown block elements carry browser margins that the plain-text
	// rendering never had; they are stripped back to the old flat spacing.
	".cm-lsp-prose :is(p, ul, ol, h1, h2, h3, h4, h5, h6, blockquote)": {
		margin: "0",
	},
	".cm-lsp-prose :is(p, ul, ol, blockquote) + *": { marginTop: "4px" },
	".cm-lsp-prose :is(h1, h2, h3, h4, h5, h6)": {
		fontSize: "inherit",
		fontWeight: "600",
	},
	".cm-lsp-prose :is(ul, ol)": { paddingLeft: "18px" },
	".cm-lsp-prose hr": {
		margin: "6px 0",
		border: "none",
		borderTop: "1px solid var(--stroke-1)",
	},
	".cm-lsp-prose a": {
		color: "var(--accent)",
		cursor: "pointer",
		textDecoration: "none",
	},
	".cm-lsp-prose a:hover": { textDecoration: "underline" },
	".cm-lsp-prose code": {
		padding: "0 3px",
		borderRadius: "3px",
		background: "var(--bg-3)",
		fontFamily: "var(--font-mono)",
	},
	".cm-lsp-prose pre": { margin: "0" },
	".cm-lsp-code": {
		margin: "4px 0 0",
		padding: "4px 6px",
		borderRadius: "4px",
		background: "var(--bg-3)",
		fontFamily: "var(--font-mono)",
		fontSize: "11.5px",
		whiteSpace: "pre-wrap",
		overflowX: "auto",
	},
});

// -- Assembly ------------------------------------------------------------------

/**
 * Everything the editor gains from a language server, in one extension. It is
 * inert while `getDoc` answers null, so a file no server covers pays nothing.
 */
/** Everything the language server contributes to the editor, in one extension. */
export function buildLspExtensions(
	getDoc: LspDocGetter,
	onOpenFile?: LspOpenFile,
): Extension {
	return [
		EditorState.languageData.of(() => [
			{
				autocomplete: (context: CompletionContext) =>
					completionSource(context, getDoc),
			},
		]),
		buildHover(getDoc, onOpenFile),
		buildSignatureHelp(getDoc),
		lspPanelsTheme,
	];
}
