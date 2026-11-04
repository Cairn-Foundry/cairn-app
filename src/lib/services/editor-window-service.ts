// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Detached editor windows: creating them, moving tabs between windows, and the
// registry of which window holds which file. Only this layer calls invoke().

import { invoke } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { TabPayload } from "#lib/utils/files/tab-transfer";

export const MAIN_WINDOW = "main";

/** Mirrors the Rust `WindowAtCursor`; `supported` is false on Wayland. */
export interface WindowAtCursor {
	supported: boolean;
	cursor: [number, number] | null;
	label: string | null;
}

/** One file a window holds, as the registry keys it: by absolute path. */
export interface OpenFile {
	path: string;
	isDirty: boolean;
}

export interface WindowFile {
	label: string;
	path: string;
}

export interface TabsReceived {
	tabs: TabPayload[];
	from: string;
}

export function currentWindowLabel(): string {
	return getCurrentWebviewWindow().label;
}

export function editorWindowAtCursor(): Promise<WindowAtCursor> {
	return invoke<WindowAtCursor>("editor_window_at_cursor");
}

/** Opens a detached window on these tabs; `x`/`y` are logical screen coordinates. */
export function openEditorWindow(
	tabs: TabPayload[],
	x: number | null = null,
	y: number | null = null,
): Promise<string> {
	return invoke<string>("editor_window_open", { tabs, x, y });
}

export function takeWindowTabs(): Promise<TabPayload[]> {
	return invoke<TabPayload[]>("editor_window_take_tabs");
}

export function transferTabs(
	target: string,
	tabs: TabPayload[],
): Promise<void> {
	return invoke("editor_window_transfer", { target, tabs });
}

export function syncWindowFiles(files: OpenFile[]): Promise<void> {
	return invoke("editor_window_sync", { files });
}

/** The window already holding a file, brought to the front; null when the caller may open it. */
export function focusFileOwner(path: string): Promise<string | null> {
	return invoke<string | null>("editor_window_focus_owner", { path });
}

/** Unsaved buffers of every window but the caller. */
export function otherWindowsDirty(): Promise<WindowFile[]> {
	return invoke<WindowFile[]>("editor_windows_dirty");
}

export function saveAllOtherWindows(): Promise<void> {
	return invoke("editor_windows_save_all");
}

export function closeAllEditorWindows(): Promise<void> {
	return invoke("editor_windows_close_all");
}

/**
 * Linux only: hands the drag over to GTK; the result arrives as `editor-drag-end`.
 * Target windows see the drop as the path `cairn-tab:<token>`.
 */
export function startNativeDrag(token: string): Promise<void> {
	return invoke("editor_drag_start", { token });
}

export function beginNativeDrag(token: string, tab: TabPayload): Promise<void> {
	return invoke("editor_drag_begin", { token, tab });
}

/** Takes the tab a `cairn-tab:` drop carries; null when it is not ours to take. */
export function claimNativeDrag(token: string): Promise<TabPayload | null> {
	return invoke<TabPayload | null>("editor_drag_claim", { token });
}

/** Ends a native drag: true when another window took the tab. */
export function finishNativeDrag(token: string): Promise<boolean> {
	return invoke<boolean>("editor_drag_finish", { token });
}

export async function onTabsReceived(
	handler: (payload: TabsReceived) => void,
): Promise<UnlistenFn> {
	return getCurrentWebviewWindow().listen<TabsReceived>(
		"editor-tabs-received",
		(e) => handler(e.payload),
	);
}

export async function onRevealFile(
	handler: (path: string) => void,
): Promise<UnlistenFn> {
	return getCurrentWebviewWindow().listen<string>("editor-reveal-file", (e) =>
		handler(e.payload),
	);
}

export async function onSaveAll(handler: () => void): Promise<UnlistenFn> {
	return getCurrentWebviewWindow().listen("editor-save-all", () => handler());
}

export interface NativeDragEnd {
	isDropped: boolean;
	isCancelled: boolean;
}

export async function onNativeDragEnd(
	handler: (end: NativeDragEnd) => void,
): Promise<UnlistenFn> {
	return getCurrentWebviewWindow().listen<NativeDragEnd>(
		"editor-drag-end",
		(e) => handler(e.payload),
	);
}
