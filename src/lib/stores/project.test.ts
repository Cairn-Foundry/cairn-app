import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { project } from "../../test/fixtures";

const listProjects = vi.hoisted(() => vi.fn());
const addProject = vi.hoisted(() => vi.fn());
const removeProject = vi.hoisted(() => vi.fn());
const updateProject = vi.hoisted(() => vi.fn());
const duplicateProject = vi.hoisted(() => vi.fn());
const saveProjectOrder = vi.hoisted(() => vi.fn());
const setActiveInstance = vi.hoisted(() => vi.fn());
const getListing = vi.hoisted(() => vi.fn());

vi.mock("$lib/services/project-service", () => ({
	listProjects,
	addProject,
	removeProject,
	updateProject,
	duplicateProject,
	saveProjectOrder,
	setActiveInstance,
	getListing,
}));

const purgeProject = vi.hoisted(() => vi.fn());
const init = vi.hoisted(() => vi.fn());
vi.mock("$lib/stores/project-folders", () => ({
	projectFolders: { purgeProject, init },
}));

import {
	activateInstance,
	activeProject,
	activeProjectId,
	closeProjectTab,
	editProject,
	lastOpenedProjectId,
	loadListing,
	loadProjects,
	openProject,
	openProjects,
	openTabOrder,
	projects,
	registerProject,
	reorderProjects,
	reorderTabs,
	unregisterProject,
} from "./project";

const ids = () => get(projects).map((p) => p.id);

beforeEach(() => {
	vi.clearAllMocks();
	saveProjectOrder.mockResolvedValue(undefined);
	projects.set([]);
	activeProjectId.set(null);
	openTabOrder.set([]);
	lastOpenedProjectId.set(null);
});

describe("activeProject", () => {
	it("resolves the active id to its project", () => {
		projects.set([project("a"), project("b")]);
		activeProjectId.set("b");
		expect(get(activeProject)?.id).toBe("b");
	});

	it("is null while nothing is open", () => {
		projects.set([project("a")]);
		expect(get(activeProject)).toBeNull();
	});

	it("is null rather than stale when the active project is unregistered", () => {
		projects.set([project("a")]);
		activeProjectId.set("a");
		projects.set([]);
		expect(get(activeProject)).toBeNull();
	});

	it("follows a rename of the active project", () => {
		projects.set([project("a")]);
		activeProjectId.set("a");
		projects.set([project("a", { name: "renamed" })]);
		expect(get(activeProject)?.name).toBe("renamed");
	});
});

describe("openProjects", () => {
	it("resolves the tabs in tab order, not in list order", () => {
		projects.set([project("a"), project("b")]);
		openTabOrder.set(["b", "a"]);
		expect(get(openProjects).map((p) => p.id)).toEqual(["b", "a"]);
	});

	it("skips a tab whose project is no longer registered", () => {
		projects.set([project("a")]);
		openTabOrder.set(["a", "gone"]);
		expect(get(openProjects).map((p) => p.id)).toEqual(["a"]);
	});

	it("is empty when no tab is open", () => {
		projects.set([project("a")]);
		expect(get(openProjects)).toEqual([]);
	});
});

describe("openProject", () => {
	it("opens a tab", () => {
		openProject("a");
		expect(get(openTabOrder)).toEqual(["a"]);
	});

	it("opens no second tab for a project that already has one", () => {
		openProject("a");
		openProject("a");
		expect(get(openTabOrder)).toEqual(["a"]);
	});

	it("leaves an existing tab where it was", () => {
		openTabOrder.set(["a", "b"]);
		openProject("a");
		expect(get(openTabOrder)).toEqual(["a", "b"]);
	});

	it("appends a new tab at the end", () => {
		openTabOrder.set(["a"]);
		openProject("b");
		expect(get(openTabOrder)).toEqual(["a", "b"]);
	});
});

describe("closeProjectTab", () => {
	it("closes the tab", () => {
		openTabOrder.set(["a", "b"]);
		closeProjectTab("a");
		expect(get(openTabOrder)).toEqual(["b"]);
	});

	it("leaves the project registered", () => {
		projects.set([project("a")]);
		openTabOrder.set(["a"]);
		closeProjectTab("a");
		expect(ids()).toEqual(["a"]);
	});

	it("forgets it as the last opened one", () => {
		lastOpenedProjectId.set("a");
		closeProjectTab("a");
		expect(get(lastOpenedProjectId)).toBeNull();
	});

	it("keeps the last opened one when another tab is closed", () => {
		lastOpenedProjectId.set("a");
		openTabOrder.set(["a", "b"]);
		closeProjectTab("b");
		expect(get(lastOpenedProjectId)).toBe("a");
	});

	it("does nothing for a project with no tab", () => {
		openTabOrder.set(["a"]);
		closeProjectTab("b");
		expect(get(openTabOrder)).toEqual(["a"]);
	});
});

describe("reorderTabs", () => {
	it("commits the order a drag produced", () => {
		openTabOrder.set(["a", "b", "c"]);
		reorderTabs(["c", "a", "b"]);
		expect(get(openTabOrder)).toEqual(["c", "a", "b"]);
	});
});

describe("loadProjects", () => {
	it("replaces the list with what the backend reports", async () => {
		listProjects.mockResolvedValue([project("a"), project("b")]);
		await loadProjects();
		expect(ids()).toEqual(["a", "b"]);
	});

	it("empties the list when nothing is registered", async () => {
		projects.set([project("stale")]);
		listProjects.mockResolvedValue([]);
		await loadProjects();
		expect(ids()).toEqual([]);
	});
});

describe("registerProject", () => {
	it("takes the list the backend answers with, not the one it sent", async () => {
		addProject.mockResolvedValue([project("a"), project("b")]);
		await registerProject(project("b"));
		expect(ids()).toEqual(["a", "b"]);
	});
});

describe("activateInstance", () => {
	it("persists before touching the store", async () => {
		const order: string[] = [];
		setActiveInstance.mockImplementation(async () => {
			order.push("persist");
		});
		projects.set([project("a")]);
		await activateInstance("a", "i1");
		order.push("store");
		expect(order).toEqual(["persist", "store"]);
	});

	it("records the instance on its project", async () => {
		setActiveInstance.mockResolvedValue(undefined);
		projects.set([project("a"), project("b")]);
		await activateInstance("a", "i1");
		expect(get(projects)[0].activeInstanceId).toBe("i1");
		expect(get(projects)[1].activeInstanceId).toBeNull();
	});

	it("clears the instance when given null", async () => {
		setActiveInstance.mockResolvedValue(undefined);
		projects.set([project("a", { activeInstanceId: "i1" })]);
		await activateInstance("a", null);
		expect(get(projects)[0].activeInstanceId).toBeNull();
	});

	it("leaves the store alone when the write fails", async () => {
		setActiveInstance.mockRejectedValue(new Error("EACCES"));
		projects.set([project("a")]);
		await expect(activateInstance("a", "i1")).rejects.toThrow();
		expect(get(projects)[0].activeInstanceId).toBeNull();
	});
});

describe("unregisterProject", () => {
	it("takes the list the backend answers with", async () => {
		removeProject.mockResolvedValue([project("b")]);
		projects.set([project("a"), project("b")]);
		await unregisterProject("a");
		expect(ids()).toEqual(["b"]);
	});

	it("clears the active id when the active project goes", async () => {
		removeProject.mockResolvedValue([]);
		activeProjectId.set("a");
		await unregisterProject("a");
		expect(get(activeProjectId)).toBeNull();
	});

	it("keeps the active id when another project goes", async () => {
		removeProject.mockResolvedValue([project("a")]);
		activeProjectId.set("a");
		await unregisterProject("b");
		expect(get(activeProjectId)).toBe("a");
	});

	it("drops the project from its folder", async () => {
		removeProject.mockResolvedValue([]);
		await unregisterProject("a");
		expect(purgeProject).toHaveBeenCalledWith("a");
	});
});

describe("editProject", () => {
	it("takes the renamed list from the backend", async () => {
		updateProject.mockResolvedValue([project("a", { name: "new name" })]);
		await editProject("a", "new name", "#000");
		expect(get(projects)[0].name).toBe("new name");
	});
});

describe("reorderProjects", () => {
	it("applies the new order", () => {
		projects.set([project("a"), project("b"), project("c")]);
		reorderProjects(["c", "b", "a"]);
		expect(ids()).toEqual(["c", "b", "a"]);
	});

	it("keeps the projects the drag did not cover, after the reordered ones", () => {
		projects.set([project("a"), project("b"), project("c")]);
		reorderProjects(["c"]);
		expect(ids()).toEqual(["c", "a", "b"]);
	});

	it("ignores an id no project carries", () => {
		projects.set([project("a")]);
		reorderProjects(["gone", "a"]);
		expect(ids()).toEqual(["a"]);
	});

	it("persists the order it was given", () => {
		projects.set([project("a"), project("b")]);
		reorderProjects(["b", "a"]);
		expect(saveProjectOrder).toHaveBeenCalledWith(["b", "a"]);
	});

	it("keeps the new order on screen even when the write fails", async () => {
		saveProjectOrder.mockRejectedValue(new Error("EACCES"));
		vi.spyOn(console, "error").mockImplementation(() => {});
		projects.set([project("a"), project("b")]);
		reorderProjects(["b", "a"]);
		await Promise.resolve();
		expect(ids()).toEqual(["b", "a"]);
	});
});

describe("loadListing", () => {
	it("applies the saved project order", async () => {
		getListing.mockResolvedValue({ folders: [], projectOrder: ["c", "a"] });
		projects.set([project("a"), project("b"), project("c")]);
		await loadListing();
		expect(ids()).toEqual(["c", "a", "b"]);
	});

	it("leaves the order alone when nothing was saved", async () => {
		getListing.mockResolvedValue({ folders: [], projectOrder: [] });
		projects.set([project("a"), project("b")]);
		await loadListing();
		expect(ids()).toEqual(["a", "b"]);
	});

	it("ignores an id in the saved order that is no longer registered", async () => {
		getListing.mockResolvedValue({ folders: [], projectOrder: ["gone", "a"] });
		projects.set([project("a")]);
		await loadListing();
		expect(ids()).toEqual(["a"]);
	});

	it("keeps a project the saved order predates", async () => {
		getListing.mockResolvedValue({ folders: [], projectOrder: ["a"] });
		projects.set([project("a"), project("new")]);
		await loadListing();
		expect(ids()).toEqual(["a", "new"]);
	});

	it("hands the saved folders to the folder store", async () => {
		const folders = [{ id: "f", name: "F", projectIds: [], collapsed: false }];
		getListing.mockResolvedValue({ folders, projectOrder: [] });
		await loadListing();
		expect(init).toHaveBeenCalledWith(folders);
	});
});
