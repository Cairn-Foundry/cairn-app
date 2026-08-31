// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const checkForUpdate = vi.hoisted(() => vi.fn());
const downloadAndInstall = vi.hoisted(() => vi.fn());
const restartApp = vi.hoisted(() => vi.fn());
vi.mock("$lib/services/update-service", () => ({
	checkForUpdate,
	downloadAndInstall,
	restartApp,
}));

const getSettings = vi.hoisted(() => vi.fn());
const updateSettings = vi.hoisted(() => vi.fn());
vi.mock("$lib/services/settings-service", () => ({
	getSettings,
	updateSettings,
}));

import { settings } from "./settings";
import {
	CHECK_INTERVAL_MS,
	checkForUpdates,
	closeUpdateModal,
	hasPendingUpdate,
	installUpdate,
	isUpdateModalOpen,
	openUpdateModal,
	STARTUP_CHECK_DELAY_MS,
	startUpdateChecks,
	updateState,
} from "./update";

/** An Update handle as the plugin hands it over. */
const release = (version = "1.2.0", body = "notes") => ({
	version,
	body,
	close: vi.fn().mockResolvedValue(undefined),
});

const phase = () => get(updateState).phase;

beforeEach(async () => {
	vi.clearAllMocks();
	checkForUpdate.mockResolvedValue(null);
	downloadAndInstall.mockResolvedValue(undefined);
	restartApp.mockResolvedValue(undefined);
	updateSettings.mockImplementation(async (s) => s);
	getSettings.mockResolvedValue({ autoCheckUpdates: false });
	await settings.load();
	// Leave the store idle: a check with nothing found resets it.
	await checkForUpdates({ silent: true });
	vi.clearAllMocks();
	checkForUpdate.mockResolvedValue(null);
	closeUpdateModal();
});

describe("checkForUpdates", () => {
	it("stays idle when there is no release", async () => {
		await checkForUpdates();
		expect(phase()).toBe("idle");
		expect(get(updateState).version).toBeNull();
	});

	it("records when it last looked, even finding nothing", async () => {
		await checkForUpdates();
		expect(get(updateState).lastCheckedAt).toBeTypeOf("number");
	});

	it("reports the release it found", async () => {
		checkForUpdate.mockResolvedValue(release("2.0.0", "what is new"));
		await checkForUpdates();
		expect(get(updateState)).toMatchObject({
			phase: "available",
			version: "2.0.0",
			notes: "what is new",
		});
	});

	it("treats blank notes as none", async () => {
		checkForUpdate.mockResolvedValue(release("2.0.0", "   "));
		await checkForUpdates();
		expect(get(updateState).notes).toBeNull();
	});

	it("surfaces a failed check", async () => {
		checkForUpdate.mockRejectedValue(new Error("network down"));
		await checkForUpdates();
		expect(get(updateState)).toMatchObject({
			phase: "error",
			error: "network down",
		});
	});

	it("renders a thrown non-Error as a message", async () => {
		checkForUpdate.mockRejectedValue("just a string");
		await checkForUpdates();
		expect(get(updateState).error).toBe("just a string");
	});

	it("keeps a silent background failure off the screen", async () => {
		checkForUpdate.mockRejectedValue(new Error("network down"));
		await checkForUpdates({ silent: true });
		expect(phase()).toBe("idle");
		expect(get(updateState).error).toBeNull();
	});

	it("clears a previous error when a later check succeeds", async () => {
		checkForUpdate.mockRejectedValueOnce(new Error("down"));
		await checkForUpdates();
		expect(phase()).toBe("error");
		checkForUpdate.mockResolvedValue(release());
		await checkForUpdates();
		expect(get(updateState).error).toBeNull();
	});

	it("releases the handle of a previous check", async () => {
		const first = release("1.0.0");
		checkForUpdate.mockResolvedValue(first);
		await checkForUpdates();
		checkForUpdate.mockResolvedValue(release("2.0.0"));
		await checkForUpdates();
		expect(first.close).toHaveBeenCalled();
	});

	it("releases the handle when a later check finds nothing", async () => {
		const found = release();
		checkForUpdate.mockResolvedValue(found);
		await checkForUpdates();
		checkForUpdate.mockResolvedValue(null);
		await checkForUpdates();
		expect(found.close).toHaveBeenCalled();
	});

	it("survives a handle that refuses to close", async () => {
		const found = release();
		found.close.mockRejectedValue(new Error("gone"));
		checkForUpdate.mockResolvedValue(found);
		await checkForUpdates();
		checkForUpdate.mockResolvedValue(null);
		await expect(checkForUpdates()).resolves.toBeUndefined();
	});

	it("does not start a second check while one is running", async () => {
		let resolveFirst!: (v: unknown) => void;
		checkForUpdate.mockImplementation(
			() =>
				new Promise((r) => {
					resolveFirst = r;
				}),
		);
		const first = checkForUpdates();
		await checkForUpdates();
		expect(checkForUpdate).toHaveBeenCalledTimes(1);
		resolveFirst(null);
		await first;
	});
});

describe("installUpdate", () => {
	beforeEach(async () => {
		checkForUpdate.mockResolvedValue(release("2.0.0"));
		await checkForUpdates();
	});

	it("reports the download progress as it comes", async () => {
		downloadAndInstall.mockImplementation(async (_u, onProgress) => {
			onProgress({ downloaded: 50, total: 100 });
		});
		await installUpdate();
		expect(get(updateState)).toMatchObject({ downloaded: 50, total: 100 });
	});

	it("restarts once the install is done", async () => {
		await installUpdate();
		expect(restartApp).toHaveBeenCalled();
	});

	it("passes through installing before restarting", async () => {
		const seen: string[] = [];
		restartApp.mockImplementation(async () => {
			seen.push(phase());
		});
		await installUpdate();
		expect(seen).toEqual(["installing"]);
	});

	it("surfaces a failed download", async () => {
		downloadAndInstall.mockRejectedValue(new Error("disk full"));
		await installUpdate();
		expect(get(updateState)).toMatchObject({
			phase: "error",
			error: "disk full",
		});
		expect(restartApp).not.toHaveBeenCalled();
	});

	it("surfaces a failed restart", async () => {
		restartApp.mockRejectedValue(new Error("denied"));
		await installUpdate();
		expect(phase()).toBe("error");
	});

	it("does nothing when no update is pending", async () => {
		checkForUpdate.mockResolvedValue(null);
		await checkForUpdates();
		await installUpdate();
		expect(downloadAndInstall).not.toHaveBeenCalled();
	});
});

describe("hasPendingUpdate", () => {
	it("is false while nothing was found", async () => {
		await checkForUpdates();
		expect(get(hasPendingUpdate)).toBe(false);
	});

	it("is true once a release is available", async () => {
		checkForUpdate.mockResolvedValue(release());
		await checkForUpdates();
		expect(get(hasPendingUpdate)).toBe(true);
	});

	it("is false while a check is merely running", async () => {
		let resolveCheck!: (v: unknown) => void;
		checkForUpdate.mockImplementation(
			() =>
				new Promise((r) => {
					resolveCheck = r;
				}),
		);
		const pending = checkForUpdates();
		expect(get(hasPendingUpdate)).toBe(false);
		resolveCheck(null);
		await pending;
	});

	it("is false after a failed check", async () => {
		checkForUpdate.mockRejectedValue(new Error("down"));
		await checkForUpdates();
		expect(get(hasPendingUpdate)).toBe(false);
	});
});

describe("the update modal", () => {
	it("opens and closes on request", () => {
		openUpdateModal();
		expect(get(isUpdateModalOpen)).toBe(true);
		closeUpdateModal();
		expect(get(isUpdateModalOpen)).toBe(false);
	});

	it("never opens on its own when an update is found", async () => {
		checkForUpdate.mockResolvedValue(release());
		await checkForUpdates();
		expect(get(isUpdateModalOpen)).toBe(false);
	});
});

describe("startUpdateChecks", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("checks nothing while the setting is off", async () => {
		vi.useFakeTimers();
		await settings.save({ autoCheckUpdates: false });
		const stop = startUpdateChecks();
		vi.advanceTimersByTime(STARTUP_CHECK_DELAY_MS + CHECK_INTERVAL_MS);
		expect(checkForUpdate).not.toHaveBeenCalled();
		stop();
	});

	it("waits before the first check, so it does not compete with startup", async () => {
		await settings.save({ autoCheckUpdates: true });
		vi.useFakeTimers();
		const stop = startUpdateChecks();
		vi.advanceTimersByTime(STARTUP_CHECK_DELAY_MS - 1);
		expect(checkForUpdate).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(checkForUpdate).toHaveBeenCalledTimes(1);
		stop();
	});

	it("keeps checking on the interval afterwards", async () => {
		await settings.save({ autoCheckUpdates: true });
		vi.useFakeTimers();
		const stop = startUpdateChecks();
		vi.advanceTimersByTime(STARTUP_CHECK_DELAY_MS);
		// The startup check must settle before the next one is allowed: while a
		// check is in flight, checkForUpdates() refuses to start another.
		await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
		expect(checkForUpdate).toHaveBeenCalledTimes(2);
		stop();
	});

	it("stops checking once torn down", async () => {
		await settings.save({ autoCheckUpdates: true });
		vi.useFakeTimers();
		const stop = startUpdateChecks();
		stop();
		vi.advanceTimersByTime(STARTUP_CHECK_DELAY_MS + CHECK_INTERVAL_MS);
		expect(checkForUpdate).not.toHaveBeenCalled();
	});

	it("stops checking when the setting is turned off", async () => {
		await settings.save({ autoCheckUpdates: true });
		vi.useFakeTimers();
		const stop = startUpdateChecks();
		vi.useRealTimers();
		await settings.save({ autoCheckUpdates: false });
		vi.useFakeTimers();
		vi.advanceTimersByTime(STARTUP_CHECK_DELAY_MS + CHECK_INTERVAL_MS);
		expect(checkForUpdate).not.toHaveBeenCalled();
		stop();
	});
});
