import type { EditorLanguage } from "$lib/utils/editor/editor-theme";
import type { SyntaxTokens } from "$lib/utils/editor/syntax-tokens";
import { highlightLineInline } from "./diff-highlight-core";
import type {
	HighlightRequest,
	HighlightResponse,
} from "./diff-highlight-protocol";

// Lezer runs off the main thread: the git view only renders what comes back.
// Anywhere a Worker cannot be built (tests, a webview without module
// workers) the same code runs inline, so the result never differs.

/**
 * Highlighted lines survive the cards that showed them: switching project and
 * back rebuilds every card, and without this each line flashed as plain text
 * until the worker answered again. Keyed by language and content, so the same
 * line in two files costs one highlight.
 */
const CACHE_MAX = 50_000;
let cache = new Map<string, string>();
let cacheTokens: SyntaxTokens | null = null;

/** The cached HTML of a line, or undefined if it was never highlighted with these tokens. */
export function cachedLineHtml(
	code: string,
	lang: EditorLanguage,
	syntaxTokens: SyntaxTokens,
): string | undefined {
	if (cacheTokens !== syntaxTokens) {
		cache = new Map();
		cacheTokens = syntaxTokens;
	}
	return cache.get(`${lang}:${code}`);
}

function remember(code: string, lang: EditorLanguage, html: string): void {
	if (cache.size >= CACHE_MAX) cache.clear();
	cache.set(`${lang}:${code}`, html);
}

let worker: Worker | null | undefined;
let nextId = 0;
const pending = new Map<number, (html: string) => void>();

function getWorker(): Worker | null {
	if (worker !== undefined) return worker;
	try {
		worker = new Worker(
			new URL("./diff-highlight.worker.ts", import.meta.url),
			{
				type: "module",
			},
		);
		worker.onmessage = (e: MessageEvent<HighlightResponse>) => {
			pending.get(e.data.id)?.(e.data.html);
			pending.delete(e.data.id);
		};
		worker.onerror = () => {
			worker?.terminate();
			worker = null;
			for (const [, resolve] of pending) resolve("");
			pending.clear();
		};
	} catch {
		worker = null;
	}
	return worker;
}

/** Renders one line of source as HTML, its tokens wrapped in colour spans. */
export function highlightLineToHtml(
	code: string,
	lang: EditorLanguage,
	syntaxTokens: SyntaxTokens,
): Promise<string> {
	const hit = cachedLineHtml(code, lang, syntaxTokens);
	if (hit !== undefined) return Promise.resolve(hit);
	return highlightUncached(code, lang, syntaxTokens).then((html) => {
		remember(code, lang, html);
		return html;
	});
}

function highlightUncached(
	code: string,
	lang: EditorLanguage,
	syntaxTokens: SyntaxTokens,
): Promise<string> {
	const w = getWorker();
	if (!w) return highlightLineInline(code, lang, syntaxTokens);
	return new Promise((resolve) => {
		const id = ++nextId;
		pending.set(id, (html) =>
			html === ""
				? highlightLineInline(code, lang, syntaxTokens).then(resolve)
				: resolve(html),
		);
		const request: HighlightRequest = { id, code, lang, tokens: syntaxTokens };
		w.postMessage(request);
	});
}
