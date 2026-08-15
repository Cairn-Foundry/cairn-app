/**
 * How a language id is shown. The ids come from the LSP vocabulary, where
 * `javascriptreact` and `objective-cpp` are normal - they are not names anyone
 * should have to read in a settings list.
 */
const LABELS: Record<string, string> = {
	javascript: "JavaScript",
	javascriptreact: "JavaScript (JSX)",
	typescript: "TypeScript",
	typescriptreact: "TypeScript (TSX)",
	svelte: "Svelte",
	vue: "Vue",
	css: "CSS",
	scss: "SCSS",
	less: "Less",
	html: "HTML",
	json: "JSON",
	jsonc: "JSON with comments",
	yaml: "YAML",
	markdown: "Markdown",
	graphql: "GraphQL",
	rust: "Rust",
	go: "Go",
	python: "Python",
	c: "C",
	cpp: "C++",
	"objective-c": "Objective-C",
	"objective-cpp": "Objective-C++",
	java: "Java",
	csharp: "C#",
	php: "PHP",
	kotlin: "Kotlin",
	shellscript: "Shell",
	bash: "Bash",
	toml: "TOML",
};

/** Falls back to the raw id, so a language added later still shows something. */
export function languageLabel(languageId: string): string {
	return LABELS[languageId] ?? languageId;
}

/** Sorts by what the user reads, not by the underlying id. */
export function sortByLabel(languageIds: string[]): string[] {
	return [...languageIds].sort((a, b) =>
		languageLabel(a).localeCompare(languageLabel(b)),
	);
}

/**
 * Whether a language matches a search box. Both the label and the raw id are
 * searched, so typing "tsx" or "TypeScript" both land on the same row.
 */
export function matchesLanguageQuery(
	languageId: string,
	query: string,
	formatterName = "",
): boolean {
	const needle = query.trim().toLowerCase();
	if (!needle) return true;
	return (
		languageId.toLowerCase().includes(needle) ||
		languageLabel(languageId).toLowerCase().includes(needle) ||
		formatterName.toLowerCase().includes(needle)
	);
}
