// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Filesystem access for the editor: tree, read and write, search, and the git
// views built by shelling out to `git` rather than by a dedicated Rust command.

import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { dedupeInflight } from "./inflight";

/** One entry of the file tree; `children` is only filled for expanded directories. */
export interface FileNode {
	name: string;
	path: string;
	isDir: boolean;
	children?: FileNode[];
}

/** The tree as the backend ships it: one string of names, one parent index per entry. */
export interface FlatTree {
	names: string;
	parents: number[];
	sep: string;
}

/** Rebuilds the nested tree in one pass; the backend already sorted it for display. */
export function inflateTree(flat: FlatTree): FileNode[] {
	const names = flat.names === "" ? [] : flat.names.split("\n");
	const nodes: FileNode[] = new Array(names.length);
	const roots: FileNode[] = [];
	for (let i = 0; i < names.length; i++) {
		const raw = names[i];
		const isDir = raw.endsWith("/");
		const name = isDir ? raw.slice(0, -1) : raw;
		const parent = flat.parents[i] >= 0 ? nodes[flat.parents[i]] : null;
		const node: FileNode = {
			name,
			path: parent ? `${parent.path}${flat.sep}${name}` : name,
			isDir,
			...(isDir ? { children: [] } : {}),
		};
		nodes[i] = node;
		if (parent) parent.children?.push(node);
		else roots.push(node);
	}
	return roots;
}

/** Whole tree of a worktree, gitignored entries excluded unless `showIgnored`. */
export async function readDirTree(
	path: string,
	showIgnored = false,
): Promise<FileNode[]> {
	return dedupeInflight(`tree:${path}:${showIgnored}`, async () =>
		inflateTree(await invoke<FlatTree>("read_dir_tree", { path, showIgnored })),
	);
}

/** What the last walk of this directory found, from the disk cache; null when it was never walked. */
export async function readDirTreeCached(
	path: string,
	showIgnored = false,
): Promise<FileNode[] | null> {
	const flat = await invoke<FlatTree | null>("read_dir_tree_cached", {
		path,
		showIgnored,
	});
	return flat ? inflateTree(flat) : null;
}

/** Bare entry names of one directory, without the tree walk. */
export async function listDirNames(path: string): Promise<string[]> {
	return invoke<string[]>("list_dir_names", { path });
}

/** Entry names of `path` and its sub-directories down to `depth`, keyed by relative sub-path ("" for the root). */
export async function listDirNamesDeep(
	path: string,
	depth: number,
): Promise<Record<string, string[]>> {
	return invoke<Record<string, string[]>>("list_dir_names_deep", {
		path,
		depth,
	});
}

/** A path match from the quick open palette. */
export interface QuickSearchHit {
	path: string;
	isDir: boolean;
}

/**
 * Fuzzy path search over a cached index; `refresh` rebuilds that index, so
 * callers set it only when the worktree or the ignore setting changed.
 */
export async function quickSearch(
	path: string,
	query: string,
	includeIgnored: boolean,
	refresh: boolean,
	limit = 50,
): Promise<QuickSearchHit[]> {
	return invoke<QuickSearchHit[]>("quick_search", {
		path,
		query,
		includeIgnored,
		refresh,
		limit,
	});
}

/** Text content of a file, or null when it is not valid UTF-8. */
/**
 * Files come through the `cairn://` protocol as raw bytes with an ETag: a
 * file already held here is answered with a 304 and costs the backend a stat.
 */
const FILE_CACHE_MAX = 64;
const fileCache = new Map<string, { etag: string; text: string | null }>();

export async function readFile(path: string): Promise<string | null> {
	return dedupeInflight(`read:${path}`, async () => {
		const known = fileCache.get(path);
		const response = await fetch(convertFileSrc(path, "cairn"), {
			headers: known ? { "If-None-Match": known.etag } : {},
		});
		if (response.status === 304 && known) {
			fileCache.delete(path);
			fileCache.set(path, known);
			return known.text;
		}
		if (!response.ok) throw await response.text();
		const bytes = await response.arrayBuffer();
		let text: string | null;
		try {
			text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
				bytes,
			);
		} catch {
			text = null;
		}
		const etag = response.headers.get("etag") ?? "";
		if (etag) {
			fileCache.delete(path);
			fileCache.set(path, { etag, text });
			for (const oldest of fileCache.keys()) {
				if (fileCache.size <= FILE_CACHE_MAX) break;
				fileCache.delete(oldest);
			}
		}
		return text;
	});
}

/** Last-modified time in milliseconds per path; a missing file has no entry. */
export async function fileMtimes(
	paths: string[],
): Promise<Record<string, number>> {
	return invoke<Record<string, number>>("file_mtimes", { paths });
}

/** Size plus the first bytes as hex, enough to identify a binary by its magic number. */
export interface FilePreview {
	size: number;
	headHex: string;
}

/** Cheap look at a file that must not be loaded whole - binaries, large files. */
export async function readFilePreview(path: string): Promise<FilePreview> {
	return invoke<FilePreview>("read_file_preview", { path });
}

/** Whole file as base64, for the image and binary viewers. */
export async function readFileBase64(path: string): Promise<string> {
	return invoke<string>("read_file_base64", { path });
}

/** Overwrites the file, creating it if needed. */
export async function writeFile(path: string, content: string): Promise<void> {
	return invoke<void>("write_file", { path, content });
}

/** Deletes a file or a directory recursively; it does not go to the trash. */
export async function deletePath(path: string): Promise<void> {
	return invoke<void>("delete_path", { path });
}

/** Moves a path, which is also how a rename in place is done. */
export async function renamePath(from: string, to: string): Promise<void> {
	return invoke<void>("rename_path", { from, to });
}

/** Creates an empty file or a directory, parents included. */
export async function createFileOrDir(
	path: string,
	isDir: boolean,
): Promise<void> {
	return invoke<void>("create_file_or_dir", { path, isDir });
}

/** Copies a file or a whole directory. */
export async function copyPath(from: string, to: string): Promise<void> {
	return invoke<void>("copy_path", { from, to });
}

/** Shows the path in Finder or the platform equivalent. */
export async function revealInFileManager(path: string): Promise<void> {
	return invoke<void>("reveal_in_file_manager", { path });
}

/** Opens the system terminal application on that directory. */
export async function openInTerminal(path: string): Promise<void> {
	return invoke<void>("open_in_terminal", { path });
}

/** Status of one file as the Rust `git_status` command reports it. */
export type GitFileStatus =
	| "modified"
	| "untracked"
	| "deleted"
	| "conflicted"
	| "staged-added"
	| "staged-deleted"
	| "staged-renamed"
	| "staged-copied"
	| "staged-modified";

/** Status of the whole worktree, keyed by path relative to its root. */
export type GitStatusMap = Record<string, GitFileStatus>;

/** One hit of a content search; `matchStart` / `matchEnd` index into `text`. */
export interface SearchMatch {
	path: string;
	line: number;
	col: number;
	text: string;
	matchStart: number;
	matchEnd: number;
}

/** Search filters; the globs are empty strings when the user set none. */
export interface SearchOptions {
	caseSensitive: boolean;
	isRegex: boolean;
	includeGlob: string;
	excludeGlob: string;
}

/** Content search under a root; the options are flattened into the IPC payload. */
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

/** Status of every changed file, for the badges in the file tree. */
export async function gitStatus(worktreePath: string): Promise<GitStatusMap> {
	return dedupeInflight(`status:${worktreePath}`, () =>
		invoke<GitStatusMap>("git_status", { worktreePath }),
	);
}

/** How a line is marked in the editor gutter. */
export type DiffLineKind = "added" | "modified" | "deleted";
/** Gutter marks keyed by line number in the current file, one-based. */
export type DiffLineMap = Map<number, DiffLineKind>;

/** One line of a hunk, carrying its unified-diff marker. */
export interface DiffHunkLine {
	type: "+" | "-" | " ";
	content: string;
}

/** A unified-diff hunk; `newEnd` is the last line it covers in the new file. */
export interface DiffHunk {
	oldStart: number;
	newStart: number;
	newEnd: number;
	lines: DiffHunkLine[];
}

/** The same diff in both shapes the UI needs: gutter marks and hunks. */
export interface DiffResult {
	lineMap: DiffLineMap;
	hunks: DiffHunk[];
}

/** Diff of one file against HEAD, staged changes included. */
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

/**
 * Turns `git diff` output into gutter marks and hunks. A '-' block followed by
 * a '+' is a modification, one that is not becomes a single "deleted" mark on
 * the line that survives it, since a removed line has no row of its own.
 */
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

	/** Closes a pending '-' block, marking it deleted only if no '+' replaced it. */
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

/** Diff of the index against HEAD for one file: the staged half only. */
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

/** Blame of one line; `hash` is already shortened to 7 characters for display. */
export interface BlameEntry {
	hash: string;
	author: string;
	date: string;
	summary: string;
}

/** One line's blame as Rust reduces it, before display formatting. */
interface BlameLine {
	line: number;
	hash: string;
	author: string;
	timestamp: number;
	summary: string;
}

/**
 * Blame keyed by line number; an empty map when the file is binary. The
 * porcelain output is parsed in Rust, so only these four fields cross the IPC
 * rather than the megabytes of repeated commit headers git prints.
 */
export async function gitBlame(
	worktreePath: string,
	relPath: string,
): Promise<Map<number, BlameEntry>> {
	let lines: BlameLine[];
	try {
		lines = await invoke<BlameLine[]>("git_blame_file", {
			worktreePath,
			filePath: relPath,
		});
	} catch (e) {
		if (String(e).includes("binary file")) return new Map();
		throw e;
	}
	return new Map(
		lines.map((l) => [
			l.line,
			{
				hash: l.hash,
				author: l.author || "(unknown author)",
				date: l.timestamp
					? new Date(l.timestamp * 1000).toLocaleDateString()
					: "unknown",
				summary: l.summary || "(no summary)",
			},
		]),
	);
}

/** One added or removed line inside a line-history entry. */
export interface LineHistoryChange {
	type: "+" | "-";
	content: string;
}

/** One commit that touched the tracked line; `timestamp` is in milliseconds. */
export interface LineHistoryEntry {
	hash: string;
	shortHash: string;
	author: string;
	email: string;
	timestamp: number;
	subject: string;
	changes: LineHistoryChange[];
}

const LINE_HISTORY_LIMIT = 30;
// Record and field separators, matching the %x01 / %x1f of the --format below.
const SOH = "\u0001";
const US = "\u001f";

/** History of a single line, newest first, capped at LINE_HISTORY_LIMIT commits. */
export async function gitLineHistory(
	worktreePath: string,
	relPath: string,
	line: number,
): Promise<LineHistoryEntry[]> {
	const result = await invoke<{
		stdout: string;
		stderr: string;
		success: boolean;
	}>("run_shell_command", {
		program: "git",
		args: [
			"log",
			`-L${line},${line}:${relPath}`,
			"--no-color",
			`-n${LINE_HISTORY_LIMIT}`,
			"--format=%x01%H%x1f%an%x1f%ae%x1f%at%x1f%s",
		],
		cwd: worktreePath,
	});
	if (!result.success) throw new Error(result.stderr || "git log -L failed");
	return parseLineHistory(result.stdout);
}

/** Splits the `-L` output on the record separator, one entry per commit. */
function parseLineHistory(output: string): LineHistoryEntry[] {
	const entries: LineHistoryEntry[] = [];
	let current: LineHistoryEntry | null = null;
	for (const line of output.split("\n")) {
		if (line.startsWith(SOH)) {
			const [hash, author, email, at, ...rest] = line.slice(1).split(US);
			if (!hash) continue;
			const timestamp = parseInt(at ?? "", 10);
			current = {
				hash,
				shortHash: hash.slice(0, 7),
				author: author || "(unknown author)",
				email: email ?? "",
				timestamp: Number.isNaN(timestamp) ? 0 : timestamp * 1000,
				subject: rest.join(US) || "(no subject)",
				changes: [],
			};
			entries.push(current);
			continue;
		}
		if (!current) continue;
		// The diff body of `-L` is a single hunk; only its +/- lines carry the
		// state of the tracked line, and "---" / "+++" are file headers.
		if (line.startsWith("+++") || line.startsWith("---")) continue;
		if (line.startsWith("+") || line.startsWith("-")) {
			current.changes.push({
				type: line[0] as "+" | "-",
				content: line.slice(1),
			});
		}
	}
	return entries;
}

/**
 * Wraps one hunk into a patch `git apply` accepts, recounting the header from
 * the lines themselves so a hunk edited in the UI stays consistent.
 */
export function hunkToPatch(relPath: string, hunk: DiffHunk): string {
	const addCount = hunk.lines.filter((l) => l.type === "+").length;
	const delCount = hunk.lines.filter((l) => l.type === "-").length;
	const ctxCount = hunk.lines.filter((l) => l.type === " ").length;
	const oldCount = delCount + ctxCount;
	const newCount = addCount + ctxCount;
	const body = `${hunk.lines.map((l) => l.type + l.content).join("\n")}\n`;
	return `--- a/${relPath}\n+++ b/${relPath}\n@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@\n${body}`;
}

// Extension to syntax mode. The values are the modes the editor knows, so
// several extensions collapse onto one and anything exotic falls back to text.
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
	mmd: "mermaid",
	mermaid: "mermaid",
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
	"avif",
	"apng",
	"heic",
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

/** Syntax mode for a path, "text" when the extension is unknown. */
export function langFromPath(filePath: string): string {
	const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
	return EXT_LANG[ext] ?? "text";
}

/**
 * Extension-only guess, so a binary with an unlisted extension is missed;
 * readFile returning null is what settles it for certain.
 */
export function isBinaryPath(filePath: string): boolean {
	const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
	return BINARY_EXT.has(ext);
}
