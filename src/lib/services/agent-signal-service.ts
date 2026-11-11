// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type AgentSignal = "working" | "waiting" | "done";

export function onAgentSignal(
	handler: (conversationId: string, signal: AgentSignal) => void,
): Promise<UnlistenFn> {
	return listen<{ conversationId: string; signal: AgentSignal }>(
		"agent-signal",
		(e) => handler(e.payload.conversationId, e.payload.signal),
	);
}

export function onNotificationOpened(
	handler: (conversationId: string) => void,
): Promise<UnlistenFn> {
	return listen<{ conversationId: string }>("agent-notification-opened", (e) =>
		handler(e.payload.conversationId),
	);
}

/** Reports the current focus first, then every change. */
export async function watchWindowFocus(
	handler: (isFocused: boolean) => void,
): Promise<UnlistenFn> {
	const { getCurrentWindow } = await import("@tauri-apps/api/window");
	const win = getCurrentWindow();
	const unlisten = await win.onFocusChanged(({ payload }) => handler(payload));
	handler(await win.isFocused());
	return unlisten;
}
