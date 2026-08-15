/** Basic syntax-token rendering for TS snippets */
// Static highlighting for the short TypeScript snippets shown outside the
// editor. CodeMirror is not involved, so the rules are deliberately shallow.

/**
 * Escapes first, then wraps tokens in spans. Regex-based rather than parsed:
 * a keyword inside a string is highlighted twice over, which is acceptable for
 * the handful of illustrative snippets this serves.
 */
export function tok(code: string): string {
	const keywords =
		/\b(export|function|const|let|return|async|await|import|from|if|else|new|class|interface|type|true|false|null|undefined|void)\b/g;
	const strings = /('[^']*'|"[^"]*"|`[^`]*`)/g;
	const comments = /(\/\/.*)/g;
	const numbers = /\b(\d+)\b/g;
	const types = /\b(string|number|boolean|Promise|void|any|User|Session)\b/g;

	let result = code
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
	result = result.replace(comments, '<span class="tok-c">$1</span>');
	result = result.replace(strings, '<span class="tok-s">$1</span>');
	result = result.replace(keywords, '<span class="tok-k">$1</span>');
	result = result.replace(types, '<span class="tok-t">$1</span>');
	result = result.replace(numbers, '<span class="tok-n">$1</span>');
	return result;
}
