// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeProjectId, projects } from "$lib/stores/project";
import { activeScreen } from "$lib/stores/ui";
import {
	GIT_REFRESH_IDLE_INTERVAL_MS,
	GIT_REFRESH_INTERVAL_MS,
} from "$lib/utils/timing";
import { project } from "../../test/fixtures";
import {
	git,
	refreshStatus,
	setDiffsWanted,
	stageFile as stageFileInStore,
	startGitPolling,
} from "./git";
import { BASE_INSTANCE_ID } from "./instance";

const getStatusFull = vi.hoisted(() => vi.fn());
const stageFile = vi.hoisted(() => vi.fn());

vi.mock("$lib/services/git-service", () => ({
	getStatusFull,
	getSnapshot: (() => {
		let version = 0;
		return async (worktreePath: string) => ({
			version: ++version,
			status: await getStatusFull(worktreePath),
			currentBranch: "main",
			remoteStatus: null,
			operationState: null,
		});
	})(),
	stageFile,
	getChangedPaths: vi.fn().mockResolvedValue({ staged: [], unstaged: [] }),
	getDiffUnstaged: vi.fn().mockResolvedValue([]),
	getDiffStaged: vi.fn().mockResolvedValue([]),
	getDiffs: vi.fn().mockResolvedValue(null),
	getCurrentBranch: vi.fn().mockResolvedValue("main"),
	getRemoteStatus: vi.fn().mockResolvedValue(null),
	getOperationState: vi.fn().mockResolvedValue(null),
	toGitError: (e: unknown) => ({ code: "unknown", message: String(e) }),
}));

vi.mock("./terminal", () => ({
	removeInstanceTerminals: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("$lib/services/instance-service", () => ({
	listInstances: vi.fn().mockResolvedValue([]),
	listBranchesDetailed: vi.fn(),
	createInstance: vi.fn(),
	deleteInstance: vi.fn(),
	duplicateInstance: vi.fn(),
	updateInstanceStatus: vi.fn(),
}));

describe("refreshStatus", () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		getStatusFull.mockResolvedValue({
			isGitRepo: true,
			status: { "a.txt": "modified" },
			changedPaths: { staged: [], unstaged: [] },
		});
		projects.set([project("a", { activeInstanceId: BASE_INSTANCE_ID })]);
		const { loadInstances } = await import("./instance");
		await loadInstances("a");
		activeProjectId.set("a");
	});

	it("collapses the requests that pile up during a flight", async () => {
		await Promise.all([
			refreshStatus(),
			refreshStatus(true),
			refreshStatus(),
			refreshStatus(true),
		]);
		expect(getStatusFull).toHaveBeenCalledTimes(2);
	});

	it("never serves a caller a status read before it asked", async () => {
		const first = refreshStatus();
		getStatusFull.mockResolvedValue({
			isGitRepo: true,
			status: { "b.txt": "untracked" },
			changedPaths: { staged: [], unstaged: [] },
		});
		await Promise.all([first, refreshStatus()]);
		expect(get(git).status).toEqual({ "b.txt": "untracked" });
	});

	it("runs again once the previous refresh has settled", async () => {
		await refreshStatus();
		await refreshStatus();
		expect(getStatusFull).toHaveBeenCalledTimes(2);
	});

	it("publishes the worktree the status was read from", async () => {
		await refreshStatus();
		expect(get(git).statusWorktree).toBe("/repos/a");
		expect(get(git).status).toEqual({ "a.txt": "modified" });
	});

	it("marks the worktree even when it is not a repository", async () => {
		getStatusFull.mockResolvedValue({
			isGitRepo: false,
			status: {},
			changedPaths: { staged: [], unstaged: [] },
		});
		await refreshStatus();
		expect(get(git).isGitRepo).toBe(false);
		expect(get(git).statusWorktree).toBe("/repos/a");
		expect(get(git).status).toEqual({});
	});

	it("does nothing without an active worktree", async () => {
		activeProjectId.set(null);
		await refreshStatus();
		expect(getStatusFull).not.toHaveBeenCalled();
	});
});

describe("indexVersion", () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		getStatusFull.mockResolvedValue({
			isGitRepo: true,
			status: { "a.txt": "modified" },
			changedPaths: { staged: [], unstaged: [] },
		});
		stageFile.mockResolvedValue(undefined);
		projects.set([project("a", { activeInstanceId: BASE_INSTANCE_ID })]);
		const { loadInstances } = await import("./instance");
		await loadInstances("a");
		activeProjectId.set("a");
	});

	it("stays put on a status refresh that follows no write", async () => {
		await refreshStatus();
		const before = get(git).indexVersion;
		await refreshStatus();
		await refreshStatus(true);
		expect(get(git).indexVersion).toBe(before);
	});

	it("moves once after a stage, even when the status label does not change", async () => {
		await refreshStatus();
		const before = get(git).indexVersion;
		await stageFileInStore("a.txt");
		expect(get(git).status).toEqual({ "a.txt": "modified" });
		expect(get(git).indexVersion).toBe(before + 1);
	});

	it("does not move when the write fails", async () => {
		await refreshStatus();
		const before = get(git).indexVersion;
		stageFile.mockRejectedValue(new Error("nope"));
		await expect(stageFileInStore("a.txt")).rejects.toThrow();
		await refreshStatus();
		expect(get(git).indexVersion).toBe(before);
	});
});

describe("startGitPolling", () => {
	let stop: () => void;

	beforeEach(async () => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		getStatusFull.mockResolvedValue({
			isGitRepo: true,
			status: {},
			changedPaths: { staged: [], unstaged: [] },
		});
		projects.set([project("a", { activeInstanceId: BASE_INSTANCE_ID })]);
		const { loadInstances } = await import("./instance");
		await loadInstances("a");
		activeProjectId.set("a");
		activeScreen.set("home");
	});

	afterEach(() => {
		stop?.();
		vi.useRealTimers();
	});

	it("stays idle while the home screen is showing", async () => {
		stop = startGitPolling();
		await vi.advanceTimersByTimeAsync(GIT_REFRESH_INTERVAL_MS * 3);
		expect(getStatusFull).not.toHaveBeenCalled();
	});

	it("refreshes as soon as the workspace comes up, then on its own cadence", async () => {
		stop = startGitPolling();
		window.dispatchEvent(new Event("focus"));
		await vi.advanceTimersByTimeAsync(0);
		expect(getStatusFull).not.toHaveBeenCalled();

		activeScreen.set("workspace");
		await vi.advanceTimersByTimeAsync(0);
		expect(getStatusFull).toHaveBeenCalledTimes(1);

		// The git view is closed here, so the slower idle cadence applies: the
		// fast interval alone is not enough to earn a second read.
		await vi.advanceTimersByTimeAsync(GIT_REFRESH_INTERVAL_MS);
		expect(getStatusFull).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(GIT_REFRESH_IDLE_INTERVAL_MS);
		expect(getStatusFull).toHaveBeenCalledTimes(2);
	});

	it("polls on the fast cadence while the git view is open", async () => {
		setDiffsWanted(true);
		stop = startGitPolling();
		window.dispatchEvent(new Event("focus"));
		activeScreen.set("workspace");
		await vi.advanceTimersByTimeAsync(0);
		expect(getStatusFull).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(GIT_REFRESH_INTERVAL_MS);
		expect(getStatusFull).toHaveBeenCalledTimes(2);
		setDiffsWanted(false);
	});

	it("stops while the window is in the background and catches up on focus", async () => {
		activeScreen.set("workspace");
		stop = startGitPolling();
		window.dispatchEvent(new Event("blur"));
		await vi.advanceTimersByTimeAsync(GIT_REFRESH_INTERVAL_MS * 3);
		expect(getStatusFull).not.toHaveBeenCalled();

		window.dispatchEvent(new Event("focus"));
		await vi.advanceTimersByTimeAsync(0);
		expect(getStatusFull).toHaveBeenCalledTimes(1);
	});

	it("refreshes nothing once stopped", async () => {
		activeScreen.set("workspace");
		stop = startGitPolling();
		stop();
		await vi.advanceTimersByTimeAsync(GIT_REFRESH_INTERVAL_MS * 3);
		expect(getStatusFull).not.toHaveBeenCalled();
	});
});

describe("the worktree cache", () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		getStatusFull.mockResolvedValue({
			isGitRepo: true,
			status: { "a.txt": "modified" },
			changedPaths: { staged: [], unstaged: [] },
		});
		projects.set([
			project("a", { activeInstanceId: BASE_INSTANCE_ID }),
			project("b", { activeInstanceId: BASE_INSTANCE_ID }),
		]);
		const { loadInstances } = await import("./instance");
		await loadInstances("a");
		await loadInstances("b");
		activeProjectId.set("a");
	});

	it("gives a project back the status it was left on", async () => {
		await refreshStatus();
		expect(get(git).statusWorktree).toBe("/repos/a");

		getStatusFull.mockResolvedValue({
			isGitRepo: true,
			status: { "b.txt": "untracked" },
			changedPaths: { staged: [], unstaged: [] },
		});
		activeProjectId.set("b");
		await refreshStatus();
		expect(get(git).statusWorktree).toBe("/repos/b");

		// Back to a: the data is there before anything is read again.
		activeProjectId.set("a");
		expect(get(git).statusWorktree).toBe("/repos/a");
		expect(get(git).status).toEqual({ "a.txt": "modified" });
	});

	it("never shows one worktree's status under another", async () => {
		await refreshStatus();
		expect(get(git).status).toEqual({ "a.txt": "modified" });
		// c has never been read, so it starts empty rather than on a's status.
		projects.update((list) => [
			...list,
			project("c", { activeInstanceId: BASE_INSTANCE_ID }),
		]);
		const { loadInstances } = await import("./instance");
		await loadInstances("c");
		activeProjectId.set("c");
		expect(get(git).statusWorktree).toBeNull();
		expect(get(git).status).toEqual({});
	});

	it("keeps the versions, so an unchanged repository is not re-read", async () => {
		await refreshStatus();
		const version = get(git).snapshotVersion;
		expect(version).toBeGreaterThan(0);
		activeProjectId.set("b");
		activeProjectId.set("a");
		expect(get(git).snapshotVersion).toBe(version);
	});
});
