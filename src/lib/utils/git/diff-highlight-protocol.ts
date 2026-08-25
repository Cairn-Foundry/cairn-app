import type { EditorLanguage } from "$lib/utils/editor/editor-theme";
import type { SyntaxTokens } from "$lib/utils/editor/syntax-tokens";

export interface HighlightRequest {
	id: number;
	code: string;
	lang: EditorLanguage;
	tokens: SyntaxTokens;
}

export interface HighlightResponse {
	id: number;
	html: string;
}
