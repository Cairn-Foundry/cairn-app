import type { Update } from "@tauri-apps/plugin-updater";
import { describe, expect, it, vi } from "vitest";
import { type DownloadProgress, downloadAndInstall } from "./update-service";

type ProgressEvent =
	| { event: "Started"; data: { contentLength?: number } }
	| { event: "Progress"; data: { chunkLength: number } }
	| { event: "Finished"; data: Record<string, never> };

/** An Update whose download replays the events a test hands it. */
function updateEmitting(events: ProgressEvent[]): Update {
	return {
		downloadAndInstall: vi.fn(async (onEvent: (e: ProgressEvent) => void) => {
			for (const event of events) onEvent(event);
		}),
	} as unknown as Update;
}

/** Every progress reading the service reported, in order. */
async function progressOf(
	events: ProgressEvent[],
): Promise<DownloadProgress[]> {
	const seen: DownloadProgress[] = [];
	await downloadAndInstall(updateEmitting(events), (p) => seen.push({ ...p }));
	return seen;
}

describe("downloadAndInstall", () => {
	it("reports the total as soon as the download starts", async () => {
		const seen = await progressOf([
			{ event: "Started", data: { contentLength: 1000 } },
		]);
		expect(seen).toEqual([{ downloaded: 0, total: 1000 }]);
	});

	it("accumulates the chunks rather than reporting each one", async () => {
		const seen = await progressOf([
			{ event: "Started", data: { contentLength: 100 } },
			{ event: "Progress", data: { chunkLength: 30 } },
			{ event: "Progress", data: { chunkLength: 20 } },
		]);
		expect(seen.map((p) => p.downloaded)).toEqual([0, 30, 50]);
	});

	it("finishes at the total, so a rounding gap never leaves the bar short", async () => {
		const seen = await progressOf([
			{ event: "Started", data: { contentLength: 100 } },
			{ event: "Progress", data: { chunkLength: 30 } },
			{ event: "Finished", data: {} },
		]);
		expect(seen.at(-1)).toEqual({ downloaded: 100, total: 100 });
	});

	it("keeps what was counted when the server never sent a length", async () => {
		const seen = await progressOf([
			{ event: "Started", data: {} },
			{ event: "Progress", data: { chunkLength: 42 } },
			{ event: "Finished", data: {} },
		]);
		expect(seen.at(-1)).toEqual({ downloaded: 42, total: null });
	});

	it("reports an unknown total as null rather than as zero", async () => {
		const seen = await progressOf([{ event: "Started", data: {} }]);
		expect(seen[0].total).toBeNull();
	});

	it("reports progress on every event, so the bar keeps moving", async () => {
		const seen = await progressOf([
			{ event: "Started", data: { contentLength: 10 } },
			{ event: "Progress", data: { chunkLength: 1 } },
			{ event: "Progress", data: { chunkLength: 1 } },
			{ event: "Finished", data: {} },
		]);
		expect(seen).toHaveLength(4);
	});

	it("handles an empty download that finishes at once", async () => {
		const seen = await progressOf([
			{ event: "Started", data: { contentLength: 0 } },
			{ event: "Finished", data: {} },
		]);
		expect(seen.at(-1)).toEqual({ downloaded: 0, total: 0 });
	});

	it("counts a zero-length chunk without advancing", async () => {
		const seen = await progressOf([
			{ event: "Started", data: { contentLength: 10 } },
			{ event: "Progress", data: { chunkLength: 0 } },
		]);
		expect(seen.at(-1)?.downloaded).toBe(0);
	});

	it("waits for the plugin before resolving", async () => {
		const update = updateEmitting([]);
		await downloadAndInstall(update, () => {});
		expect(update.downloadAndInstall).toHaveBeenCalledTimes(1);
	});

	it("lets a failed download reject rather than reporting success", async () => {
		const update = {
			downloadAndInstall: vi.fn().mockRejectedValue(new Error("network")),
		} as unknown as Update;
		await expect(downloadAndInstall(update, () => {})).rejects.toThrow(
			"network",
		);
	});
});
