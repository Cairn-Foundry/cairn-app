// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `bun run dev:preview` serves the app to a plain browser: the Tauri IPC is
 * replaced by the in-memory back end before anything calls `invoke()`. The flag
 * is a build-time constant, so every other build drops the import.
 */
export async function init(): Promise<void> {
	if (import.meta.env.VITE_PREVIEW_BACKEND !== "1") return;
	const { installPreviewBackend } = await import("#lib/dev/preview-backend");
	installPreviewBackend();
}
