import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { IS_MAC } from "$lib/utils/platform";

// The webview does not copy a plain text selection outside an input on its own,
// so Cairn intercepts the copy shortcut and writes it to the clipboard itself.

/** Inputs and contenteditable copy on their own; they must not be intercepted. */
function isEditableTarget(target: EventTarget | null): boolean {
	const el = target as HTMLElement | null;
	if (!el) return false;
	if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return true;
	return el.isContentEditable;
}

/** Cmd/Ctrl+C with no other modifier, on a selection the webview would drop. */
function handleCopyKey(e: KeyboardEvent): void {
	const mod = IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey;
	if (!mod || e.shiftKey || e.altKey || e.key.toLowerCase() !== "c") return;

	if (isEditableTarget(document.activeElement)) return;

	const selection = window.getSelection()?.toString() ?? "";
	if (!selection) return;

	e.preventDefault();
	void writeText(selection);
}

/** Installs the global handler and returns its teardown. */
export function installCopySelectionHandler(): () => void {
	window.addEventListener("keydown", handleCopyKey);
	return () => window.removeEventListener("keydown", handleCopyKey);
}
