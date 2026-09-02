// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { javascript } from "@codemirror/lang-javascript";
import { HighlightStyle } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import {
	defaultSyntaxTokens,
	type SyntaxTokenKey,
	type SyntaxTokens,
} from "$lib/utils/editor/syntax-tokens";
import type { DiffKind } from "./editor-diff-gutter";

// The editor's look: which CodeMirror language extension a file gets, the
// syntax highlight style built from the user's tokens, and one palette per theme.

/** The languages the editor can highlight; anything else is `text`. */
export type EditorLanguage =
	| "ts"
	| "tsx"
	| "js"
	| "jsx"
	| "vue"
	| "svelte"
	| "sql"
	| "json"
	| "html"
	| "css"
	| "markdown"
	| "mermaid"
	| "xml"
	| "yaml"
	| "python"
	| "rust"
	| "java"
	| "cpp"
	| "php"
	| "text";

/** The app themes an editor palette exists for. */
export type ThemeName =
	| "default"
	| "dark"
	| "light"
	| "high-contrast"
	| "nord"
	| "solarized"
	| "dracula"
	| "paper"
	| "glass";

/**
 * Markdown is built on `markdownLanguage` rather than the default: the WYSIWYG
 * layer decorates tables, which only exist with GFM.
 *
 * Every mode but JavaScript is imported on demand. Bundling all fourteen put
 * ~640 KB in the initial download for a user who opens two or three languages;
 * the caller applies the result through a compartment, so the editor opens
 * unhighlighted for one frame and gains its mode when the chunk lands.
 */
export async function resolveLanguageExtension(
	lang: EditorLanguage,
): Promise<Extension> {
	switch (lang) {
		case "tsx":
			return javascript({ typescript: true, jsx: true });
		case "jsx":
			return javascript({ typescript: false, jsx: true });
		case "vue":
			return (await import("@codemirror/lang-vue")).vue();
		case "svelte":
			return (await import("codemirror-lang-svelte")).svelte();
		case "sql":
			return (await import("@codemirror/lang-sql")).sql();
		case "json":
			return (await import("@codemirror/lang-json")).json();
		case "html":
			return (await import("@codemirror/lang-html")).html();
		case "css":
			return (await import("@codemirror/lang-css")).css();
		case "markdown": {
			const [{ markdown, markdownLanguage }, { languages }] = await Promise.all(
				[
					import("@codemirror/lang-markdown"),
					import("@codemirror/language-data"),
				],
			);
			return markdown({ base: markdownLanguage, codeLanguages: languages });
		}
		case "xml":
			return (await import("@codemirror/lang-xml")).xml();
		case "yaml":
			return (await import("@codemirror/lang-yaml")).yaml();
		case "python":
			return (await import("@codemirror/lang-python")).python();
		case "rust":
			return (await import("@codemirror/lang-rust")).rust();
		case "java":
			return (await import("@codemirror/lang-java")).java();
		case "cpp":
			return (await import("@codemirror/lang-cpp")).cpp();
		case "php":
			return (await import("@codemirror/lang-php")).php();
		case "mermaid":
		case "text":
			return [];
		default:
			return javascript({ typescript: lang === "ts", jsx: false });
	}
}

// -- Syntax highlighting ------------------------------------------------------

/** Maps the user's token colours onto the Lezer highlight tags. */
/*
 * Every `EditorView.theme` / `HighlightStyle.define` call creates a new style
 * module that CodeMirror injects into the document the first time a view uses
 * it, and never removes. Built once per editor mount, a project switch added a
 * few hundred rules and recalculated the styles of the whole window, slower at
 * every switch as the stylesheet grew. The builders are therefore memoized on
 * their inputs so a given theme is one style module for the whole session.
 */
const highlightCache = new Map<string, HighlightStyle>();
const editorThemeCache = new Map<string, Extension>();

export function buildHighlight(
	theme: string,
	tokens?: SyntaxTokens,
): HighlightStyle {
	const key = `${theme}\u0000${tokens ? JSON.stringify(tokens) : ""}`;
	const cached = highlightCache.get(key);
	if (cached) return cached;
	const built = buildHighlightUncached(theme, tokens);
	highlightCache.set(key, built);
	return built;
}

function buildHighlightUncached(
	theme: string,
	tokens?: SyntaxTokens,
): HighlightStyle {
	const p = tokens ?? defaultSyntaxTokens(theme);
	const style = (key: SyntaxTokenKey, extra?: { textDecoration: string }) => {
		const s = p[key];
		const decorations = [
			s.underline ? "underline" : "",
			extra?.textDecoration ?? "",
		]
			.filter(Boolean)
			.join(" ");
		return {
			color: s.color,
			...(s.italic ? { fontStyle: "italic" } : {}),
			...(s.bold ? { fontWeight: "600" } : {}),
			...(decorations ? { textDecoration: decorations } : {}),
		};
	};
	return HighlightStyle.define([
		{ tag: t.keyword, ...style("kw") },
		{ tag: t.controlKeyword, ...style("kw") },
		{ tag: t.definitionKeyword, ...style("kw") },
		{ tag: t.moduleKeyword, ...style("kw") },
		{ tag: t.operatorKeyword, ...style("kw") },
		{ tag: t.function(t.variableName), ...style("fn") },
		{ tag: t.function(t.definition(t.variableName)), ...style("fn") },
		{ tag: t.definition(t.variableName), ...style("def") },
		{ tag: t.variableName, ...style("def") },
		{ tag: t.typeName, ...style("ty") },
		{ tag: t.className, ...style("ty") },
		{ tag: t.definition(t.typeName), ...style("ty") },
		{ tag: t.propertyName, ...style("prop") },
		{ tag: t.definition(t.propertyName), ...style("prop") },
		{ tag: t.string, ...style("str") },
		{ tag: t.special(t.string), ...style("str") },
		{ tag: t.regexp, ...style("re") },
		{ tag: t.number, ...style("num") },
		{ tag: t.bool, ...style("kw") },
		{ tag: t.null, ...style("kw") },
		{ tag: t.atom, ...style("kw") },
		{ tag: t.comment, ...style("cmt") },
		{ tag: t.lineComment, ...style("cmt") },
		{ tag: t.blockComment, ...style("cmt") },
		{ tag: t.operator, ...style("op") },
		{ tag: t.punctuation, ...style("punc") },
		{ tag: t.bracket, ...style("br") },
		{ tag: t.tagName, ...style("tag") },
		{ tag: t.attributeName, ...style("ty") },
		{ tag: t.attributeValue, ...style("str") },
		{ tag: t.namespace, ...style("ty") },
		{ tag: t.meta, ...style("meta") },
		{ tag: t.modifier, ...style("kw") },
		{ tag: t.self, ...style("kw") },
		{ tag: t.special(t.variableName), ...style("fn") },
		{ tag: t.inserted, ...style("str") },
		{ tag: t.deleted, ...style("err") },
		{ tag: t.changed, ...style("num") },
		{ tag: t.invalid, ...style("err", { textDecoration: "underline wavy" }) },
	]);
}

// -- Editor theme palettes ----------------------------------------------------

/** Every colour one theme needs; the syntax colours are separate. */
interface EditorPalette {
	bg: string;
	fg: string;
	caret: string;
	accent: string;
	gutterBg: string;
	gutterFg: string;
	gutterMinWidth: string;
	gutterBorder: string;
	activeLine: string;
	selectionAlpha: number;
	matchAlpha: number;
	selectionMatchAlpha: number;
	selectionMatchOutlineAlpha: number;
	searchBg: string;
	searchSelectedBg: string;
	panelBorder?: string;
	foldHover: string;
	foldPlaceholderBg: string;
	foldPlaceholderBorder: string;
	foldPlaceholderFg: string;
	tooltipBg: string;
	tooltipBorder: string;
	tooltipFg: string;
	tooltipShadow: string;
	diffAdded: string;
	diffModified: string;
	diffDeleted: string;
	whitespace?: string;
	cursorWidth?: string;
	nonMatchBg?: string;
	nonMatchOutline?: string;
	isDark: boolean;
}

const PALETTE_DEFAULT: EditorPalette = {
	bg: "oklch(0.16 0.008 70)",
	fg: "oklch(0.88 0.005 80)",
	caret: "oklch(0.72 0.14 250)",
	accent: "oklch(0.72 0.14 250)",
	gutterBg: "oklch(0.16 0.008 70)",
	gutterFg: "oklch(0.42 0.006 80)",
	gutterMinWidth: "12px",
	gutterBorder: "oklch(0.26 0.008 70)",
	activeLine: "oklch(0.215 0.008 70)",
	selectionAlpha: 0.22,
	matchAlpha: 0.18,
	selectionMatchAlpha: 0.12,
	selectionMatchOutlineAlpha: 0.25,
	searchBg: "oklch(0.82 0.14 60 / 0.28)",
	searchSelectedBg: "oklch(0.82 0.14 60 / 0.55)",
	panelBorder: "oklch(0.26 0.008 70)",
	foldHover: "oklch(0.78 0.14 250)",
	foldPlaceholderBg: "oklch(0.26 0.008 70)",
	foldPlaceholderBorder: "oklch(0.34 0.008 70)",
	foldPlaceholderFg: "oklch(0.60 0.006 80)",
	tooltipBg: "oklch(0.20 0.008 70)",
	tooltipBorder: "oklch(0.32 0.008 70)",
	tooltipFg: "oklch(0.88 0.005 80)",
	tooltipShadow: "0 4px 20px oklch(0 0 0 / 0.55)",
	diffAdded: "oklch(0.78 0.14 135)",
	diffModified: "oklch(0.82 0.14 60)",
	diffDeleted: "oklch(0.72 0.20 25)",
	whitespace: "oklch(0.36 0.006 80)",
	nonMatchBg: "oklch(0.70 0.18 15 / 0.25)",
	nonMatchOutline: "oklch(0.70 0.18 15 / 0.5)",
	isDark: true,
};

const PALETTE_LIGHT: EditorPalette = {
	bg: "oklch(0.97 0.006 80)",
	fg: "oklch(0.18 0.008 70)",
	caret: "oklch(0.42 0.18 250)",
	accent: "oklch(0.42 0.14 250)",
	gutterBg: "oklch(0.94 0.007 75)",
	gutterFg: "oklch(0.58 0.008 70)",
	gutterMinWidth: "44px",
	gutterBorder: "oklch(0.87 0.007 70)",
	activeLine: "oklch(0.91 0.008 70)",
	selectionAlpha: 0.2,
	matchAlpha: 0.15,
	selectionMatchAlpha: 0.1,
	selectionMatchOutlineAlpha: 0.22,
	searchBg: "oklch(0.60 0.14 60 / 0.28)",
	searchSelectedBg: "oklch(0.60 0.14 60 / 0.55)",
	foldHover: "oklch(0.42 0.14 250)",
	foldPlaceholderBg: "oklch(0.91 0.008 70)",
	foldPlaceholderBorder: "oklch(0.80 0.008 70)",
	foldPlaceholderFg: "oklch(0.52 0.006 80)",
	tooltipBg: "oklch(0.97 0.006 80)",
	tooltipBorder: "oklch(0.80 0.008 70)",
	tooltipFg: "oklch(0.18 0.008 70)",
	tooltipShadow: "0 4px 20px oklch(0 0 0 / 0.15)",
	diffAdded: "oklch(0.55 0.18 135)",
	diffModified: "oklch(0.60 0.18 60)",
	diffDeleted: "oklch(0.55 0.22 25)",
	whitespace: "oklch(0.68 0.008 70)",
	nonMatchBg: "oklch(0.48 0.18 15 / 0.2)",
	nonMatchOutline: "oklch(0.48 0.18 15 / 0.4)",
	isDark: false,
};

const PALETTE_HIGH_CONTRAST: EditorPalette = {
	bg: "oklch(0.0 0 0)",
	fg: "oklch(1.0 0 0)",
	caret: "oklch(0.72 0.14 250)",
	accent: "oklch(0.72 0.14 250)",
	gutterBg: "oklch(0.08 0 0)",
	gutterFg: "oklch(0.55 0 0)",
	gutterMinWidth: "44px",
	gutterBorder: "oklch(0.32 0 0)",
	activeLine: "oklch(0.12 0 0)",
	selectionAlpha: 0.35,
	matchAlpha: 0.25,
	selectionMatchAlpha: 0,
	selectionMatchOutlineAlpha: 0,
	searchBg: "transparent",
	searchSelectedBg: "transparent",
	foldHover: "oklch(0.78 0.14 250)",
	foldPlaceholderBg: "oklch(0.12 0 0)",
	foldPlaceholderBorder: "oklch(0.48 0 0)",
	foldPlaceholderFg: "oklch(1.0 0 0)",
	tooltipBg: "oklch(0.08 0 0)",
	tooltipBorder: "oklch(0.48 0 0)",
	tooltipFg: "oklch(1.0 0 0)",
	tooltipShadow: "0 4px 20px oklch(0 0 0 / 0.8)",
	diffAdded: "oklch(0.78 0.14 135)",
	diffModified: "oklch(0.82 0.14 60)",
	diffDeleted: "oklch(0.72 0.20 25)",
	cursorWidth: "2px",
	isDark: true,
};

const PALETTE_DARK: EditorPalette = {
	...PALETTE_DEFAULT,
	bg: "oklch(0.115 0.003 260)",
	fg: "oklch(0.88 0.004 260)",
	gutterBg: "oklch(0.115 0.003 260)",
	gutterFg: "oklch(0.41 0.005 260)",
	gutterBorder: "oklch(0.235 0.005 260)",
	activeLine: "oklch(0.168 0.004 260)",
	panelBorder: "oklch(0.235 0.005 260)",
	foldPlaceholderBg: "oklch(0.235 0.005 260)",
	foldPlaceholderBorder: "oklch(0.315 0.006 260)",
	foldPlaceholderFg: "oklch(0.60 0.005 260)",
	tooltipBg: "oklch(0.158 0.004 260)",
	tooltipBorder: "oklch(0.295 0.006 260)",
	tooltipFg: "oklch(0.88 0.004 260)",
	tooltipShadow: "0 4px 20px oklch(0 0 0 / 0.7)",
	whitespace: "oklch(0.34 0.005 260)",
};

const PALETTE_NORD: EditorPalette = {
	...PALETTE_DEFAULT,
	bg: "oklch(0.235 0.021 265)",
	fg: "oklch(0.879 0.014 254)",
	caret: "oklch(0.78 0.075 225)",
	accent: "oklch(0.78 0.075 225)",
	gutterBg: "oklch(0.235 0.021 265)",
	gutterFg: "oklch(0.492 0.023 262)",
	gutterBorder: "oklch(0.352 0.025 263)",
	activeLine: "oklch(0.288 0.023 265)",
	panelBorder: "oklch(0.352 0.025 263)",
	searchBg: "oklch(0.80 0.11 82 / 0.28)",
	searchSelectedBg: "oklch(0.80 0.11 82 / 0.55)",
	foldHover: "oklch(0.84 0.075 225)",
	foldPlaceholderBg: "oklch(0.309 0.024 264)",
	foldPlaceholderBorder: "oklch(0.436 0.027 262)",
	foldPlaceholderFg: "oklch(0.741 0.018 258)",
	tooltipBg: "oklch(0.271 0.023 265)",
	tooltipBorder: "oklch(0.436 0.027 262)",
	tooltipFg: "oklch(0.879 0.014 254)",
	tooltipShadow: "0 4px 20px oklch(0 0 0 / 0.55)",
	diffAdded: "oklch(0.78 0.11 148)",
	diffModified: "oklch(0.84 0.11 82)",
	diffDeleted: "oklch(0.70 0.14 22)",
	whitespace: "oklch(0.44 0.024 262)",
};

const PALETTE_SOLARIZED: EditorPalette = {
	...PALETTE_DEFAULT,
	bg: "oklch(0.221 0.036 210)",
	fg: "oklch(0.836 0.019 95)",
	caret: "oklch(0.70 0.14 75)",
	accent: "oklch(0.70 0.14 75)",
	gutterBg: "oklch(0.221 0.036 210)",
	gutterFg: "oklch(0.486 0.030 197)",
	gutterBorder: "oklch(0.336 0.037 204)",
	activeLine: "oklch(0.272 0.038 208)",
	panelBorder: "oklch(0.336 0.037 204)",
	searchBg: "oklch(0.75 0.16 60 / 0.28)",
	searchSelectedBg: "oklch(0.75 0.16 60 / 0.55)",
	foldHover: "oklch(0.78 0.14 75)",
	foldPlaceholderBg: "oklch(0.298 0.038 206)",
	foldPlaceholderBorder: "oklch(0.421 0.034 201)",
	foldPlaceholderFg: "oklch(0.706 0.023 180)",
	tooltipBg: "oklch(0.258 0.038 208)",
	tooltipBorder: "oklch(0.421 0.034 201)",
	tooltipFg: "oklch(0.836 0.019 95)",
	tooltipShadow: "0 4px 20px oklch(0 0 0 / 0.55)",
	diffAdded: "oklch(0.72 0.15 135)",
	diffModified: "oklch(0.75 0.16 60)",
	diffDeleted: "oklch(0.62 0.19 28)",
	whitespace: "oklch(0.42 0.032 200)",
};

const PALETTE_DRACULA: EditorPalette = {
	...PALETTE_DEFAULT,
	bg: "oklch(0.212 0.024 288)",
	fg: "oklch(0.888 0.017 300)",
	caret: "oklch(0.75 0.16 300)",
	accent: "oklch(0.75 0.16 300)",
	gutterBg: "oklch(0.212 0.024 288)",
	gutterFg: "oklch(0.502 0.030 290)",
	gutterBorder: "oklch(0.344 0.036 288)",
	activeLine: "oklch(0.268 0.030 288)",
	panelBorder: "oklch(0.344 0.036 288)",
	searchBg: "oklch(0.90 0.14 95 / 0.26)",
	searchSelectedBg: "oklch(0.90 0.14 95 / 0.52)",
	foldHover: "oklch(0.82 0.16 300)",
	foldPlaceholderBg: "oklch(0.296 0.032 288)",
	foldPlaceholderBorder: "oklch(0.432 0.042 288)",
	foldPlaceholderFg: "oklch(0.752 0.022 296)",
	tooltipBg: "oklch(0.253 0.028 288)",
	tooltipBorder: "oklch(0.432 0.042 288)",
	tooltipFg: "oklch(0.888 0.017 300)",
	tooltipShadow: "0 4px 20px oklch(0 0 0 / 0.6)",
	diffAdded: "oklch(0.86 0.19 145)",
	diffModified: "oklch(0.90 0.14 95)",
	diffDeleted: "oklch(0.70 0.20 15)",
	whitespace: "oklch(0.44 0.036 289)",
};

const PALETTE_PAPER: EditorPalette = {
	...PALETTE_LIGHT,
	bg: "oklch(0.945 0.038 88)",
	fg: "oklch(0.225 0.052 52)",
	caret: "oklch(0.47 0.15 42)",
	accent: "oklch(0.47 0.15 42)",
	gutterBg: "oklch(0.910 0.046 85)",
	gutterFg: "oklch(0.575 0.052 62)",
	gutterBorder: "oklch(0.838 0.052 80)",
	activeLine: "oklch(0.872 0.054 82)",
	foldHover: "oklch(0.47 0.15 42)",
	foldPlaceholderBg: "oklch(0.872 0.054 82)",
	foldPlaceholderBorder: "oklch(0.752 0.062 76)",
	foldPlaceholderFg: "oklch(0.458 0.056 58)",
	tooltipBg: "oklch(0.945 0.038 88)",
	tooltipBorder: "oklch(0.752 0.062 76)",
	tooltipFg: "oklch(0.225 0.052 52)",
	tooltipShadow: "0 4px 20px oklch(0.28 0.05 55 / 0.22)",
	diffAdded: "oklch(0.56 0.15 148)",
	diffModified: "oklch(0.64 0.15 70)",
	diffDeleted: "oklch(0.54 0.20 27)",
	whitespace: "oklch(0.68 0.050 72)",
};

const PALETTE_GLASS: EditorPalette = {
	...PALETTE_DEFAULT,
	bg: "transparent",
	fg: "oklch(0.905 0.006 265)",
	caret: "oklch(0.78 0.12 265)",
	accent: "oklch(0.78 0.12 265)",
	gutterBg: "transparent",
	gutterFg: "oklch(0.615 0.010 265)",
	gutterBorder: "oklch(0.98 0.004 265 / 0.12)",
	activeLine: "oklch(0.98 0.004 265 / 0.06)",
	panelBorder: "oklch(0.98 0.004 265 / 0.16)",
	foldHover: "oklch(0.85 0.12 265)",
	foldPlaceholderBg: "oklch(0.98 0.004 265 / 0.12)",
	foldPlaceholderBorder: "oklch(0.98 0.004 265 / 0.24)",
	foldPlaceholderFg: "oklch(0.775 0.008 265)",
	tooltipBg: "oklch(0.22 0.011 265 / 0.92)",
	tooltipBorder: "oklch(0.98 0.004 265 / 0.22)",
	tooltipFg: "oklch(0.905 0.006 265)",
	tooltipShadow: "0 4px 24px oklch(0 0 0 / 0.5)",
	diffAdded: "oklch(0.82 0.15 150)",
	diffModified: "oklch(0.86 0.14 80)",
	diffDeleted: "oklch(0.72 0.19 22)",
	whitespace: "oklch(0.98 0.004 265 / 0.22)",
};

/** Appends an alpha to an oklch colour by rewriting its closing paren. */
function withAlpha(color: string, alpha: number): string {
	return color.replace(/\)\s*$/, ` / ${alpha})`);
}

/** Expands a palette into the full CodeMirror theme spec. */
function buildThemeFromPalette(p: EditorPalette): Extension {
	const spec: Record<string, Record<string, string>> = {
		"&": {
			backgroundColor: p.bg,
			color: p.fg,
			height: "100%",
			fontFamily: "var(--font-mono)",
		},
		".cm-content": { padding: "12px 0", caretColor: p.caret },
		".cm-focused": { outline: "none" },
		".cm-line": { padding: "0 16px 0 10px", lineHeight: "1.65" },
		".cm-gutters": {
			backgroundColor: p.gutterBg,
			borderRight: `1px solid ${p.gutterBorder}`,
			color: p.gutterFg,
		},
		".cm-gutter": { minWidth: p.gutterMinWidth },
		".cm-lineNumbers .cm-gutterElement": {
			padding: "0 12px 0 8px",
			fontSize: "11.5px",
		},
		".cm-activeLineGutter": { backgroundColor: p.activeLine },
		".cm-activeLine": { backgroundColor: p.activeLine },
		"&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection":
			{
				backgroundColor: `${withAlpha(p.accent, p.selectionAlpha)} !important`,
			},
		".cm-cursor": p.cursorWidth
			? { borderLeftColor: p.caret, borderLeftWidth: p.cursorWidth }
			: { borderLeftColor: p.caret },
		".cm-matchingBracket": {
			backgroundColor: withAlpha(p.accent, p.matchAlpha),
			outline: `1px solid ${withAlpha(p.accent, p.matchAlpha + 0.22)}`,
			borderRadius: "2px",
		},
		".cm-foldGutter": { minWidth: "16px" },
		".cm-foldGutter .cm-gutterElement": {
			padding: "0 2px",
			cursor: "pointer",
			userSelect: "none",
		},
		".cm-foldGutter .cm-gutterElement:hover": { color: p.foldHover },
		".cm-foldPlaceholder": {
			backgroundColor: p.foldPlaceholderBg,
			border: `1px solid ${p.foldPlaceholderBorder}`,
			borderRadius: "3px",
			color: p.foldPlaceholderFg,
			padding: "0 6px",
			margin: "0 4px",
			fontSize: "11px",
			cursor: "pointer",
		},
		".cm-tooltip": {
			backgroundColor: p.tooltipBg,
			border: `1px solid ${p.tooltipBorder}`,
			borderRadius: "6px",
			color: p.tooltipFg,
			boxShadow: p.tooltipShadow,
			fontSize: "12.5px",
		},
		".cm-diff-added": { backgroundColor: p.diffAdded },
		".cm-diff-modified": { backgroundColor: p.diffModified },
		".cm-diff-deleted": {
			backgroundColor: p.diffDeleted,
			height: "3px",
			alignSelf: "flex-end",
		},
		".cm-panels": {
			backgroundColor: p.bg,
			color: p.fg,
		},
		".cm-panel.cm-search": {
			padding: "7px 10px",
			fontSize: "12px",
			fontFamily: "inherit",
		},
		".cm-panel.cm-search label": {
			display: "inline-flex",
			alignItems: "center",
			gap: "3px",
			fontSize: "11px",
			color: p.gutterFg,
		},
		".cm-panel.cm-search input[type=checkbox]": {
			accentColor: p.accent,
			margin: "0 1px",
		},
		".cm-panel.cm-search .cm-textfield": {
			backgroundColor: p.activeLine,
			color: p.fg,
			border: `1px solid ${p.panelBorder ?? p.tooltipBorder}`,
			borderRadius: "4px",
			padding: "3px 7px",
			fontSize: "12px",
			outline: "none",
		},
		".cm-panel.cm-search .cm-textfield:focus": {
			borderColor: p.accent,
		},
		".cm-panel.cm-search .cm-button": {
			backgroundColor: p.foldPlaceholderBg,
			backgroundImage: "none",
			color: p.fg,
			border: `1px solid ${p.panelBorder ?? p.tooltipBorder}`,
			borderRadius: "4px",
			padding: "3px 9px",
			fontSize: "11.5px",
			cursor: "pointer",
		},
		".cm-panel.cm-search .cm-button:hover": {
			backgroundColor: p.foldPlaceholderBorder,
			borderColor: p.accent,
		},
		".cm-panel.cm-search button[name=close]": {
			color: p.gutterFg,
			cursor: "pointer",
			fontSize: "18px",
			padding: "0 4px",
		},
		".cm-panel.cm-search button[name=close]:hover": {
			color: p.fg,
		},
	};

	if (p.nonMatchBg && p.nonMatchOutline) {
		spec[".cm-nonmatchingBracket"] = {
			backgroundColor: p.nonMatchBg,
			outline: `1px solid ${p.nonMatchOutline}`,
		};
	}
	if (p.selectionMatchAlpha > 0) {
		spec[".cm-selectionMatch"] = {
			backgroundColor: withAlpha(p.accent, p.selectionMatchAlpha),
			outline: `1px solid ${withAlpha(p.accent, p.selectionMatchOutlineAlpha)}`,
			borderRadius: "2px",
		};
	}
	if (p.searchBg !== "transparent") {
		spec[".cm-searchMatch"] = {
			backgroundColor: p.searchBg,
			borderRadius: "2px",
		};
		spec[".cm-searchMatch.cm-searchMatch-selected"] = {
			backgroundColor: p.searchSelectedBg,
		};
	}
	if (p.panelBorder) {
		spec[".cm-panels-top"] = { borderBottom: `1px solid ${p.panelBorder}` };
	}
	if (p.whitespace) {
		spec[".cm-highlightSpace, .cm-highlightTab"] = { color: p.whitespace };
	}

	return EditorView.theme(spec, { dark: p.isDark });
}

const PALETTES: Record<ThemeName, EditorPalette> = {
	default: PALETTE_DEFAULT,
	dark: PALETTE_DARK,
	light: PALETTE_LIGHT,
	"high-contrast": PALETTE_HIGH_CONTRAST,
	nord: PALETTE_NORD,
	solarized: PALETTE_SOLARIZED,
	dracula: PALETTE_DRACULA,
	paper: PALETTE_PAPER,
	glass: PALETTE_GLASS,
};

/** The diff gutter colours of a theme, for the minimap which paints its own. */
export function diffColors(theme: string): Record<DiffKind, string> {
	const p = PALETTES[theme as ThemeName] ?? PALETTE_DEFAULT;
	return {
		added: p.diffAdded,
		modified: p.diffModified,
		deleted: p.diffDeleted,
	};
}

/** The theme extension, falling back to the default palette for an unknown id. */
export function buildEditorTheme(theme: string): Extension {
	const cached = editorThemeCache.get(theme);
	if (cached) return cached;
	const built = buildThemeFromPalette(
		PALETTES[theme as ThemeName] ?? PALETTE_DEFAULT,
	);
	editorThemeCache.set(theme, built);
	return built;
}

/** Sizing of the diff gutter; its colours come from CSS variables. */
const diffGutterTheme: Extension = EditorView.theme({
	".cm-diff-gutter": { width: "8px", minWidth: "8px" },
	".cm-diff-gutter .cm-gutterElement": {
		padding: "0",
		width: "8px",
		cursor: "pointer",
	},
	".cm-diff-marker": { width: "8px", height: "100%", cursor: "pointer" },
});

export function buildDiffGutterTheme(): Extension {
	return diffGutterTheme;
}
