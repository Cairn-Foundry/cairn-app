// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getChannel = vi.hoisted(() => vi.fn());
vi.mock("#lib/services/settings-service", () => ({ getChannel }));

const RELEASE = { label: null, dir: "", displayDir: "~/.cairn" };

/** Subscribes, lets the read settle, and returns what the store holds. */
async function settled() {
	const { channel } = await import("./channel");
	let value: unknown;
	const stop = channel.subscribe((v) => {
		value = v;
	});
	await Promise.resolve();
	await Promise.resolve();
	stop();
	return value;
}

beforeEach(() => {
	vi.resetModules();
	getChannel.mockReset();
});

describe("channel", () => {
	it("starts on the release default before the read lands", async () => {
		getChannel.mockReturnValue(new Promise(() => {}));
		const { channel } = await import("./channel");
		expect(get(channel)).toEqual(RELEASE);
	});

	it("takes the channel the backend reports", async () => {
		const info = {
			label: "beta",
			dir: "/home/u/.cairn-beta",
			displayDir: "~/.cairn-beta",
		};
		getChannel.mockResolvedValue(info);
		await expect(settled()).resolves.toEqual(info);
	});

	it("keeps the release default when the answer has no display directory", async () => {
		getChannel.mockResolvedValue({ label: "dev", dir: "/x", displayDir: "" });
		await expect(settled()).resolves.toEqual(RELEASE);
	});

	it("keeps the release default when the answer is empty", async () => {
		getChannel.mockResolvedValue(undefined);
		await expect(settled()).resolves.toEqual(RELEASE);
	});

	it("keeps the release default when the read fails", async () => {
		getChannel.mockRejectedValue(new Error("no backend"));
		await expect(settled()).resolves.toEqual(RELEASE);
	});
});
