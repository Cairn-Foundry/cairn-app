import { t } from "$lib/i18n";
import {
	defaultSyntaxTokens,
	isSyntaxTheme,
	normalizeSyntaxTokens,
	type SyntaxTheme,
	type SyntaxTokenKey,
} from "$lib/utils/editor/syntax-tokens";

export interface PreviewSegment {
	/** Omitted for plain text painted with the editor foreground. */
	token?: SyntaxTokenKey;
	text: string;
}

/**
 * The preview is tokenized by hand rather than parsed, so every customizable
 * category is guaranteed to appear - including `err`, which no grammar ever
 * emits from valid or invalid source alike.
 */
export const PREVIEW_LINES: PreviewSegment[][] = [
	[{ token: "cmt", text: "// Journal keeps the last entries in memory" }],
	[
		{ token: "kw", text: "import" },
		{ text: " " },
		{ token: "br", text: "{" },
		{ text: " " },
		{ token: "def", text: "readFile" },
		{ text: " " },
		{ token: "br", text: "}" },
		{ text: " " },
		{ token: "kw", text: "from" },
		{ text: " " },
		{ token: "str", text: '"node:fs/promises"' },
		{ token: "punc", text: ";" },
	],
	[],
	[
		{ token: "kw", text: "type" },
		{ text: " " },
		{ token: "ty", text: "Level" },
		{ text: " " },
		{ token: "op", text: "=" },
		{ text: " " },
		{ token: "str", text: '"info"' },
		{ text: " " },
		{ token: "op", text: "|" },
		{ text: " " },
		{ token: "str", text: '"error"' },
		{ token: "punc", text: ";" },
	],
	[],
	[{ token: "meta", text: "@observable" }],
	[
		{ token: "kw", text: "export class" },
		{ text: " " },
		{ token: "ty", text: "Journal" },
		{ text: " " },
		{ token: "br", text: "{" },
	],
	[
		{ text: "  " },
		{ token: "prop", text: "#entries" },
		{ token: "punc", text: ":" },
		{ text: " " },
		{ token: "ty", text: "Entry" },
		{ token: "br", text: "[]" },
		{ text: " " },
		{ token: "op", text: "=" },
		{ text: " " },
		{ token: "br", text: "[]" },
		{ token: "punc", text: ";" },
	],
	[],
	[
		{ text: "  " },
		{ token: "kw", text: "async" },
		{ text: " " },
		{ token: "fn", text: "load" },
		{ token: "br", text: "(" },
		{ token: "def", text: "path" },
		{ token: "punc", text: ":" },
		{ text: " " },
		{ token: "ty", text: "string" },
		{ token: "br", text: ")" },
		{ text: " " },
		{ token: "br", text: "{" },
	],
	[
		{ text: "    " },
		{ token: "kw", text: "const" },
		{ text: " " },
		{ token: "def", text: "raw" },
		{ text: " " },
		{ token: "op", text: "=" },
		{ text: " " },
		{ token: "kw", text: "await" },
		{ text: " " },
		{ token: "fn", text: "readFile" },
		{ token: "br", text: "(" },
		{ token: "def", text: "path" },
		{ token: "punc", text: "," },
		{ text: " " },
		{ token: "str", text: '"utf8"' },
		{ token: "br", text: ")" },
		{ token: "punc", text: ";" },
	],
	[
		{ text: "    " },
		{ token: "kw", text: "return" },
		{ text: " " },
		{ token: "def", text: "raw" },
		{ token: "punc", text: "." },
		{ token: "fn", text: "replace" },
		{ token: "br", text: "(" },
		{ token: "re", text: "/\\s+/g" },
		{ token: "punc", text: "," },
		{ text: " " },
		{ token: "str", text: '" "' },
		{ token: "br", text: ")" },
		{ token: "punc", text: "." },
		{ token: "prop", text: "length" },
		{ text: " " },
		{ token: "op", text: ">" },
		{ text: " " },
		{ token: "num", text: "0x1f" },
		{ token: "punc", text: ";" },
	],
	[{ text: "  " }, { token: "br", text: "}" }],
	[],
	[
		{ text: "  " },
		{ token: "fn", text: "render" },
		{ token: "br", text: "()" },
		{ text: " " },
		{ token: "br", text: "{" },
	],
	[
		{ text: "    " },
		{ token: "kw", text: "return" },
		{ text: " " },
		{ token: "punc", text: "<" },
		{ token: "tag", text: "section" },
		{ text: " " },
		{ token: "prop", text: "class" },
		{ token: "op", text: "=" },
		{ token: "str", text: '"journal"' },
		{ token: "punc", text: " />" },
		{ token: "punc", text: ";" },
	],
	[{ text: "  " }, { token: "br", text: "}" }],
	[{ token: "br", text: "}" }],
	[],
	[{ token: "cmt", text: "// A stray character is painted as an error:" }],
	[
		{ token: "kw", text: "const" },
		{ text: " " },
		{ token: "def", text: "marker" },
		{ text: " " },
		{ token: "op", text: "=" },
		{ text: " " },
		{ token: "err", text: "§" },
		{ token: "punc", text: ";" },
	],
];

export function createSyntaxTheme(name: string, theme: string): SyntaxTheme {
	return {
		id: crypto.randomUUID(),
		name,
		tokens: defaultSyntaxTokens(theme),
	};
}

export function duplicateSyntaxTheme(source: SyntaxTheme): SyntaxTheme {
	return {
		id: crypto.randomUUID(),
		name: `${source.name} ${t("settings.syntax.copySuffix")}`,
		tokens: { ...source.tokens },
	};
}

export function serializeSyntaxTheme(theme: SyntaxTheme): string {
	return JSON.stringify({ name: theme.name, tokens: theme.tokens }, null, 2);
}

/** Throws when the payload is not a theme - the caller shows the error. */
export function parseSyntaxTheme(json: string, theme: string): SyntaxTheme {
	const parsed: unknown = JSON.parse(json);
	if (!isSyntaxTheme(parsed)) {
		throw new Error(t("settings.syntax.importInvalid") as string);
	}
	return {
		id: crypto.randomUUID(),
		name: parsed.name,
		tokens: normalizeSyntaxTokens(parsed.tokens, theme),
	};
}
