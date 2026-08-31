// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// App self-update. The only service backed by Tauri plugins rather than by our
// own Rust commands, so nothing here goes through invoke().

import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";

export type { Update };

/** Bytes so far; `total` stays null when the server sends no content length. */
export interface DownloadProgress {
	downloaded: number;
	total: number | null;
}

/** Null when already up to date; hits the network. */
export function checkForUpdate(): Promise<Update | null> {
	return check();
}

/**
 * Turns the plugin's event stream into a running byte count. The installed
 * update only takes effect on the next launch, so call `restartApp` after.
 */
export function downloadAndInstall(
	update: Update,
	onProgress: (progress: DownloadProgress) => void,
): Promise<void> {
	let downloaded = 0;
	let total: number | null = null;

	return update.downloadAndInstall((event) => {
		if (event.event === "Started") {
			total = event.data.contentLength ?? null;
		} else if (event.event === "Progress") {
			downloaded += event.data.chunkLength;
		} else {
			downloaded = total ?? downloaded;
		}
		onProgress({ downloaded, total });
	});
}

/** Relaunches the app; unsaved in-memory state is not flushed first. */
export function restartApp(): Promise<void> {
	return relaunch();
}
