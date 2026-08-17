import { LanguageSupport } from "@codemirror/language";
import {
	highlightCode,
	type Tag,
	tags as t,
	tagHighlighter,
} from "@lezer/highlight";
import {
	type EditorLanguage,
	resolveLanguageExtension,
} from "$lib/utils/editor/editor-theme";
import type {
	SyntaxTokenKey,
	SyntaxTokens,
} from "$lib/utils/editor/syntax-tokens";

// Reads a diff line's language back into a Lezer parser, one language chunk at a
// time, and tokenizes each line on its own: a diff line has no reliable context
// from the lines around it (a hunk is a fragment, not a full file), so per-line
// tokenizing is the same tradeoff every diff viewer makes.

const HIGHLIGHTER_TAGS: { tag: Tag | Tag[]; class: SyntaxTokenKey }[] = [
	{ tag: t.keyword, class: "kw" },
	{ tag: t.controlKeyword, class: "kw" },
	{ tag: t.definitionKeyword, class: "kw" },
	{ tag: t.moduleKeyword, class: "kw" },
	{ tag: t.operatorKeyword, class: "kw" },
	{ tag: t.function(t.variableName), class: "fn" },
	{ tag: t.function(t.definition(t.variableName)), class: "fn" },
	{ tag: t.definition(t.variableName), class: "def" },
	{ tag: t.variableName, class: "def" },
	{ tag: t.typeName, class: "ty" },
	{ tag: t.className, class: "ty" },
	{ tag: t.definition(t.typeName), class: "ty" },
	{ tag: t.propertyName, class: "prop" },
	{ tag: t.definition(t.propertyName), class: "prop" },
	{ tag: t.string, class: "str" },
	{ tag: t.special(t.string), class: "str" },
	{ tag: t.regexp, class: "re" },
	{ tag: t.number, class: "num" },
	{ tag: t.bool, class: "kw" },
	{ tag: t.null, class: "kw" },
	{ tag: t.atom, class: "kw" },
	{ tag: t.comment, class: "cmt" },
	{ tag: t.lineComment, class: "cmt" },
	{ tag: t.blockComment, class: "cmt" },
	{ tag: t.operator, class: "op" },
	{ tag: t.punctuation, class: "punc" },
	{ tag: t.bracket, class: "br" },
	{ tag: t.tagName, class: "tag" },
	{ tag: t.attributeName, class: "ty" },
	{ tag: t.attributeValue, class: "str" },
	{ tag: t.namespace, class: "ty" },
	{ tag: t.meta, class: "meta" },
	{ tag: t.modifier, class: "kw" },
	{ tag: t.self, class: "kw" },
	{ tag: t.special(t.variableName), class: "fn" },
	{ tag: t.invalid, class: "err" },
];

const HIGHLIGHTER = tagHighlighter(HIGHLIGHTER_TAGS);

const languageCache = new Map<
	EditorLanguage,
	Promise<LanguageSupport | null>
>();

async function loadLanguage(
	lang: EditorLanguage,
): Promise<LanguageSupport | null> {
	let pending = languageCache.get(lang);
	if (!pending) {
		pending = resolveLanguageExtension(lang).then((ext) =>
			ext instanceof LanguageSupport ? ext : null,
		);
		languageCache.set(lang, pending);
	}
	return pending;
}

function escapeHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Renders one line of source as HTML, its tokens wrapped in colour spans. */
export async function highlightLineToHtml(
	code: string,
	lang: EditorLanguage,
	syntaxTokens: SyntaxTokens,
): Promise<string> {
	if (!code || lang === "text") return escapeHtml(code);
	const support = await loadLanguage(lang);
	if (!support) return escapeHtml(code);

	const tree = support.language.parser.parse(code);
	let out = "";
	highlightCode(
		code,
		tree,
		HIGHLIGHTER,
		(text, classes) => {
			if (!classes) {
				out += escapeHtml(text);
				return;
			}
			const key = classes.split(" ")[0] as SyntaxTokenKey;
			const style = syntaxTokens[key];
			const css = style
				? `color:${style.color};${style.italic ? "font-style:italic;" : ""}${style.bold ? "font-weight:600;" : ""}`
				: "";
			out += `<span style="${css}">${escapeHtml(text)}</span>`;
		},
		() => {
			out += "\n";
		},
	);
	return out;
}
