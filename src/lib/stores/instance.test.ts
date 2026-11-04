// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { activeProjectId, projects } from "#lib/stores/project";
import { instance, project } from "../../test/fixtures";
import {
	activeInstance,
	adoptWorktree as adoptWorktreeIntoStore,
	BASE_INSTANCE_ID,
	baseInstance,
	duplicateInstance,
	forgetProject,
	getNextDuplicateTitle,
	hasInstances,
	instances,
	loadInstances,
	removeInstance,
	setInstanceBaseBranch,
	setInstanceStatus,
	setInstanceTicket,
} from "./instance";
import { runProjectTeardowns } from "./project-teardown";
import { removeInstanceTerminals } from "./terminal";

const listInstances = vi.hoisted(() => vi.fn());
const deleteInstance = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const checkInstanceDeletion = vi.hoisted(() =>
	vi.fn().mockResolvedValue(undefined),
);
const adoptWorktree = vi.hoisted(() => vi.fn());
const duplicateInstanceService = vi.hoisted(() => vi.fn());
const updateInstanceStatus = vi.hoisted(() => vi.fn());
const updateInstanceTicket = vi.hoisted(() => vi.fn());
const updateInstanceBaseBranch = vi.hoisted(() => vi.fn());

vi.mock("#lib/services/instance-service", () => ({
	listInstances,
	createInstance: vi.fn(),
	deleteInstance,
	checkInstanceDeletion,
	adoptWorktree,
	duplicateInstance: duplicateInstanceService,
	updateInstanceStatus,
	updateInstanceTicket,
	updateInstanceBaseBranch,
}));

const removeInstanceConversations = vi.hoisted(() => vi.fn());
vi.mock("./conversation", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	removeInstanceConversations,
}));

vi.mock("./terminal", () => ({
	removeInstanceTerminals: vi.fn().mockResolvedValue(undefined),
}));

const unwatchWorktree = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("#lib/services/fs-watch-service", () => ({ unwatchWorktree }));

describe("activeInstance across a project switch", () => {
	beforeEach(() => {
		listInstances.mockReset();
		forgetProject("a");
		forgetProject("b");
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

	/**
	 * What becomes of the worktree is decided in the modal and has to reach the
	 * backend untouched; left out, the backend applies its own default.
	 */
	it("carries the worktree decision through to the service", async () => {
		listInstances.mockImplementation(async (id: string) => [
			instance(`${id}1`, id),
			instance(`${id}2`, id),
		]);
		await loadInstances("a");

		await removeInstance("a1", "a", false);
		expect(deleteInstance).toHaveBeenLastCalledWith("a1", "a", false);

		await removeInstance("a2", "a", true);
		expect(deleteInstance).toHaveBeenLastCalledWith("a2", "a", true);
	});

	it("leaves the decision to the backend when none was made", async () => {
		listInstances.mockImplementation(async (id: string) => [
			instance(`${id}1`, id),
		]);
		await loadInstances("a");
		await removeInstance("a1", "a");
		expect(deleteInstance).toHaveBeenLastCalledWith("a1", "a", undefined);
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

describe("instances with no active project", () => {
	it("lists nothing", () => {
		projects.set([project("a")]);
		activeProjectId.set(null);
		expect(get(instances)).toEqual([]);
	});
});

describe("adoptWorktree", () => {
	beforeEach(() => {
		listInstances.mockReset();
		adoptWorktree.mockReset();
		projects.set([project("a", { activeInstanceId: null })]);
		activeProjectId.set("a");
	});

	it("adds the adopted instance and switches to it", async () => {
		const existing = instance("a1", "a");
		const adopted = instance("a2", "a");
		listInstances.mockResolvedValue([existing]);
		adoptWorktree.mockResolvedValue(adopted);
		await loadInstances("a");
		const args = {
			id: "a2",
			projectId: "a",
			projectPath: "/repos/a",
			path: "/worktrees/a/a2",
			ticket: { id: "a2", title: "a2" },
		};

		await expect(adoptWorktreeIntoStore(args)).resolves.toBe(adopted);

		expect(adoptWorktree).toHaveBeenCalledWith(args);
		expect(get(instances)).toEqual([existing, adopted]);
		expect(get(projects).find((p) => p.id === "a")?.activeInstanceId).toBe(
			"a2",
		);
	});
});

describe("duplicateInstance", () => {
	const source = {
		id: "a1",
		projectId: "a",
		ticket: { id: "T-1", title: "First" },
	};

	beforeEach(() => {
		listInstances.mockReset();
		duplicateInstanceService.mockReset();
		projects.set([project("a")]);
		activeProjectId.set("a");
	});

	it("numbers the ticket after the existing siblings and adds the copy", async () => {
		const sibling = instance("a2", "a", { parentInstanceId: "a1" });
		const unrelated = instance("a3", "a", { parentInstanceId: "other" });
		const copy = instance("a4", "a", { parentInstanceId: "a1" });
		listInstances.mockResolvedValue([sibling, unrelated]);
		duplicateInstanceService.mockResolvedValue(copy);
		await loadInstances("a");
		vi.spyOn(crypto, "randomUUID").mockReturnValue(
			"00000000-0000-4000-8000-000000000001",
		);

		await expect(
			duplicateInstance(source, { title: "Copy", copyWorkingChanges: true }),
		).resolves.toBe(copy);

		expect(duplicateInstanceService).toHaveBeenCalledWith({
			sourceId: "a1",
			projectId: "a",
			newId: "00000000-0000-4000-8000-000000000001",
			ticket: { id: "T-1-2", title: "Copy" },
			copyWorkingChanges: true,
		});
		expect(get(instances)).toEqual([sibling, unrelated, copy]);
	});
});

describe("instance updates", () => {
	beforeEach(async () => {
		listInstances.mockReset();
		updateInstanceStatus.mockReset();
		updateInstanceTicket.mockReset();
		updateInstanceBaseBranch.mockReset();
		projects.set([project("a")]);
		activeProjectId.set("a");
		listInstances.mockResolvedValue([instance("a1", "a"), instance("a2", "a")]);
		await loadInstances("a");
	});

	it("replaces the instance with the one the backend answers for a status", async () => {
		const updated = instance("a1", "a", { status: "done" });
		updateInstanceStatus.mockResolvedValue(updated);

		await setInstanceStatus("a1", "a", "done");

		expect(updateInstanceStatus).toHaveBeenCalledWith("a1", "a", "done");
		expect(get(instances)).toEqual([updated, instance("a2", "a")]);
	});

	it("replaces the instance with the one the backend answers for a ticket", async () => {
		const ticket = { id: "T-9", title: "Nine" };
		const updated = instance("a2", "a", { ticket });
		updateInstanceTicket.mockResolvedValue(updated);

		await setInstanceTicket("a2", "a", ticket);

		expect(updateInstanceTicket).toHaveBeenCalledWith("a2", "a", ticket);
		expect(get(instances)).toEqual([instance("a1", "a"), updated]);
	});

	it("replaces the instance with the one the backend answers for a base branch", async () => {
		const updated = instance("a1", "a", { baseBranch: "develop" });
		updateInstanceBaseBranch.mockResolvedValue(updated);

		await setInstanceBaseBranch("a1", "a", "develop");

		expect(updateInstanceBaseBranch).toHaveBeenCalledWith("a1", "a", "develop");
		expect(get(instances)).toEqual([updated, instance("a2", "a")]);
	});
});

describe("removeInstance cleanup", () => {
	beforeEach(async () => {
		listInstances.mockReset();
		vi.mocked(removeInstanceTerminals).mockClear();
		removeInstanceConversations.mockClear();
		projects.set([project("a")]);
		activeProjectId.set("a");
		listInstances.mockResolvedValue([instance("a1", "a"), instance("a2", "a")]);
		await loadInstances("a");
	});

	it("closes the terminals and forgets the conversations of the instance", async () => {
		await removeInstance("a1", "a");

		expect(removeInstanceTerminals).toHaveBeenCalledWith("a", "a1");
		expect(removeInstanceConversations).toHaveBeenCalledWith("a", "a1");
	});

	it("keeps the other instances of the project", async () => {
		await removeInstance("a1", "a");

		expect(get(instances).map((i) => i.id)).toEqual(["a2"]);
	});

	/** A refused deletion used to leave the instance listed with its shells and agents dead. */
	it("leaves a refused instance running and listed", async () => {
		checkInstanceDeletion.mockRejectedValueOnce("vendor cannot be deleted");
		deleteInstance.mockClear();

		await expect(removeInstance("a1", "a", true)).rejects.toBe(
			"vendor cannot be deleted",
		);

		expect(removeInstanceTerminals).not.toHaveBeenCalled();
		expect(removeInstanceConversations).not.toHaveBeenCalled();
		expect(deleteInstance).not.toHaveBeenCalled();
		expect(get(instances).map((i) => i.id)).toEqual(["a1", "a2"]);
	});
});

describe("spawning into a project whose instances were never loaded", () => {
	it("starts its list with the adopted instance", async () => {
		const adopted = instance("n1", "n");
		adoptWorktree.mockResolvedValue(adopted);
		projects.set([project("n", { activeInstanceId: null })]);
		activeProjectId.set("n");
		forgetProject("n");

		await adoptWorktreeIntoStore({
			id: "n1",
			projectId: "n",
			projectPath: "/repos/n",
			path: "/worktrees/n/n1",
			ticket: { id: "n1", title: "n1" },
		});

		expect(get(instances)).toEqual([adopted]);
	});
});

describe("getNextDuplicateTitle", () => {
	beforeEach(async () => {
		listInstances.mockReset();
		projects.set([project("a")]);
		activeProjectId.set("a");
	});

	it("numbers the first copy 1", async () => {
		listInstances.mockResolvedValue([instance("a1", "a")]);
		await loadInstances("a");

		expect(
			getNextDuplicateTitle({ id: "a1", ticket: { title: "First" } }),
		).toBe("First (1)");
	});

	it("numbers after the copies already made from the source", async () => {
		listInstances.mockResolvedValue([
			instance("a1", "a"),
			instance("a2", "a", { parentInstanceId: "a1" }),
			instance("a3", "a", { parentInstanceId: "a1" }),
			instance("a4", "a", { parentInstanceId: "other" }),
		]);
		await loadInstances("a");

		expect(
			getNextDuplicateTitle({ id: "a1", ticket: { title: "First" } }),
		).toBe("First (3)");
	});
});

describe("the base instance cache", () => {
	it("hands out the same instance while the project path holds", () => {
		const first = baseInstance(project("a"));
		expect(baseInstance(project("a"))).toBe(first);
	});

	it("rebuilds it when the project moves", () => {
		const first = baseInstance(project("a"));
		const moved = baseInstance(project("a", { path: "/elsewhere/a" }));
		expect(moved).not.toBe(first);
		expect(moved.worktreePath).toBe("/elsewhere/a");
	});

	it("rebuilds it after the project was forgotten", () => {
		const first = baseInstance(project("a"));
		forgetProject("a");
		expect(baseInstance(project("a"))).not.toBe(first);
	});
});

describe("forgetting a project", () => {
	beforeEach(async () => {
		listInstances.mockReset();
		listInstances.mockResolvedValue([instance("a1", "a")]);
		await loadInstances("a");
	});

	it("drops the instances it had read", () => {
		expect(hasInstances("a")).toBe(true);
		forgetProject("a");
		expect(hasInstances("a")).toBe(false);
	});

	it("is run when the project is removed", async () => {
		await runProjectTeardowns("a");
		expect(hasInstances("a")).toBe(false);
	});

	it("knows a project only once its instances were read", () => {
		expect(hasInstances("never-read")).toBe(false);
	});
});
