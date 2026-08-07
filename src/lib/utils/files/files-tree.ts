import type { FileNode, GitStatusMap } from "$lib/services/file-service";

export const GIT_STATUS_PRIORITY = [
	"conflicted",
	"staged",
	"modified",
	"deleted",
	"untracked",
] as const;
export type GitStatus = (typeof GIT_STATUS_PRIORITY)[number];

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

export function getSiblingNames(
	tree: FileNode[],
	parentPath: string,
): Set<string> {
	if (!parentPath) return new Set(tree.map((n) => n.name));
	return new Set(
		findNode(tree, parentPath)?.children?.map((n) => n.name) ?? [],
	);
}

export function normalizeGitStatus(status: string): GitStatus | null {
	if (status.startsWith("staged-")) return "staged";
	if (GIT_STATUS_PRIORITY.includes(status as GitStatus))
		return status as GitStatus;
	return null;
}

export function nodeGitStatus(
	node: FileNode,
	gitStatusMap: GitStatusMap,
): GitStatus | null {
	if (!node.isDir) {
		const raw = gitStatusMap[node.path];
		return raw ? normalizeGitStatus(raw) : null;
	}
	const prefix = `${node.path}/`;
	let best: number = GIT_STATUS_PRIORITY.length;
	for (const [path, status] of Object.entries(gitStatusMap)) {
		const normalized = normalizeGitStatus(status);
		if (path.startsWith(prefix) && normalized && normalized !== "deleted") {
			const idx = GIT_STATUS_PRIORITY.indexOf(normalized);
			if (idx !== -1 && idx < best) best = idx;
		}
	}
	return best < GIT_STATUS_PRIORITY.length ? GIT_STATUS_PRIORITY[best] : null;
}

export function breadcrumbSegments(
	path: string,
): { name: string; path: string }[] {
	const parts = path.split("/");
	return parts.map((name, i) => ({
		name,
		path: parts.slice(0, i + 1).join("/"),
	}));
}

export function fileIcon(node: FileNode, expanded: Set<string>): string {
	if (node.isDir) return expanded.has(node.path) ? "folder-open" : "folder";
	const ext = node.name.split(".").pop()?.toLowerCase() ?? "";
	if (["ts", "tsx", "js", "jsx"].includes(ext)) return "file-code";
	if (["json", "yaml", "yml", "toml"].includes(ext)) return "file-code";
	return "file";
}

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

export function parentPathOf(path: string): string {
	return path.includes("/") ? path.split("/").slice(0, -1).join("/") : "";
}

export function basename(path: string): string {
	return path.split("/").pop() ?? path;
}

/**
 * Tabs of files living inside the worktree are keyed by their relative path;
 * an absolute one belongs to a file opened from outside the project.
 */
export function isExternalPath(path: string): boolean {
	return path.startsWith("/");
}

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
