export interface LanguageServerDef {
	id: string;
	name: string;
	extensions: string[];
	/**
	 * What a user calls this without knowing the server's name. React is not a
	 * language server - it is `typescript-language-server` on `.tsx` files - so
	 * searching for it has to land somewhere rather than on an empty list.
	 */
	aliases?: string[];
}

/**
 * Mirror of CATALOG in src-tauri/src/commands/lsp/registry.rs, limited to what
 * the frontend needs before any server has been listed: which server covers a
 * file, and what to call it. Rust owns everything else - binaries, arguments,
 * workspace markers and the install commands.
 */
export const LANGUAGE_SERVERS: LanguageServerDef[] = [
	{
		id: "typescript",
		name: "TypeScript / JavaScript",
		extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"],
		aliases: ["react", "jsx", "tsx", "node", "next", "deno", "angular"],
	},
	{
		id: "python",
		name: "Python (Pyright)",
		extensions: [".py", ".pyi"],
		aliases: ["pyright", "django", "flask", "fastapi"],
	},
	{
		id: "rust",
		name: "Rust (rust-analyzer)",
		extensions: [".rs"],
		aliases: ["rust-analyzer", "cargo"],
	},
	{
		id: "go",
		name: "Go (gopls)",
		extensions: [".go"],
		aliases: ["gopls", "golang"],
	},
	{
		id: "svelte",
		name: "Svelte",
		extensions: [".svelte"],
		aliases: ["sveltekit"],
	},
	{
		id: "json",
		name: "JSON",
		extensions: [".json", ".jsonc"],
	},
	{
		id: "css",
		name: "CSS / SCSS / Less",
		extensions: [".css", ".scss", ".less"],
		aliases: ["sass", "stylesheet", "tailwind"],
	},
	{
		id: "html",
		name: "HTML",
		extensions: [".html", ".htm"],
	},
	{
		id: "yaml",
		name: "YAML",
		extensions: [".yaml", ".yml"],
		aliases: ["yml", "docker compose", "kubernetes", "ci"],
	},
	{
		id: "bash",
		name: "Bash",
		extensions: [".sh", ".bash", ".zsh"],
		aliases: ["shell", "sh", "zsh", "script"],
	},
];

function extensionOf(path: string): string {
	const name = path.split("/").pop() ?? path;
	const dot = name.lastIndexOf(".");
	return dot <= 0 ? "" : name.slice(dot).toLowerCase();
}

/** The catalogue entry covering a file, or null when no server handles it. */
export function serverForPath(path: string): LanguageServerDef | null {
	const ext = extensionOf(path);
	if (!ext) return null;
	return LANGUAGE_SERVERS.find((s) => s.extensions.includes(ext)) ?? null;
}

/**
 * The LSP language id a file must be opened with. Servers key their behaviour
 * on it, so `.tsx` has to say `typescriptreact` and not just `typescript`.
 */
const LANGUAGE_ID_BY_EXT: Record<string, string> = {
	".ts": "typescript",
	".mts": "typescript",
	".cts": "typescript",
	".tsx": "typescriptreact",
	".js": "javascript",
	".mjs": "javascript",
	".cjs": "javascript",
	".jsx": "javascriptreact",
	".py": "python",
	".pyi": "python",
	".rs": "rust",
	".go": "go",
	".svelte": "svelte",
	".json": "json",
	".jsonc": "jsonc",
	".css": "css",
	".scss": "scss",
	".less": "less",
	".html": "html",
	".htm": "html",
	".yaml": "yaml",
	".yml": "yaml",
	".sh": "shellscript",
	".bash": "shellscript",
	".zsh": "shellscript",
};

export function languageIdForPath(path: string): string | null {
	const ext = extensionOf(path);
	if (!ext) return null;
	return LANGUAGE_ID_BY_EXT[ext] ?? null;
}

/**
 * The version number inside whatever `--version` printed. Servers pad it with
 * their own name, a commit hash and a date, none of which belongs in a list.
 */
export function shortVersion(raw: string | null): string | null {
	if (!raw) return null;
	return raw.match(/\d+\.\d+(?:\.\d+)*(?:[-+][\w.]+)?/)?.[0] ?? null;
}

/**
 * Whether a server answers a search. Everything the page shows is searched -
 * the name, the extensions it covers - plus what the user is likely to type
 * instead: "react" finds TypeScript, "sass" finds CSS. The leading dot of an
 * extension is optional, so "py" and ".py" both work.
 */
export function matchesServerQuery(
	server: { id: string; name: string; extensions: string[] },
	query: string,
): boolean {
	const needle = query.trim().toLowerCase();
	if (!needle) return true;
	if (server.name.toLowerCase().includes(needle)) return true;
	if (server.id.includes(needle)) return true;

	const extension = needle.startsWith(".") ? needle : `.${needle}`;
	if (server.extensions.some((covered) => covered.includes(extension))) {
		return true;
	}

	const aliases =
		LANGUAGE_SERVERS.find((s) => s.id === server.id)?.aliases ?? [];
	return aliases.some((alias) => alias.includes(needle));
}

/** Up to `max` extensions, the rest folded into a `+n`. */
export function summarizeExtensions(
	extensions: string[],
	max = 4,
): { shown: string[]; rest: number } {
	return {
		shown: extensions.slice(0, max),
		rest: Math.max(0, extensions.length - max),
	};
}
