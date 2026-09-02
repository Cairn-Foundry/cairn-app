// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { activeProjectId, projects } from "$lib/stores/project";
import { instance, project } from "../../test/fixtures";
import {
	activeInstance,
	BASE_INSTANCE_ID,
	instances,
	loadInstances,
	removeInstance,
} from "./instance";

const listInstances = vi.hoisted(() => vi.fn());

vi.mock("$lib/services/instance-service", () => ({
	listInstances,
	createInstance: vi.fn(),
	deleteInstance: vi.fn().mockResolvedValue(undefined),
	duplicateInstance: vi.fn(),
	updateInstanceStatus: vi.fn(),
}));

vi.mock("./terminal", () => ({
	removeInstanceTerminals: vi.fn().mockResolvedValue(undefined),
}));

const unwatchWorktree = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("$lib/services/fs-watch-service", () => ({ unwatchWorktree }));

describe("activeInstance across a project switch", () => {
	beforeEach(() => {
		listInstances.mockReset();
		projects.set([
			project("a", { activeInstanceId: "a1" }),
			project("b", { activeInstanceId: "b1" }),
		]);
		activeProjectId.set(null);
	});

	it("stays unresolved until the instances of the project are loaded", () => {
		activeProjectId.set("a");
		expect(get(activeInstance)).toBeNull();
	});

	it("never passes through the project root when the switch loads first", async () => {
		listInstances.mockImplementation(async (id: string) => [
			instance(`${id}1`, id),
		]);
		await loadInstances("a");
		activeProjectId.set("a");

		const seen: (string | null)[] = [];
		const unsubscribe = activeInstance.subscribe((i) =>
			seen.push(i?.worktreePath ?? null),
		);

		await loadInstances("b");
		activeProjectId.set("b");
		unsubscribe();

		expect(seen).toEqual(["/worktrees/a/a1", "/worktrees/b/b1"]);
		expect(seen).not.toContain("/repos/a");
		expect(seen).not.toContain("/repos/b");
	});

	it("falls back to the base instance only once the project is known", async () => {
		listInstances.mockResolvedValue([]);
		projects.set([project("a", { activeInstanceId: BASE_INSTANCE_ID })]);
		await loadInstances("a");
		activeProjectId.set("a");
		expect(get(activeInstance)?.worktreePath).toBe("/repos/a");
	});

	it("resolves the base instance when the stored instance is gone", async () => {
		listInstances.mockResolvedValue([]);
		await loadInstances("a");
		activeProjectId.set("a");
		expect(get(activeInstance)?.id).toBe(BASE_INSTANCE_ID);
	});

	it("exposes only the instances of the active project", async () => {
		listInstances.mockImplementation(async (id: string) => [
			instance(`${id}1`, id),
		]);
		await loadInstances("a");
		await loadInstances("b");

		activeProjectId.set("a");
		expect(get(instances).map((i) => i.id)).toEqual(["a1"]);
		activeProjectId.set("b");
		expect(get(instances).map((i) => i.id)).toEqual(["b1"]);
	});

	it("removes an instance from its own project only", async () => {
		listInstances.mockImplementation(async (id: string) => [
			instance(`${id}1`, id),
		]);
		await loadInstances("a");
		await loadInstances("b");

		await removeInstance("a1", "a");

		activeProjectId.set("a");
		expect(get(instances)).toEqual([]);
		activeProjectId.set("b");
		expect(get(instances).map((i) => i.id)).toEqual(["b1"]);
	});
});

describe("removeInstance", () => {
	beforeEach(() => {
		listInstances.mockReset();
		unwatchWorktree.mockClear();
		projects.set([project("a", { activeInstanceId: "a1" })]);
	});

	/**
	 * A watcher left on a deleted worktree holds an inotify watch for the rest of
	 * the session and reports changes to a directory nobody can act on.
	 */
	it("lets go of the deleted instance's watcher", async () => {
		const only = instance("a1", "a");
		listInstances.mockResolvedValue([only]);
		await loadInstances("a");

		await removeInstance("a1", "a");

		expect(unwatchWorktree).toHaveBeenCalledWith(only.worktreePath);
	});

	it("does not fail when the instance is already gone", async () => {
		listInstances.mockResolvedValue([]);
		await loadInstances("a");

		await expect(removeInstance("ghost", "a")).resolves.toBeUndefined();
		expect(unwatchWorktree).not.toHaveBeenCalled();
	});
});
