import type { FileNode } from "$lib/services/file-service";
import { matchesShortcut } from "$lib/stores/shortcuts";
import type { ShortcutBinding, ShortcutId } from "$lib/types/shortcuts";
import {
	basename,
	flattenToNodes,
	flattenVisible,
	parentPathOf,
} from "./files-tree";

export interface FilesShortcutsContext {
	// ── Action getters/setters ─────────────────────────────────────────────
	getActiveShortcuts: () => Record<ShortcutId, ShortcutBinding | null>;
	isWorkspaceActive: () => boolean;
	isEditorFocused: () => boolean;
	// Panes & state
	getFocusedPane: () => 0 | 1;
	getSplitMode: () => boolean;
	getActiveTabIdxFor: (paneIdx: 0 | 1) => number;
	getTabsLengthFor: (paneIdx: 0 | 1) => number;
	// Tree & selection
	getTree: () => FileNode[];
	getExpanded: () => Set<string>;
	getMultiSelected: () => Set<string>;
	setMultiSelected: (next: Set<string>) => void;
	getSelectedDir: () => string;
	getWorktreePath: () => string | null;
	getFileClipboard: () => {
		nodes: FileNode[];
		srcWorktreePath: string;
		op: "copy" | "cut";
	} | null;
	setFileClipboard: (
		cb: {
			nodes: FileNode[];
			srcWorktreePath: string;
			op: "copy" | "cut";
		} | null,
	) => void;
	// Actions (provided by host)
	toggleSearchPanel: () => void;
	toggleSplit: () => void;
	toggleSidebar: () => void;
	bumpFontSize: (delta: number) => void;
	resetFontSize: () => void;
	openCommandPalette: () => void;
	openQuickOpen: () => void;
	openSettings: () => void;
	saveActivePane: (paneIdx: 0 | 1) => void;
	closeActiveTab: (paneIdx: 0 | 1) => void;
	reopenClosedTab: () => void;
	switchTab: (paneIdx: 0 | 1, idx: number) => void;
	tabHistoryBack: () => void;
	tabHistoryForward: () => void;
	pasteClipboard: (
		clipboard: {
			nodes: FileNode[];
			srcWorktreePath: string;
			op: "copy" | "cut";
		},
		targetNode: FileNode | null,
		wtp: string,
	) => Promise<void>;
	deleteAtPaths: (paths: string[]) => Promise<void>;
	startEdit: (state: {
		type: "rename" | "new-file" | "new-dir";
		node: FileNode | null;
		parentPath: string;
		value: string;
	}) => void;
	expandDir: (path: string) => void;
}

const IS_MAC =
	typeof navigator !== "undefined" && navigator.platform.startsWith("Mac");

export function makeFilesKeyHandler(ctx: FilesShortcutsContext) {
	return async function handleGlobalKey(e: KeyboardEvent) {
		if (!ctx.isWorkspaceActive()) return;
		const sc = ctx.getActiveShortcuts();
		const focusedPane = ctx.getFocusedPane();
		const splitMode = ctx.getSplitMode();
		const activePane: 0 | 1 = focusedPane === 1 && splitMode ? 1 : 0;

		if (matchesShortcut(e, sc.quickOpen)) {
			e.preventDefault();
			ctx.openQuickOpen();
		}
		if (matchesShortcut(e, sc.searchFiles)) {
			e.preventDefault();
			ctx.toggleSearchPanel();
		}
		if (matchesShortcut(e, sc.fontSizeUp)) {
			e.preventDefault();
			ctx.bumpFontSize(+1);
		}
		if (matchesShortcut(e, sc.fontSizeDown)) {
			e.preventDefault();
			ctx.bumpFontSize(-1);
		}
		if (matchesShortcut(e, sc.fontSizeReset)) {
			e.preventDefault();
			ctx.resetFontSize();
		}
		if (matchesShortcut(e, sc.splitEditor)) {
			e.preventDefault();
			ctx.toggleSplit();
		}

		// Tabs
		if (matchesShortcut(e, sc.closeTab)) {
			e.preventDefault();
			e.stopPropagation();
			ctx.closeActiveTab(activePane);
		}
		if (matchesShortcut(e, sc.reopenClosedTab)) {
			e.preventDefault();
			ctx.reopenClosedTab();
		}
		if (matchesShortcut(e, sc.nextTab)) {
			e.preventDefault();
			const len = ctx.getTabsLengthFor(0);
			if (len > 1) ctx.switchTab(0, (ctx.getActiveTabIdxFor(0) + 1) % len);
		}
		if (matchesShortcut(e, sc.prevTab)) {
			e.preventDefault();
			const len = ctx.getTabsLengthFor(0);
			if (len > 1)
				ctx.switchTab(0, (ctx.getActiveTabIdxFor(0) - 1 + len) % len);
		}
		if (matchesShortcut(e, sc.tabHistoryBack)) {
			e.preventDefault();
			ctx.tabHistoryBack();
		}
		if (matchesShortcut(e, sc.tabHistoryForward)) {
			e.preventDefault();
			ctx.tabHistoryForward();
		}

		// Jump to tab by number — ⌘1–⌘9, hardcoded (not user-configurable)
		if (
			(IS_MAC ? e.metaKey : e.ctrlKey) &&
			!e.shiftKey &&
			!e.altKey &&
			/^[1-9]$/.test(e.key)
		) {
			const idx = parseInt(e.key, 10) - 1;
			if (idx < ctx.getTabsLengthFor(0)) {
				e.preventDefault();
				ctx.switchTab(0, idx);
			}
		}

		// Editing
		if (matchesShortcut(e, sc.saveFile)) {
			e.preventDefault();
			ctx.saveActivePane(activePane);
		}

		// View
		if (matchesShortcut(e, sc.toggleSidebar)) {
			e.preventDefault();
			ctx.toggleSidebar();
		}
		if (matchesShortcut(e, sc.commandPalette)) {
			e.preventDefault();
			ctx.openCommandPalette();
		}
		if (matchesShortcut(e, sc.openSettings)) {
			e.preventDefault();
			ctx.openSettings();
		}

		// Tree shortcuts (only when no editor/input has focus)
		if (ctx.isEditorFocused()) return;

		const tree = ctx.getTree();
		const expanded = ctx.getExpanded();
		const multiSelected = ctx.getMultiSelected();
		const wtp = ctx.getWorktreePath();
		const fileClipboard = ctx.getFileClipboard();

		if (matchesShortcut(e, sc.treeSelectAll)) {
			e.preventDefault();
			ctx.setMultiSelected(
				new Set(flattenVisible(tree, expanded).map((n) => n.path)),
			);
		}
		if (matchesShortcut(e, sc.treeCopy) && multiSelected.size > 0 && wtp) {
			e.preventDefault();
			ctx.setFileClipboard({
				nodes: flattenToNodes(tree, multiSelected),
				srcWorktreePath: wtp,
				op: "copy",
			});
		}
		if (matchesShortcut(e, sc.treeCut) && multiSelected.size > 0 && wtp) {
			e.preventDefault();
			ctx.setFileClipboard({
				nodes: flattenToNodes(tree, multiSelected),
				srcWorktreePath: wtp,
				op: "cut",
			});
		}
		if (matchesShortcut(e, sc.treePaste) && fileClipboard && wtp) {
			e.preventDefault();
			const targetPath = [...multiSelected][0] ?? null;
			const targetNode = targetPath
				? (flattenVisible(tree, expanded).find((n) => n.path === targetPath) ??
					null)
				: null;
			await ctx.pasteClipboard(fileClipboard, targetNode, wtp);
		}
		if (matchesShortcut(e, sc.treeDelete) && multiSelected.size > 0 && wtp) {
			e.preventDefault();
			const paths = [...multiSelected];
			const label =
				paths.length === 1
					? `"${basename(paths[0])}"`
					: `${paths.length} items`;
			if (!confirm(`Delete ${label}?`)) return;
			await ctx.deleteAtPaths(paths);
		}
		if (matchesShortcut(e, sc.treeRename) && multiSelected.size === 1) {
			e.preventDefault();
			const path = [...multiSelected][0];
			const node = flattenVisible(tree, expanded).find((n) => n.path === path);
			if (node)
				ctx.startEdit({
					type: "rename",
					node,
					parentPath: parentPathOf(node.path),
					value: node.name,
				});
		}
		if (matchesShortcut(e, sc.treeNewFile)) {
			e.preventDefault();
			const parentPath =
				[...multiSelected].find((p) => {
					const n = flattenVisible(tree, expanded).find((x) => x.path === p);
					return n?.isDir;
				}) ?? ctx.getSelectedDir();
			if (parentPath) ctx.expandDir(parentPath);
			ctx.startEdit({ type: "new-file", node: null, parentPath, value: "" });
		}
		if (matchesShortcut(e, sc.treeNewFolder)) {
			e.preventDefault();
			const parentPath =
				[...multiSelected].find((p) => {
					const n = flattenVisible(tree, expanded).find((x) => x.path === p);
					return n?.isDir;
				}) ?? ctx.getSelectedDir();
			if (parentPath) ctx.expandDir(parentPath);
			ctx.startEdit({ type: "new-dir", node: null, parentPath, value: "" });
		}
	};
}
