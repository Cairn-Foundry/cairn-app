import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";

export type { Update };

export interface DownloadProgress {
	downloaded: number;
	total: number | null;
}

export function checkForUpdate(): Promise<Update | null> {
	return check();
}

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

export function restartApp(): Promise<void> {
	return relaunch();
}
