// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
	beginNativeDrag,
	claimNativeDrag,
	currentWindowLabel,
	editorWindowAtCursor,
	finishNativeDrag,
	type NativeDragEnd,
	onNativeDragEnd,
	openEditorWindow,
	startNativeDrag,
	transferTabs,
} from "#lib/services/editor-window-service";
import { type TabPayload, tokenFromDroppedPath } from "./tab-transfer";

// A tab dragged out of its window. The editor's own tab drag runs on pointer
// events, and the source keeps receiving the pointer outside its bounds while
// the button is held: on release, the backend says which window is under the
// cursor, and the tab either moves there or opens a window of its own.
//
// Wayland says nothing about where windows are, so there the drag is handed to
// GTK as soon as it leaves the window, and the window it lands on claims it.

/** How long the source waits, after GTK ended the drag, for a window to claim it. */
const CLAIM_GRACE_MS = 400;
/** A native drag that never reports its end is given up on after this. */
const NATIVE_DRAG_TIMEOUT_MS = 120_000;

export type TabDropOutcome =
	/** The tab left this window: another one holds it now. */
	| "moved"
	/** Released over its own window, or cancelled: the caller carries on as usual. */
	| "stayed";

let isNativeMode: Promise<boolean> | null = null;
/** The native drag this window started, and whether it came back to land on it. */
let ownToken: string | null = null;
let isOwnTokenDropped = false;

/** Whether tabs leave a window through a native drag (Wayland) rather than a hit-test. */
export function usesNativeDrag(): Promise<boolean> {
	isNativeMode ??= editorWindowAtCursor().then(
		(hit) => hit?.supported === false,
		() => false,
	);
	return isNativeMode;
}

export function isOutsideViewport(e: PointerEvent): boolean {
	return (
		e.clientX < 0 ||
		e.clientY < 0 ||
		e.clientX >= window.innerWidth ||
		e.clientY >= window.innerHeight
	);
}

/**
 * The pointer was released outside the viewport: the tab goes to the window
 * under the cursor, or to a new window opened where it was dropped.
 */
export async function dropTabOutside(
	payload: TabPayload,
	e: PointerEvent,
): Promise<TabDropOutcome> {
	const hit = await editorWindowAtCursor();
	if (!hit.supported) return "stayed";
	if (hit.label === currentWindowLabel()) return "stayed";
	if (hit.label) {
		await transferTabs(hit.label, [payload]);
		return "moved";
	}
	await openEditorWindow([payload], e.screenX, e.screenY);
	return "moved";
}

function waitForNativeDragEnd(): Promise<NativeDragEnd | null> {
	return new Promise((resolve) => {
		let settled = false;
		let unlisten: (() => void) | null = null;
		const settle = (end: NativeDragEnd | null) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			unlisten?.();
			resolve(end);
		};
		const timer = setTimeout(() => settle(null), NATIVE_DRAG_TIMEOUT_MS);
		void onNativeDragEnd(settle).then((off) => {
			if (settled) off();
			else unlisten = off;
		});
	});
}

/**
 * Hands the drag to GTK (Wayland). A Cairn window claims the tab when it is
 * dropped there; anywhere else opens a new window, and Escape leaves it put.
 */
export async function dragTabNatively(
	payload: TabPayload,
): Promise<TabDropOutcome> {
	const token = `${currentWindowLabel()}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	ownToken = token;
	isOwnTokenDropped = false;
	await beginNativeDrag(token, payload);
	const ended = waitForNativeDragEnd();
	try {
		await startNativeDrag(token);
	} catch {
		await finishNativeDrag(token);
		return "stayed";
	}
	const end = await ended;
	await new Promise((r) => setTimeout(r, CLAIM_GRACE_MS));
	const isClaimed = await finishNativeDrag(token);
	const isBackHome = isOwnTokenDropped;
	ownToken = null;
	if (isClaimed) return "moved";
	if (!end || end.isCancelled || isBackHome) return "stayed";
	await openEditorWindow([payload]);
	return "moved";
}

/** The tabs a native drop carried, among the dropped paths; plain files are left to the caller. */
export async function claimDroppedTabs(
	paths: string[],
): Promise<{ tabs: TabPayload[]; files: string[] }> {
	const tabs: TabPayload[] = [];
	const files: string[] = [];
	for (const path of paths) {
		const token = tokenFromDroppedPath(path);
		if (token === null) {
			files.push(path);
			continue;
		}
		if (token === ownToken) {
			isOwnTokenDropped = true;
			continue;
		}
		const tab = await claimNativeDrag(token).catch(() => null);
		if (tab) tabs.push(tab);
	}
	return { tabs, files };
}
