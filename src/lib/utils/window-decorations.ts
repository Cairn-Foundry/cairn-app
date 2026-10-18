// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

let queue: Promise<void> = Promise.resolve();

async function switchDecorations(native: boolean): Promise<void> {
	try {
		const { getCurrentWindow } = await import("@tauri-apps/api/window");
		const win = getCurrentWindow();
		if ((await win.isDecorated()) === native) return;
		const maximized = await win.isMaximized();
		await win.hide();
		try {
			await win.setDecorations(native);
		} finally {
			await win.show();
		}
		if (maximized) await win.maximize();
	} catch {
		// Ignore in web preview or when the Tauri runtime is unavailable.
	}
}

/**
 * Compared with the window itself, which Rust already built with the saved
 * setting. Mutter only reads decorations when a window is mapped, hence the
 * hide and show; switches run one at a time, so a second one never reads the
 * window halfway through the first.
 */
export function setWindowDecorations(native: boolean): Promise<void> {
	queue = queue.then(() => switchDecorations(native));
	return queue;
}
