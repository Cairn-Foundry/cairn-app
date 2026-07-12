import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { IS_MAC } from "$lib/utils/platform";

function isEditableTarget(target: EventTarget | null): boolean {
	const el = target as HTMLElement | null;
	if (!el) return false;
	if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return true;
	return el.isContentEditable;
}

function handleCopyKey(e: KeyboardEvent): void {
	const mod = IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey;
	if (!mod || e.shiftKey || e.altKey || e.key.toLowerCase() !== "c") return;

	if (isEditableTarget(document.activeElement)) return;

	const selection = window.getSelection()?.toString() ?? "";
	if (!selection) return;

	e.preventDefault();
	void writeText(selection);
}

export function installCopySelectionHandler(): () => void {
	window.addEventListener("keydown", handleCopyKey);
	return () => window.removeEventListener("keydown", handleCopyKey);
}
