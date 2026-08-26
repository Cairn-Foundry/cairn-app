import type { FileNode, GitStatusMap } from "$lib/services/file-service";

// The file tree's own logic: what is visible, how git status rolls up onto a
// directory, and the relative/absolute path convention tabs are keyed by.

/** Most to least urgent: a directory shows the worst status underneath it. */
export const GIT_STATUS_PRIORITY = [
	"conflicted",
	"staged",
	"modified",
	"deleted",
	"untracked",
] as const;
export type GitStatus = (typeof GIT_STATUS_PRIORITY)[number];

/** The rows actually drawn: a collapsed directory hides its whole subtree. */
export function flattenVisible(
	nodes: FileNode[],
	expanded: Set<string>,
): FileNode[] {
	const result: FileNode[] = [];
	for (const n of nodes) {
		result.push(n);
		if (n.isDir && n.children && expanded.has(n.path))
			result.push(...flattenVisible(n.children, expanded));
	}
	return result;
}

/** The nodes matching `paths`, in tree order rather than selection order. */
export function flattenToNodes(
	tree: FileNode[],
	paths: Set<string>,
): FileNode[] {
	const result: FileNode[] = [];
	function search(nodes: FileNode[]) {
		for (const n of nodes) {
			if (paths.has(n.path)) result.push(n);
			if (n.isDir && n.children) search(n.children);
		}
	}
	search(tree);
	return result;
}

/** Every file path in the tree; directories are not included. */
export function collectFilePaths(nodes: FileNode[]): Set<string> {
	const result = new Set<string>();
	function walk(ns: FileNode[]) {
		for (const n of ns) {
			if (!n.isDir) result.add(n.path);
			if (n.isDir && n.children) walk(n.children);
		}
	}
	walk(nodes);
	return result;
}

/** Depth-first lookup by exact path. */
function findNode(nodes: FileNode[], path: string): FileNode | null {
	for (const n of nodes) {
		if (n.path === path) return n;
		if (n.isDir && n.children) {
			const f = findNode(n.children, path);
			if (f) return f;
		}
	}
	return null;
}

/** The names already taken in a directory, for rename and paste collisions. */
export function getSiblingNames(
	tree: FileNode[],
	parentPath: string,
): Set<string> {
	if (!parentPath) return new Set(tree.map((n) => n.name));
	return new Set(
		findNode(tree, parentPath)?.children?.map((n) => n.name) ?? [],
	);
}

/** Folds the `staged-*` variants into `staged`; null for anything unknown. */
export function normalizeGitStatus(status: string): GitStatus | null {
	if (status.startsWith("staged-")) return "staged";
	if (GIT_STATUS_PRIORITY.includes(status as GitStatus))
		return status as GitStatus;
	return null;
}

/**
 * A directory takes the most urgent status found below it, deletions excluded:
 * a folder whose files were deleted is not itself deleted, and marking it so
 * would flag half the tree after a large removal.
 */
export function nodeGitStatus(
	node: FileNode,
	gitStatusMap: GitStatusMap,
): GitStatus | null {
	if (!node.isDir) {
		const raw = gitStatusMap[node.path];
		return raw ? normalizeGitStatus(raw) : null;
	}
	return gitStatusIndex(gitStatusMap).get(node.path) ?? null;
}

/**
 * Directory to worst status below it, built in a single pass over the status
 * map and memoised on it. The tree calls this once per drawn directory on every
 * repaint, and a repaint follows every git poll: walking the whole map per node
 * made the cost the product of the two.
 */
let indexedMap: GitStatusMap | null = null;
let indexedResult: Map<string, GitStatus> = new Map();

export function gitStatusIndex(
	gitStatusMap: GitStatusMap,
): Map<string, GitStatus> {
	if (indexedMap === gitStatusMap) return indexedResult;
	const best = new Map<string, number>();
	for (const [path, status] of Object.entries(gitStatusMap)) {
		const normalized = normalizeGitStatus(status);
		if (!normalized || normalized === "deleted") continue;
		const idx = GIT_STATUS_PRIORITY.indexOf(normalized);
		let dir = parentPathOf(path);
		while (dir) {
			const current = best.get(dir);
			if (current !== undefined && current <= idx) break;
			best.set(dir, idx);
			dir = parentPathOf(dir);
		}
	}
	indexedResult = new Map(
		[...best].map(([dir, idx]) => [dir, GIT_STATUS_PRIORITY[idx]]),
	);
	indexedMap = gitStatusMap;
	return indexedResult;
}

/** Each segment with the path that leads to it, so a crumb can be clicked. */
export function breadcrumbSegments(
	path: string,
): { name: string; path: string }[] {
	const parts = path.split("/");
	return parts.map((name, i) => ({
		name,
		path: parts.slice(0, i + 1).join("/"),
	}));
}

/** Directories reflect their expanded state; files are typed by extension. */
export function fileIcon(node: FileNode, expanded: Set<string>): string {
	if (node.isDir) return expanded.has(node.path) ? "folder-open" : "folder";
	const ext = (node.name.split(".").pop() as string).toLowerCase();
	if (["ts", "tsx", "js", "jsx"].includes(ext)) return "file-code";
	if (["json", "yaml", "yml", "toml"].includes(ext)) return "file-code";
	return "file";
}

/** Free name for a paste: "x.ts", then "x copy.ts", then "x copy 2.ts". */
export function pasteDestName(
	srcName: string,
	existingNames: Set<string>,
): string {
	if (!existingNames.has(srcName)) return srcName;
	const dot = srcName.lastIndexOf(".");
	const [base, ext] =
		dot > 0 ? [srcName.slice(0, dot), srcName.slice(dot)] : [srcName, ""];
	let candidate = `${base} copy${ext}`;
	let i = 2;
	while (existingNames.has(candidate)) candidate = `${base} copy ${i++}${ext}`;
	return candidate;
}

/** Same, against the real destination - a move within a directory keeps its
 * own name rather than colliding with itself. */
export function resolveDestName(
	rawTree: FileNode[],
	srcPath: string,
	targetDir: string,
): string {
	const name = basename(srcPath);
	const srcDir = parentPathOf(srcPath);
	const siblings = targetDir
		? new Set(findNode(rawTree, targetDir)?.children?.map((n) => n.name) ?? [])
		: new Set(rawTree.map((n) => n.name));
	if (srcDir === targetDir) siblings.delete(name);
	return pasteDestName(name, siblings);
}

/** The containing directory, "" for a node at the root. */
export function parentPathOf(path: string): string {
	return path.includes("/") ? path.split("/").slice(0, -1).join("/") : "";
}

/** The last segment of a path. */
export function basename(path: string): string {
	return path.split("/").pop() as string;
}

/**
 * Tabs of files living inside the worktree are keyed by their relative path;
 * an absolute one belongs to a file opened from outside the project.
 */
export function isExternalPath(path: string): boolean {
	return path.startsWith("/");
}

/** A tab key back to a real path on disk. */
export function absolutePathOf(
	path: string,
	worktreePath: string | null,
): string {
	return isExternalPath(path) ? path : `${worktreePath}/${path}`;
}

/**
 * Whether an absolute path sits inside a directory. Compared on the separator
 * rather than as raw text, so `/repo/app` never swallows `/repo/app-legacy`.
 */
export function isUnder(path: string, directory: string | null): boolean {
	if (!directory) return false;
	return path === directory || path.startsWith(`${directory}/`);
}

/**
 * The path as the tabs key it: relative to the worktree when it lives inside
 * one, absolute when it comes from anywhere else.
 */
export function pathWithinWorktree(
	path: string,
	worktreePath: string | null,
): string {
	return worktreePath && path.startsWith(`${worktreePath}/`)
		? path.slice(worktreePath.length + 1)
		: path;
}
