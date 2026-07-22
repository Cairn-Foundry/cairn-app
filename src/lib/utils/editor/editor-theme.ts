import { cpp } from "@codemirror/lang-cpp";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { java } from "@codemirror/lang-java";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { php } from "@codemirror/lang-php";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { sql } from "@codemirror/lang-sql";
import { vue } from "@codemirror/lang-vue";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { svelte } from "codemirror-lang-svelte";

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
	| "xml"
	| "yaml"
	| "python"
	| "rust"
	| "java"
	| "cpp"
	| "php"
	| "text";

export type ThemeName = "dark" | "light" | "high-contrast";

export function resolveLanguageExtension(lang: EditorLanguage): Extension {
	switch (lang) {
		case "tsx":
			return javascript({ typescript: true, jsx: true });
		case "jsx":
			return javascript({ typescript: false, jsx: true });
		case "vue":
			return vue();
		case "svelte":
			return svelte();
		case "sql":
			return sql();
		case "json":
			return json();
		case "html":
			return html();
		case "css":
			return css();
		case "markdown":
			return markdown({ base: markdownLanguage, codeLanguages: languages });
		case "xml":
			return xml();
		case "yaml":
			return yaml();
		case "python":
			return python();
		case "rust":
			return rust();
		case "java":
			return java();
		case "cpp":
			return cpp();
		case "php":
			return php();
		case "text":
			return [];
		default:
			return javascript({ typescript: lang === "ts", jsx: false });
	}
}

// -- Syntax highlighting ------------------------------------------------------

interface HighlightPalette {
	kw: string;
	fn: string;
	def: string;
	ty: string;
	prop: string;
	str: string;
	re: string;
	num: string;
	cmt: string;
	op: string;
	punc: string;
	br: string;
	tag: string;
	meta: string;
	err: string;
}

const HIGHLIGHT_DARK: HighlightPalette = {
	kw: "oklch(0.72 0.19 295)",
	fn: "oklch(0.84 0.16 55)",
	def: "oklch(0.88 0.005 80)",
	ty: "oklch(0.78 0.13 200)",
	prop: "oklch(0.80 0.11 225)",
	str: "oklch(0.78 0.14 135)",
	re: "oklch(0.76 0.14 50)",
	num: "oklch(0.82 0.14 60)",
	cmt: "oklch(0.50 0.010 80)",
	op: "oklch(0.80 0.06 250)",
	punc: "oklch(0.65 0.006 80)",
	br: "oklch(0.72 0.08 80)",
	tag: "oklch(0.72 0.18 15)",
	meta: "oklch(0.56 0.010 80)",
	err: "oklch(0.70 0.18 15)",
};

const HIGHLIGHT_LIGHT: HighlightPalette = {
	kw: "oklch(0.42 0.18 295)",
	fn: "oklch(0.50 0.16 55)",
	def: "oklch(0.18 0.005 70)",
	ty: "oklch(0.38 0.13 200)",
	prop: "oklch(0.38 0.11 225)",
	str: "oklch(0.38 0.14 135)",
	re: "oklch(0.44 0.14 50)",
	num: "oklch(0.44 0.14 60)",
	cmt: "oklch(0.62 0.010 80)",
	op: "oklch(0.42 0.08 250)",
	punc: "oklch(0.46 0.006 70)",
	br: "oklch(0.42 0.06 70)",
	tag: "oklch(0.44 0.18 15)",
	meta: "oklch(0.52 0.010 80)",
	err: "oklch(0.48 0.18 15)",
};

export function buildHighlight(theme: string): HighlightStyle {
	const p = theme === "light" ? HIGHLIGHT_LIGHT : HIGHLIGHT_DARK;
	const italic = "italic";
	return HighlightStyle.define([
		{ tag: t.keyword, color: p.kw, fontStyle: italic },
		{ tag: t.controlKeyword, color: p.kw, fontStyle: italic },
		{ tag: t.definitionKeyword, color: p.kw, fontStyle: italic },
		{ tag: t.moduleKeyword, color: p.kw, fontStyle: italic },
		{ tag: t.operatorKeyword, color: p.kw, fontStyle: italic },
		{ tag: t.function(t.variableName), color: p.fn },
		{ tag: t.function(t.definition(t.variableName)), color: p.fn },
		{ tag: t.definition(t.variableName), color: p.def },
		{ tag: t.variableName, color: p.def },
		{ tag: t.typeName, color: p.ty },
		{ tag: t.className, color: p.ty },
		{ tag: t.definition(t.typeName), color: p.ty },
		{ tag: t.propertyName, color: p.prop },
		{ tag: t.definition(t.propertyName), color: p.prop },
		{ tag: t.string, color: p.str },
		{ tag: t.special(t.string), color: p.str },
		{ tag: t.regexp, color: p.re },
		{ tag: t.number, color: p.num },
		{ tag: t.bool, color: p.kw, fontStyle: italic },
		{ tag: t.null, color: p.kw, fontStyle: italic },
		{ tag: t.atom, color: p.kw },
		{ tag: t.comment, color: p.cmt, fontStyle: italic },
		{ tag: t.lineComment, color: p.cmt, fontStyle: italic },
		{ tag: t.blockComment, color: p.cmt, fontStyle: italic },
		{ tag: t.operator, color: p.op },
		{ tag: t.punctuation, color: p.punc },
		{ tag: t.bracket, color: p.br },
		{ tag: t.tagName, color: p.tag },
		{ tag: t.attributeName, color: p.ty },
		{ tag: t.attributeValue, color: p.str },
		{ tag: t.namespace, color: p.ty },
		{ tag: t.meta, color: p.meta },
		{ tag: t.modifier, color: p.kw, fontStyle: italic },
		{ tag: t.self, color: p.kw, fontStyle: italic },
		{ tag: t.special(t.variableName), color: p.fn },
		{ tag: t.inserted, color: p.str },
		{ tag: t.deleted, color: p.err },
		{ tag: t.changed, color: p.num },
		{ tag: t.invalid, color: p.err, textDecoration: "underline wavy" },
	]);
}

// -- Editor theme palettes ----------------------------------------------------

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

const PALETTE_DARK: EditorPalette = {
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

function withAlpha(color: string, alpha: number): string {
	return color.replace(/\)\s*$/, ` / ${alpha})`);
}

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
	dark: PALETTE_DARK,
	light: PALETTE_LIGHT,
	"high-contrast": PALETTE_HIGH_CONTRAST,
};

export function buildEditorTheme(theme: string): Extension {
	return buildThemeFromPalette(PALETTES[theme as ThemeName] ?? PALETTE_DARK);
}

export function buildSyntaxHighlighting(theme: string): Extension {
	return syntaxHighlighting(buildHighlight(theme));
}

export function buildDiffGutterTheme(): Extension {
	return EditorView.theme({
		".cm-diff-gutter": { width: "8px", minWidth: "8px" },
		".cm-diff-gutter .cm-gutterElement": {
			padding: "0",
			width: "8px",
			cursor: "pointer",
		},
		".cm-diff-marker": { width: "8px", height: "100%", cursor: "pointer" },
	});
}
