// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Desktop notifications. The plugin only answers the permission questions:
// sending goes through `notify_agent` (see `agent_signals.rs` for why).

import { invoke } from "@tauri-apps/api/core";
import {
	isPermissionGranted,
	requestPermission,
} from "@tauri-apps/plugin-notification";

let permission: Promise<boolean> | null = null;

/** Asked once per session: a refusal is not asked again on every turn. */
function allowed(): Promise<boolean> {
	permission ??= (async () => {
		if (await isPermissionGranted()) return true;
		return (await requestPermission()) === "granted";
	})().catch(() => false);
	return permission;
}

/** A click on it emits `agent-notification-opened` with the conversation id. */
export async function notifyConversation(
	conversationId: string,
	title: string,
	body: string,
): Promise<void> {
	if (!(await allowed())) return;
	await invoke("notify_agent", { conversationId, title, body });
}
