// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

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
