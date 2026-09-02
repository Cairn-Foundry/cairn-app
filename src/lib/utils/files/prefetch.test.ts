// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readDirTree } from "$lib/services/file-service";
import { getSnapshot } from "$lib/services/git-service";
import { listInstances } from "$lib/services/instance-service";
import { projects } from "$lib/stores/project";
import {
	cancelPrefetch,
	schedulePrefetch,
	scheduleWorktreePrefetch,
} from "./prefetch";

vi.mock("$lib/services/file-service", () => ({ readDirTree: vi.fn() }));
vi.mock("$lib/services/git-service", () => ({ getSnapshot: vi.fn() }));
vi.mock("$lib/services/instance-service", () => ({ listInstances: vi.fn() }));

const mockTree = vi.mocked(readDirTree);
const mockSnapshot = vi.mocked(getSnapshot);
const mockInstances = vi.mocked(listInstances);

/** The worktrees the prefetch actually read a tree for. */
const warmed = () => mockTree.mock.calls.map((c) => c[0]);

beforeEach(() => {
	vi.useFakeTimers();
	mockTree.mockReset().mockResolvedValue([] as never);
	mockSnapshot.mockReset().mockResolvedValue(null as never);
	mockInstances.mockReset();
	cancelPrefetch();
	projects.set([
		{ id: "p1", activeInstanceId: "i1" },
		{ id: "p2", activeInstanceId: "i2" },
		{ id: "p3", activeInstanceId: "i3" },
	] as never);
	mockInstances.mockImplementation(
		async (id: string) =>
			[
				{
					id: id.replace("p", "i"),
					projectId: id,
					worktreePath: `/wt/${id}`,
				},
			] as never,
	);
});

describe("scheduleWorktreePrefetch", () => {
	it("warms the tree and the snapshot once the pointer has settled", () => {
		scheduleWorktreePrefetch("/wt/a");
		expect(warmed()).toEqual([]);

		vi.advanceTimersByTime(80);
		expect(warmed()).toEqual(["/wt/a"]);
		expect(mockSnapshot).toHaveBeenCalledWith("/wt/a", "");
	});

	it("reads only the last row a sweep passed over", () => {
		scheduleWorktreePrefetch("/wt/a");
		vi.advanceTimersByTime(40);
		scheduleWorktreePrefetch("/wt/b");
		vi.advanceTimersByTime(40);
		scheduleWorktreePrefetch("/wt/c");
		vi.advanceTimersByTime(80);

		expect(warmed()).toEqual(["/wt/c"]);
	});

	it("reads nothing when the pointer leaves before the delay", () => {
		scheduleWorktreePrefetch("/wt/a");
		cancelPrefetch();
		vi.advanceTimersByTime(80);

		expect(warmed()).toEqual([]);
	});
});

describe("schedulePrefetch", () => {
	it("warms the active instance of the hovered project", async () => {
		schedulePrefetch("p1");
		vi.advanceTimersByTime(80);
		await vi.waitFor(() => expect(warmed()).toEqual(["/wt/p1"]));
	});

	/* The instance listing is async, so leaving the tab after the timer fired
	   used to let the reads land anyway - one worktree warmed per tab crossed. */
	it("drops a listing that resolves after the pointer moved on", async () => {
		schedulePrefetch("p1");
		vi.advanceTimersByTime(80);
		schedulePrefetch("p2");
		vi.advanceTimersByTime(80);
		await vi.waitFor(() => expect(warmed()).toEqual(["/wt/p2"]));

		await Promise.resolve();
		expect(warmed()).toEqual(["/wt/p2"]);
	});

	it("drops a listing left in flight when the pointer leaves entirely", async () => {
		schedulePrefetch("p1");
		vi.advanceTimersByTime(80);
		cancelPrefetch();

		await Promise.resolve();
		await Promise.resolve();
		expect(warmed()).toEqual([]);
	});
});
