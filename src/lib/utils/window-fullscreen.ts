// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { matchesShortcut } from "$lib/stores/shortcuts";
import { windowFullscreen } from "$lib/stores/ui";
import type { ShortcutBinding } from "$lib/types/shortcuts";

export async function toggleFullscreen(): Promise<void> {
	try {
		const { getCurrentWindow } = await import("@tauri-apps/api/window");
		const win = getCurrentWindow();
		const next = !(await win.isFullscreen());
		await win.setFullscreen(next);
		windowFullscreen.set(next);
	} catch {
		// Ignore in web preview or when the Tauri runtime is unavailable.
	}
}

export function onFullscreenKey(
	e: KeyboardEvent,
	binding: ShortcutBinding | null,
): void {
	if (!matchesShortcut(e, binding)) return;
	e.preventDefault();
	void toggleFullscreen();
}
