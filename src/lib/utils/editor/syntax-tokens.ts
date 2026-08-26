// The syntax palette: the token classes the highlighter emits, and the default
// colours each app theme starts from before the user edits them.

const LIGHT_THEME_IDS = new Set(["light", "paper"]);

/** The token classes every syntax theme must colour. */
export const SYNTAX_TOKEN_KEYS = [
	"kw",
	"fn",
	"def",
	"ty",
	"prop",
	"str",
	"re",
	"num",
	"cmt",
	"op",
	"punc",
	"br",
	"tag",
	"meta",
	"err",
] as const;

export type SyntaxTokenKey = (typeof SYNTAX_TOKEN_KEYS)[number];

/** One token's appearance; only the colour is required. */
export interface SyntaxTokenStyle {
	color: string;
	bold?: boolean;
	italic?: boolean;
	underline?: boolean;
}

export type SyntaxTokens = Record<SyntaxTokenKey, SyntaxTokenStyle>;

/** A named, complete syntax palette, as stored and as exported to a file. */
export interface SyntaxTheme {
	id: string;
	name: string;
	tokens: SyntaxTokens;
}

const COLORS_DARK: Record<SyntaxTokenKey, string> = {
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

const COLORS_LIGHT: Record<SyntaxTokenKey, string> = {
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

const ITALIC_BY_DEFAULT = new Set<SyntaxTokenKey>(["kw", "cmt"]);

/** The starting palette for an app theme: a light one for light backgrounds. */
export function defaultSyntaxTokens(theme: string): SyntaxTokens {
	const colors = LIGHT_THEME_IDS.has(theme) ? COLORS_LIGHT : COLORS_DARK;
	const tokens = {} as SyntaxTokens;
	for (const key of SYNTAX_TOKEN_KEYS) {
		tokens[key] = { color: colors[key], italic: ITALIC_BY_DEFAULT.has(key) };
	}
	return tokens;
}

/** Fills in the keys a stored or imported theme may be missing. */
export function normalizeSyntaxTokens(
	tokens: Partial<SyntaxTokens> | undefined,
	theme: string,
): SyntaxTokens {
	const base = defaultSyntaxTokens(theme);
	if (!tokens) return base;
	for (const key of SYNTAX_TOKEN_KEYS) {
		const style = tokens[key];
		if (style?.color) base[key] = { ...style, color: style.color };
	}
	return base;
}

/** Shape check for a theme read from an imported file, which is untrusted. */
export function isSyntaxTheme(value: unknown): value is SyntaxTheme {
	if (!value || typeof value !== "object") return false;
	const theme = value as SyntaxTheme;
	return (
		typeof theme.name === "string" &&
		typeof theme.tokens === "object" &&
		theme.tokens !== null
	);
}
