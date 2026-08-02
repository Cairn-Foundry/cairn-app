import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { activeProjectId, projects } from "$lib/stores/project";
import type { Instance } from "$lib/types/instance";
import type { Project } from "$lib/types/project";
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

vi.mock("./agent-activity", () => ({ clearProjectAgentActivity: vi.fn() }));

function project(id: string, activeInstanceId: string | null): Project {
	return {
		id,
		name: id,
		path: `/repos/${id}`,
		color: "#fff",
		activeInstanceId,
	} as Project;
}

function instance(id: string, projectId: string): Instance {
	return {
		id,
		projectId,
		ticket: { id, title: id },
		branch: id,
		worktreePath: `/worktrees/${projectId}/${id}`,
		status: "idle",
		createdAt: 0,
		baseBranch: "main",
	};
}

describe("activeInstance across a project switch", () => {
	beforeEach(() => {
		listInstances.mockReset();
		projects.set([project("a", "a1"), project("b", "b1")]);
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
		projects.set([project("a", BASE_INSTANCE_ID)]);
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
