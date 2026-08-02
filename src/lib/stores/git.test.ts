import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeProjectId, projects } from "$lib/stores/project";
import { activeScreen } from "$lib/stores/ui";
import type { Project } from "$lib/types/project";
import { GIT_REFRESH_INTERVAL_MS } from "$lib/utils/timing";
import { git, refreshStatus, startGitPolling } from "./git";
import { BASE_INSTANCE_ID } from "./instance";

const getStatus = vi.hoisted(() => vi.fn());
const isGitRepo = vi.hoisted(() => vi.fn());

vi.mock("$lib/services/git-service", () => ({
	isGitRepo,
	getStatus,
	getDiffUnstaged: vi.fn().mockResolvedValue([]),
	getDiffStaged: vi.fn().mockResolvedValue([]),
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

function project(id: string): Project {
	return {
		id,
		name: id,
		path: `/repos/${id}`,
		color: "#fff",
		activeInstanceId: BASE_INSTANCE_ID,
	} as Project;
}

describe("refreshStatus", () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		isGitRepo.mockResolvedValue(true);
		getStatus.mockResolvedValue({ "a.txt": "modified" });
		projects.set([project("a")]);
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
		expect(getStatus).toHaveBeenCalledTimes(2);
	});

	it("never serves a caller a status read before it asked", async () => {
		const first = refreshStatus();
		getStatus.mockResolvedValue({ "b.txt": "untracked" });
		await Promise.all([first, refreshStatus()]);
		expect(get(git).status).toEqual({ "b.txt": "untracked" });
	});

	it("runs again once the previous refresh has settled", async () => {
		await refreshStatus();
		await refreshStatus();
		expect(getStatus).toHaveBeenCalledTimes(2);
	});

	it("publishes the worktree the status was read from", async () => {
		await refreshStatus();
		expect(get(git).statusWorktree).toBe("/repos/a");
		expect(get(git).status).toEqual({ "a.txt": "modified" });
	});

	it("marks the worktree even when it is not a repository", async () => {
		isGitRepo.mockResolvedValue(false);
		await refreshStatus();
		expect(get(git).isGitRepo).toBe(false);
		expect(get(git).statusWorktree).toBe("/repos/a");
		expect(get(git).status).toEqual({});
	});

	it("does nothing without an active worktree", async () => {
		activeProjectId.set(null);
		await refreshStatus();
		expect(getStatus).not.toHaveBeenCalled();
	});
});

describe("startGitPolling", () => {
	let stop: () => void;

	beforeEach(async () => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		isGitRepo.mockResolvedValue(true);
		getStatus.mockResolvedValue({});
		projects.set([project("a")]);
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
		expect(getStatus).not.toHaveBeenCalled();
	});

	it("refreshes as soon as the workspace comes up, then on its own cadence", async () => {
		stop = startGitPolling();
		window.dispatchEvent(new Event("focus"));
		await vi.advanceTimersByTimeAsync(0);
		expect(getStatus).not.toHaveBeenCalled();

		activeScreen.set("workspace");
		await vi.advanceTimersByTimeAsync(0);
		expect(getStatus).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(GIT_REFRESH_INTERVAL_MS);
		expect(getStatus).toHaveBeenCalledTimes(2);
	});

	it("stops while the window is in the background and catches up on focus", async () => {
		activeScreen.set("workspace");
		stop = startGitPolling();
		window.dispatchEvent(new Event("blur"));
		await vi.advanceTimersByTimeAsync(GIT_REFRESH_INTERVAL_MS * 3);
		expect(getStatus).not.toHaveBeenCalled();

		window.dispatchEvent(new Event("focus"));
		await vi.advanceTimersByTimeAsync(0);
		expect(getStatus).toHaveBeenCalledTimes(1);
	});

	it("refreshes nothing once stopped", async () => {
		activeScreen.set("workspace");
		stop = startGitPolling();
		stop();
		await vi.advanceTimersByTimeAsync(GIT_REFRESH_INTERVAL_MS * 3);
		expect(getStatus).not.toHaveBeenCalled();
	});
});
