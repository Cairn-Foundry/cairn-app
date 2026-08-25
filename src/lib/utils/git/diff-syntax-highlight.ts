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
