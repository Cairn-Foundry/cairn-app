import { derived } from "svelte/store";
import { t } from "$lib/i18n";
import { settings } from "$lib/stores/settings";
import type {
	ShortcutBinding,
	ShortcutDef,
	ShortcutId,
} from "$lib/types/shortcuts";
import { IS_MAC } from "$lib/utils/platform";

const d = (id: ShortcutId) => ({
	label: t(`shortcuts.defs.${id}.label`) as string,
	description: t(`shortcuts.defs.${id}.description`) as string,
});

export const SHORTCUT_DEFS: ShortcutDef[] = [
	// -- Files group ------------------------------------------------------------
	{
		id: "quickOpen",
		...d("quickOpen"),
		group: "files",
		default: { key: "p", mod: true, shift: false, alt: false, ctrl: false },
	},
	{
		id: "searchFiles",
		...d("searchFiles"),
		group: "files",
		default: { key: "f", mod: true, shift: true, alt: false, ctrl: false },
	},
	{
		id: "splitEditor",
		...d("splitEditor"),
		group: "files",
		default: { key: "\\", mod: true, shift: false, alt: false, ctrl: false },
	},
	{
		id: "fontSizeUp",
		...d("fontSizeUp"),
		group: "files",
		default: { key: "=", mod: true, shift: false, alt: false, ctrl: false },
	},
	{
		id: "fontSizeDown",
		...d("fontSizeDown"),
		group: "files",
		default: { key: "-", mod: true, shift: false, alt: false, ctrl: false },
	},
	{
		id: "fontSizeReset",
		...d("fontSizeReset"),
		group: "files",
		default: { key: "0", mod: true, shift: false, alt: false, ctrl: false },
	},
	// -- Editor group -----------------------------------------------------------
	{
		id: "toggleLineComment",
		...d("toggleLineComment"),
		group: "editor",
		default: { key: "/", mod: true, shift: false, alt: false, ctrl: false },
	},
	{
		id: "toggleBlockComment",
		...d("toggleBlockComment"),
		group: "editor",
		default: { key: "a", mod: false, shift: true, alt: true, ctrl: false },
	},
	{
		id: "moveLineUp",
		...d("moveLineUp"),
		group: "editor",
		default: {
			key: "ArrowUp",
			mod: false,
			shift: false,
			alt: true,
			ctrl: false,
		},
	},
	{
		id: "moveLineDown",
		...d("moveLineDown"),
		group: "editor",
		default: {
			key: "ArrowDown",
			mod: false,
			shift: false,
			alt: true,
			ctrl: false,
		},
	},
	{
		id: "copyLineDown",
		...d("copyLineDown"),
		group: "editor",
		default: {
			key: "ArrowDown",
			mod: false,
			shift: true,
			alt: true,
			ctrl: false,
		},
	},
	{
		id: "deleteLine",
		...d("deleteLine"),
		group: "editor",
		default: { key: "k", mod: true, shift: true, alt: false, ctrl: false },
	},
	{
		id: "selectLine",
		...d("selectLine"),
		group: "editor",
		default: { key: "l", mod: true, shift: false, alt: false, ctrl: false },
	},
	{
		id: "matchingBracket",
		...d("matchingBracket"),
		group: "editor",
		default: { key: "m", mod: false, shift: false, alt: false, ctrl: true },
	},
	{
		id: "indentMore",
		...d("indentMore"),
		group: "editor",
		default: { key: "]", mod: true, shift: false, alt: false, ctrl: false },
	},
	{
		id: "indentLess",
		...d("indentLess"),
		group: "editor",
		default: { key: "[", mod: true, shift: false, alt: false, ctrl: false },
	},
	{
		id: "expandSelection",
		...d("expandSelection"),
		group: "editor",
		default: {
			key: "ArrowRight",
			mod: false,
			shift: true,
			alt: true,
			ctrl: false,
		},
	},
	{
		id: "goToLine",
		...d("goToLine"),
		group: "editor",
		default: { key: "g", mod: false, shift: false, alt: false, ctrl: true },
	},
	{
		id: "addCursorAbove",
		...d("addCursorAbove"),
		group: "editor",
		default: {
			key: "ArrowUp",
			mod: true,
			shift: false,
			alt: true,
			ctrl: false,
		},
	},
	{
		id: "addCursorBelow",
		...d("addCursorBelow"),
		group: "editor",
		default: {
			key: "ArrowDown",
			mod: true,
			shift: false,
			alt: true,
			ctrl: false,
		},
	},
	{
		id: "saveFile",
		...d("saveFile"),
		group: "editor",
		default: { key: "s", mod: true, shift: false, alt: false, ctrl: false },
	},
	{
		id: "duplicateLine",
		...d("duplicateLine"),
		group: "editor",
		default: { key: "d", mod: true, shift: true, alt: false, ctrl: false },
	},
	// -- Tabs group -------------------------------------------------------------
	{
		id: "closeTab",
		...d("closeTab"),
		group: "tabs",
		default: { key: "w", mod: true, shift: false, alt: false, ctrl: false },
	},
	{
		id: "reopenClosedTab",
		...d("reopenClosedTab"),
		group: "tabs",
		default: { key: "t", mod: true, shift: true, alt: false, ctrl: false },
	},
	{
		id: "nextTab",
		...d("nextTab"),
		group: "tabs",
		default: { key: "Tab", mod: false, shift: false, alt: false, ctrl: true },
	},
	{
		id: "prevTab",
		...d("prevTab"),
		group: "tabs",
		default: { key: "Tab", mod: false, shift: true, alt: false, ctrl: true },
	},
	{
		id: "tabHistoryBack",
		...d("tabHistoryBack"),
		group: "tabs",
		default: {
			key: "ArrowLeft",
			mod: true,
			shift: false,
			alt: true,
			ctrl: false,
		},
	},
	{
		id: "tabHistoryForward",
		...d("tabHistoryForward"),
		group: "tabs",
		default: {
			key: "ArrowRight",
			mod: true,
			shift: false,
			alt: true,
			ctrl: false,
		},
	},
	// -- View group -------------------------------------------------------------
	{
		id: "toggleSidebar",
		...d("toggleSidebar"),
		group: "view",
		default: { key: "b", mod: true, shift: false, alt: false, ctrl: false },
	},
	{
		id: "commandPalette",
		...d("commandPalette"),
		group: "view",
		default: { key: "p", mod: true, shift: true, alt: false, ctrl: false },
	},
	{
		id: "openSettings",
		...d("openSettings"),
		group: "view",
		default: { key: ",", mod: true, shift: false, alt: false, ctrl: false },
	},
	// -- File tree group --------------------------------------------------------
	{
		id: "treeSelectAll",
		...d("treeSelectAll"),
		group: "tree",
		default: { key: "a", mod: true, shift: false, alt: false, ctrl: false },
	},
	{
		id: "treeCopy",
		...d("treeCopy"),
		group: "tree",
		default: { key: "c", mod: true, shift: false, alt: false, ctrl: false },
	},
	{
		id: "treeCut",
		...d("treeCut"),
		group: "tree",
		default: { key: "x", mod: true, shift: false, alt: false, ctrl: false },
	},
	{
		id: "treePaste",
		...d("treePaste"),
		group: "tree",
		default: { key: "v", mod: true, shift: false, alt: false, ctrl: false },
	},
	{
		id: "treeDelete",
		...d("treeDelete"),
		group: "tree",
		default: {
			key: "Backspace",
			mod: true,
			shift: false,
			alt: false,
			ctrl: false,
		},
	},
	{
		id: "treeRename",
		...d("treeRename"),
		group: "tree",
		default: {
			key: "Enter",
			mod: false,
			shift: false,
			alt: false,
			ctrl: false,
		},
	},
	{
		id: "treeNewFile",
		...d("treeNewFile"),
		group: "tree",
		default: { key: "n", mod: true, shift: false, alt: false, ctrl: false },
	},
	{
		id: "treeNewFolder",
		...d("treeNewFolder"),
		group: "tree",
		default: { key: "n", mod: true, shift: true, alt: false, ctrl: false },
	},
];

export const SHORTCUT_GROUP_LABELS: Record<string, string> = {
	files: t("shortcuts.groups.files") as string,
	editor: t("shortcuts.groups.editor") as string,
	tabs: t("shortcuts.groups.tabs") as string,
	view: t("shortcuts.groups.view") as string,
	tree: t("shortcuts.groups.tree") as string,
};

export const shortcuts = derived(settings, ($s) => {
	const configMap = new Map(($s.shortcuts ?? []).map((c) => [c.id, c]));
	const result = {} as Record<ShortcutId, ShortcutBinding>;
	for (const def of SHORTCUT_DEFS) {
		result[def.id] = configMap.get(def.id)?.binding ?? { ...def.default };
	}
	return result;
});

export const activeShortcuts = derived(settings, ($s) => {
	const configMap = new Map(($s.shortcuts ?? []).map((c) => [c.id, c]));
	const result = {} as Record<ShortcutId, ShortcutBinding | null>;
	for (const def of SHORTCUT_DEFS) {
		const config = configMap.get(def.id);
		result[def.id] =
			config && !config.enabled
				? null
				: (config?.binding ?? { ...def.default });
	}
	return result;
});

export function matchesShortcut(
	e: KeyboardEvent,
	b: ShortcutBinding | null,
): boolean {
	if (!b) return false;
	if (e.key.toLowerCase() !== b.key.toLowerCase()) return false;
	if (e.shiftKey !== b.shift || e.altKey !== b.alt) return false;
	if (IS_MAC) {
		return e.metaKey === b.mod && e.ctrlKey === b.ctrl;
	}
	
	return e.ctrlKey === (b.mod || b.ctrl);
}

export function toCmKey(b: ShortcutBinding): string {
	const parts: string[] = [];
	if (b.mod) parts.push("Mod");
	if (b.ctrl) parts.push("Ctrl");
	if (b.shift) parts.push("Shift");
	if (b.alt) parts.push("Alt");
	parts.push(b.key);
	return parts.join("-");
}

const KEY_LABELS: Record<string, string> = {
	ArrowUp: "↑",
	ArrowDown: "↓",
	ArrowLeft: "←",
	ArrowRight: "→",
	Escape: "Esc",
	Backspace: "⌫",
	Delete: "Del",
	Enter: "↩",
	Tab: "⇥",
	" ": "Space",
};

export function bindingToLabels(b: ShortcutBinding, mac = IS_MAC): string[] {
	const labels: string[] = [];
	if (b.mod) labels.push(mac ? "⌘" : "Ctrl");
	if (b.ctrl && !b.mod) labels.push("Ctrl");
	if (b.shift) labels.push("⇧");
	if (b.alt) labels.push(mac ? "⌥" : "Alt");
	labels.push(KEY_LABELS[b.key] ?? b.key.toUpperCase());
	return labels;
}

export function bindingKey(b: ShortcutBinding): string {
	return `${b.mod ? 1 : 0}${b.shift ? 1 : 0}${b.alt ? 1 : 0}${b.ctrl ? 1 : 0}:${b.key.toLowerCase()}`;
}
