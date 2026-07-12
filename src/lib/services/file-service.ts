import { invoke } from "@tauri-apps/api/core";

export interface FileNode {
	name: string;
	path: string;
	isDir: boolean;
	children?: FileNode[];
}

export async function readDirTree(
	path: string,
	showHidden = false,
): Promise<FileNode[]> {
	return invoke<FileNode[]>("read_dir_tree", { path, showHidden });
}

export async function listDirNames(path: string): Promise<string[]> {
	return invoke<string[]>("list_dir_names", { path });
}

export async function readFile(path: string): Promise<string | null> {
	return invoke<string | null>("read_file", { path });
}

export async function writeFile(path: string, content: string): Promise<void> {
	return invoke<void>("write_file", { path, content });
}

export async function deletePath(path: string): Promise<void> {
	return invoke<void>("delete_path", { path });
}

export async function renamePath(from: string, to: string): Promise<void> {
	return invoke<void>("rename_path", { from, to });
}

export async function createFileOrDir(
	path: string,
	isDir: boolean,
): Promise<void> {
	return invoke<void>("create_file_or_dir", { path, isDir });
}

export async function copyPath(from: string, to: string): Promise<void> {
	return invoke<void>("copy_path", { from, to });
}

export async function revealInFileManager(path: string): Promise<void> {
	return invoke<void>("reveal_in_file_manager", { path });
}

export async function openInTerminal(path: string): Promise<void> {
	return invoke<void>("open_in_terminal", { path });
}

export type GitStatusMap = Record<
	string,
	"staged" | "modified" | "untracked" | "deleted"
>;

export interface SearchMatch {
	path: string;
	line: number;
	col: number;
	text: string;
	matchStart: number;
	matchEnd: number;
}

export interface SearchOptions {
	caseSensitive: boolean;
	isRegex: boolean;
	includeGlob: string;
	excludeGlob: string;
}

export async function searchInFiles(
	root: string,
	query: string,
	opts: SearchOptions,
): Promise<SearchMatch[]> {
	return invoke<SearchMatch[]>("search_in_files", {
		root,
		query,
		caseSensitive: opts.caseSensitive,
		isRegex: opts.isRegex,
		includeGlob: opts.includeGlob,
		excludeGlob: opts.excludeGlob,
	});
}

export async function gitStatus(worktreePath: string): Promise<GitStatusMap> {
	return invoke<GitStatusMap>("git_status", { worktreePath });
}

export type DiffLineKind = "added" | "modified" | "deleted";
export type DiffLineMap = Map<number, DiffLineKind>;

export interface DiffHunkLine {
	type: "+" | "-" | " ";
	content: string;
}

export interface DiffHunk {
	oldStart: number;
	newStart: number;
	newEnd: number;
	lines: DiffHunkLine[];
}

export interface DiffResult {
	lineMap: DiffLineMap;
	hunks: DiffHunk[];
}

export async function gitFileDiff(
	worktreePath: string,
	relPath: string,
): Promise<DiffResult> {
	const result = await invoke<{
		stdout: string;
		stderr: string;
		success: boolean;
	}>("run_shell_command", {
		program: "git",
		args: ["diff", "HEAD", "--", relPath],
		cwd: worktreePath,
	});
	return parseUnifiedDiff(result.stdout);
}

function parseUnifiedDiff(diff: string): DiffResult {
	const lineMap: DiffLineMap = new Map();
	const hunks: DiffHunk[] = [];

	let currentHunk: DiffHunk | null = null;
	let newLine = 0;
	// prevWasDelete: was the immediately preceding line a '-'? (used for modified vs added)
	let prevWasDelete = false;
	// deletion block tracking: consecutive '-' lines not yet followed by '+'
	let inDeletionBlock = false;
	let deletionPoint = 0;
	let deletionHadPlus = false;

	function flushDeletion() {
		if (inDeletionBlock && !deletionHadPlus) {
			const marker = Math.max(1, deletionPoint);
			if (!lineMap.has(marker)) lineMap.set(marker, "deleted");
		}
		inDeletionBlock = false;
		deletionHadPlus = false;
		prevWasDelete = false;
	}

	for (const line of diff.split("\n")) {
		if (line.startsWith("@@")) {
			flushDeletion();
			if (currentHunk && currentHunk.lines.length > 0) hunks.push(currentHunk);
			const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)/);
			if (!m) continue;
			const oldStart = parseInt(m[1], 10);
			newLine = parseInt(m[2], 10);
			currentHunk = { oldStart, newStart: newLine, newEnd: newLine, lines: [] };
			continue;
		}
		if (
			line.startsWith("---") ||
			line.startsWith("+++") ||
			line.startsWith("\\")
		)
			continue;
		if (!currentHunk) continue;

		if (line.startsWith("-")) {
			if (!inDeletionBlock) {
				deletionPoint = newLine;
				deletionHadPlus = false;
			}
			inDeletionBlock = true;
			prevWasDelete = true;
			currentHunk.lines.push({ type: "-", content: line.slice(1) });
			continue;
		}
		if (line.startsWith("+")) {
			lineMap.set(newLine, prevWasDelete ? "modified" : "added");
			// '+' consumes the current deletion block (it's a replacement, not a pure deletion)
			prevWasDelete = false;
			inDeletionBlock = false;
			deletionHadPlus = false;
			currentHunk.lines.push({ type: "+", content: line.slice(1) });
			currentHunk.newEnd = newLine;
			newLine++;
			continue;
		}
		// context line: flush any pending pure-deletion block
		flushDeletion();
		currentHunk.lines.push({ type: " ", content: line.slice(1) });
		currentHunk.newEnd = newLine;
		newLine++;
	}

	flushDeletion();
	if (currentHunk && currentHunk.lines.length > 0) hunks.push(currentHunk);

	return { lineMap, hunks };
}

export async function gitCommitFileDiff(
	worktreePath: string,
	hash: string,
	relPath: string,
): Promise<DiffHunk[]> {
	const result = await invoke<{
		stdout: string;
		stderr: string;
		success: boolean;
	}>("run_shell_command", {
		program: "git",
		args: ["show", `${hash}`, "--", relPath],
		cwd: worktreePath,
	});
	return parseUnifiedDiff(result.stdout).hunks;
}

export async function gitFileAtCommit(
	worktreePath: string,
	hash: string,
	relPath: string,
): Promise<string> {
	const result = await invoke<{
		stdout: string;
		stderr: string;
		success: boolean;
	}>("run_shell_command", {
		program: "git",
		args: ["show", `${hash}:${relPath}`],
		cwd: worktreePath,
	});
	if (!result.success) throw new Error(result.stderr || "git show failed");
	return result.stdout;
}

export async function gitStagedFileDiff(
	worktreePath: string,
	relPath: string,
): Promise<DiffResult> {
	const result = await invoke<{
		stdout: string;
		stderr: string;
		success: boolean;
	}>("run_shell_command", {
		program: "git",
		args: ["diff", "--cached", "HEAD", "--", relPath],
		cwd: worktreePath,
	});
	return parseUnifiedDiff(result.stdout);
}

export interface BlameEntry {
	hash: string;
	author: string;
	date: string;
	summary: string;
}

export async function gitBlame(
	worktreePath: string,
	relPath: string,
): Promise<Map<number, BlameEntry>> {
	const result = await invoke<{
		stdout: string;
		stderr: string;
		success: boolean;
	}>("run_shell_command", {
		program: "git",
		args: ["blame", "--line-porcelain", "--", relPath],
		cwd: worktreePath,
	});
	if (!result.success) throw new Error(result.stderr || "git blame failed");
	if (result.stderr.includes("binary file")) return new Map();
	return parseBlame(result.stdout);
}

function parseBlame(output: string): Map<number, BlameEntry> {
	const map = new Map<number, BlameEntry>();
	const lines = output.split("\n");
	let i = 0;
	while (i < lines.length) {
		const header = lines[i];
		if (!header || header.length < 40 || !/^[0-9a-f]{40} /.test(header)) {
			i++;
			continue;
		}
		const parts = header.split(" ");
		if (parts.length < 3) {
			i++;
			continue;
		}
		const finalLine = parseInt(parts[2], 10);
		if (Number.isNaN(finalLine)) {
			i++;
			continue;
		}
		let author = "";
		let date = "";
		let summary = "";
		i++;
		while (i < lines.length && !lines[i].startsWith("\t")) {
			if (lines[i].startsWith("author ") && !lines[i].startsWith("author-"))
				author = lines[i].slice(7);
			else if (lines[i].startsWith("author-time ")) {
				const ts = parseInt(lines[i].slice(12), 10);
				date = Number.isNaN(ts)
					? "unknown"
					: new Date(ts * 1000).toLocaleDateString();
			} else if (lines[i].startsWith("summary ")) summary = lines[i].slice(8);
			i++;
		}
		i++; // skip content line
		map.set(finalLine, {
			hash: parts[0].slice(0, 7),
			author: author || "(unknown author)",
			date: date || "unknown",
			summary: summary || "(no summary)",
		});
	}
	return map;
}

export function hunkToPatch(relPath: string, hunk: DiffHunk): string {
	const addCount = hunk.lines.filter((l) => l.type === "+").length;
	const delCount = hunk.lines.filter((l) => l.type === "-").length;
	const ctxCount = hunk.lines.filter((l) => l.type === " ").length;
	const oldCount = delCount + ctxCount;
	const newCount = addCount + ctxCount;
	const body = `${hunk.lines.map((l) => l.type + l.content).join("\n")}\n`;
	return `--- a/${relPath}\n+++ b/${relPath}\n@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@\n${body}`;
}

export async function applyHunkPatch(
	worktreePath: string,
	patch: string,
	opts: { cached?: boolean; reverse?: boolean } = {},
): Promise<{ success: boolean; stderr: string }> {
	const args = ["apply", "--whitespace=nowarn", "--unidiff-zero"];
	if (opts.cached) args.push("--cached");
	if (opts.reverse) args.push("--reverse");
	args.push("-");
	const result = await invoke<{
		stdout: string;
		stderr: string;
		success: boolean;
	}>("run_shell_command_with_stdin", {
		program: "git",
		args,
		cwd: worktreePath,
		stdin: patch,
	});
	return { success: result.success, stderr: result.stderr };
}

const EXT_LANG: Record<string, string> = {
	ts: "ts",
	tsx: "tsx",
	mts: "ts",
	js: "js",
	jsx: "jsx",
	mjs: "js",
	cjs: "js",
	vue: "vue",
	svelte: "svelte",
	html: "html",
	htm: "html",
	css: "css",
	scss: "css",
	less: "css",
	md: "markdown",
	mdx: "markdown",
	xml: "xml",
	svg: "xml",
	yaml: "yaml",
	yml: "yaml",
	py: "python",
	rs: "rust",
	java: "java",
	cpp: "cpp",
	cc: "cpp",
	cxx: "cpp",
	h: "cpp",
	hpp: "cpp",
	php: "php",
	sql: "sql",
	json: "json",
	jsonc: "json",
	toml: "text",
	ini: "text",
	env: "text",
	sh: "text",
	bash: "text",
	zsh: "text",
	txt: "text",
};

const BINARY_EXT = new Set([
	"png",
	"jpg",
	"jpeg",
	"gif",
	"webp",
	"ico",
	"bmp",
	"tiff",
	"pdf",
	"doc",
	"docx",
	"xls",
	"xlsx",
	"ppt",
	"pptx",
	"zip",
	"tar",
	"gz",
	"bz2",
	"xz",
	"7z",
	"rar",
	"mp3",
	"mp4",
	"wav",
	"ogg",
	"flac",
	"avi",
	"mov",
	"mkv",
	"wasm",
	"bin",
	"exe",
	"dll",
	"so",
	"dylib",
	"a",
	"o",
	"ttf",
	"otf",
	"woff",
	"woff2",
	"eot",
	"db",
	"sqlite",
	"sqlite3",
]);

export function langFromPath(filePath: string): string {
	const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
	return EXT_LANG[ext] ?? "text";
}

export function isBinaryPath(filePath: string): boolean {
	const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
	return BINARY_EXT.has(ext);
}
