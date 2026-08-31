// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectFolder } from "$lib/types/project";

const saveFolders = vi.hoisted(() => vi.fn());
vi.mock("$lib/services/project-service", () => ({ saveFolders }));

import { projectFolders } from "./project-folders";

function folder(overrides: Partial<ProjectFolder> = {}): ProjectFolder {
	return {
		id: "f1",
		name: "Folder",
		projectIds: [],
		collapsed: false,
		...overrides,
	};
}

const current = () => get(projectFolders);
/** The folders as they were last persisted. */
const lastSaved = () => saveFolders.mock.calls.at(-1)?.[0] as ProjectFolder[];

beforeEach(() => {
	saveFolders.mockReset();
	saveFolders.mockResolvedValue(undefined);
	projectFolders.init([]);
});

describe("init", () => {
	it("seeds the folders read from disk", () => {
		const folders = [folder({ id: "a" }), folder({ id: "b" })];
		projectFolders.init(folders);
		expect(current()).toEqual(folders);
	});

	it("writes nothing back, since it is what was just read", () => {
		projectFolders.init([folder()]);
		expect(saveFolders).not.toHaveBeenCalled();
	});

	it("replaces what was there rather than appending", () => {
		projectFolders.init([folder({ id: "a" })]);
		projectFolders.init([folder({ id: "b" })]);
		expect(current().map((f) => f.id)).toEqual(["b"]);
	});
});

describe("createFolder", () => {
	it("appends an empty folder with the name it is given", () => {
		projectFolders.createFolder("Work");
		expect(current()).toHaveLength(1);
		expect(current()[0]).toMatchObject({ name: "Work", projectIds: [] });
	});

	it("trims the name", () => {
		projectFolders.createFolder("  Work  ");
		expect(current()[0].name).toBe("Work");
	});

	it("falls back to a default name when given a blank one", () => {
		projectFolders.createFolder("   ");
		expect(current()[0].name.length).toBeGreaterThan(0);
	});

	it("mints a distinct id for every folder", () => {
		projectFolders.createFolder("A");
		projectFolders.createFolder("B");
		const [a, b] = current();
		expect(a.id).not.toBe(b.id);
	});

	it("starts a folder unfolded", () => {
		projectFolders.createFolder("A");
		expect(current()[0].collapsed).toBe(false);
	});

	it("persists the new list", () => {
		projectFolders.createFolder("A");
		expect(lastSaved()).toHaveLength(1);
	});
});

describe("renameFolder", () => {
	it("renames the folder", () => {
		projectFolders.init([folder({ id: "a", name: "Old" })]);
		projectFolders.renameFolder("a", "New");
		expect(current()[0].name).toBe("New");
	});

	it("keeps the old name rather than applying a blank one", () => {
		projectFolders.init([folder({ id: "a", name: "Old" })]);
		projectFolders.renameFolder("a", "   ");
		expect(current()[0].name).toBe("Old");
	});

	it("leaves the other folders alone", () => {
		projectFolders.init([
			folder({ id: "a", name: "A" }),
			folder({ id: "b", name: "B" }),
		]);
		projectFolders.renameFolder("a", "Renamed");
		expect(current()[1].name).toBe("B");
	});

	it("does nothing for an id no folder carries", () => {
		projectFolders.init([folder({ id: "a", name: "A" })]);
		projectFolders.renameFolder("gone", "New");
		expect(current()[0].name).toBe("A");
	});
});

describe("deleteFolder", () => {
	it("removes the folder", () => {
		projectFolders.init([folder({ id: "a" }), folder({ id: "b" })]);
		projectFolders.deleteFolder("a");
		expect(current().map((f) => f.id)).toEqual(["b"]);
	});

	it("leaves its projects registered, ungrouped", () => {
		projectFolders.init([folder({ id: "a", projectIds: ["p1"] })]);
		projectFolders.deleteFolder("a");
		expect(current()).toEqual([]);
	});

	it("does nothing for an id no folder carries", () => {
		projectFolders.init([folder({ id: "a" })]);
		projectFolders.deleteFolder("gone");
		expect(current()).toHaveLength(1);
	});
});

describe("toggleCollapse", () => {
	it("folds an open folder and unfolds it again", () => {
		projectFolders.init([folder({ id: "a", collapsed: false })]);
		projectFolders.toggleCollapse("a");
		expect(current()[0].collapsed).toBe(true);
		projectFolders.toggleCollapse("a");
		expect(current()[0].collapsed).toBe(false);
	});

	it("persists the state, so a restart reopens the same way", () => {
		projectFolders.init([folder({ id: "a" })]);
		projectFolders.toggleCollapse("a");
		expect(lastSaved()[0].collapsed).toBe(true);
	});

	it("leaves the other folders alone", () => {
		projectFolders.init([folder({ id: "a" }), folder({ id: "b" })]);
		projectFolders.toggleCollapse("a");
		expect(current()[1].collapsed).toBe(false);
	});
});

describe("addProjectToFolder", () => {
	it("puts the project in the folder", () => {
		projectFolders.init([folder({ id: "a" })]);
		projectFolders.addProjectToFolder("p1", "a");
		expect(current()[0].projectIds).toEqual(["p1"]);
	});

	it("keeps membership exclusive, removing it from any other folder", () => {
		projectFolders.init([
			folder({ id: "a", projectIds: ["p1"] }),
			folder({ id: "b" }),
		]);
		projectFolders.addProjectToFolder("p1", "b");
		expect(current()[0].projectIds).toEqual([]);
		expect(current()[1].projectIds).toEqual(["p1"]);
	});

	it("adds the project once when it is already there", () => {
		projectFolders.init([folder({ id: "a", projectIds: ["p1"] })]);
		projectFolders.addProjectToFolder("p1", "a");
		expect(current()[0].projectIds).toEqual(["p1"]);
	});

	it("appends after the projects already in the folder", () => {
		projectFolders.init([folder({ id: "a", projectIds: ["p1"] })]);
		projectFolders.addProjectToFolder("p2", "a");
		expect(current()[0].projectIds).toEqual(["p1", "p2"]);
	});

	it("only strips the project when the target folder does not exist", () => {
		projectFolders.init([folder({ id: "a", projectIds: ["p1"] })]);
		projectFolders.addProjectToFolder("p1", "gone");
		expect(current()[0].projectIds).toEqual([]);
	});
});

describe("removeProjectFromFolder", () => {
	it("sends the project back to the ungrouped list", () => {
		projectFolders.init([folder({ id: "a", projectIds: ["p1", "p2"] })]);
		projectFolders.removeProjectFromFolder("p1");
		expect(current()[0].projectIds).toEqual(["p2"]);
	});

	it("clears it from every folder it might sit in", () => {
		projectFolders.init([
			folder({ id: "a", projectIds: ["p1"] }),
			folder({ id: "b", projectIds: ["p1"] }),
		]);
		projectFolders.removeProjectFromFolder("p1");
		expect(current().every((f) => f.projectIds.length === 0)).toBe(true);
	});

	it("does nothing for a project in no folder", () => {
		projectFolders.init([folder({ id: "a", projectIds: ["p1"] })]);
		projectFolders.removeProjectFromFolder("p2");
		expect(current()[0].projectIds).toEqual(["p1"]);
	});
});

describe("reorderFolders", () => {
	it("applies the order it is given", () => {
		projectFolders.init([
			folder({ id: "a" }),
			folder({ id: "b" }),
			folder({ id: "c" }),
		]);
		projectFolders.reorderFolders(["c", "a", "b"]);
		expect(current().map((f) => f.id)).toEqual(["c", "a", "b"]);
	});

	it("ignores an id no folder carries", () => {
		projectFolders.init([folder({ id: "a" })]);
		projectFolders.reorderFolders(["gone", "a"]);
		expect(current().map((f) => f.id)).toEqual(["a"]);
	});

	/**
	 * The order must list every folder: one left out is dropped, as the
	 * function documents. Callers pass the whole list after a drag.
	 */
	it("drops a folder the order leaves out", () => {
		projectFolders.init([folder({ id: "a" }), folder({ id: "b" })]);
		projectFolders.reorderFolders(["a"]);
		expect(current().map((f) => f.id)).toEqual(["a"]);
	});

	it("empties the list when given nothing", () => {
		projectFolders.init([folder({ id: "a" })]);
		projectFolders.reorderFolders([]);
		expect(current()).toEqual([]);
	});
});

describe("reorderProjectsInFolder", () => {
	it("reorders the projects of one folder", () => {
		projectFolders.init([folder({ id: "a", projectIds: ["p1", "p2"] })]);
		projectFolders.reorderProjectsInFolder("a", ["p2", "p1"]);
		expect(current()[0].projectIds).toEqual(["p2", "p1"]);
	});

	it("leaves the other folders alone", () => {
		projectFolders.init([
			folder({ id: "a", projectIds: ["p1"] }),
			folder({ id: "b", projectIds: ["p2"] }),
		]);
		projectFolders.reorderProjectsInFolder("a", ["p1"]);
		expect(current()[1].projectIds).toEqual(["p2"]);
	});

	it("does nothing for an id no folder carries", () => {
		projectFolders.init([folder({ id: "a", projectIds: ["p1"] })]);
		projectFolders.reorderProjectsInFolder("gone", ["p2"]);
		expect(current()[0].projectIds).toEqual(["p1"]);
	});
});

describe("purgeProject", () => {
	it("clears every reference to an unregistered project", () => {
		projectFolders.init([
			folder({ id: "a", projectIds: ["p1", "p2"] }),
			folder({ id: "b", projectIds: ["p1"] }),
		]);
		projectFolders.purgeProject("p1");
		expect(current()[0].projectIds).toEqual(["p2"]);
		expect(current()[1].projectIds).toEqual([]);
	});

	it("keeps the folders themselves", () => {
		projectFolders.init([folder({ id: "a", projectIds: ["p1"] })]);
		projectFolders.purgeProject("p1");
		expect(current()).toHaveLength(1);
	});

	it("persists the purge", () => {
		projectFolders.init([folder({ id: "a", projectIds: ["p1"] })]);
		projectFolders.purgeProject("p1");
		expect(lastSaved()[0].projectIds).toEqual([]);
	});
});

describe("persistence", () => {
	it("writes on every mutation", () => {
		projectFolders.init([folder({ id: "a" })]);
		projectFolders.createFolder("B");
		projectFolders.renameFolder("a", "A2");
		projectFolders.toggleCollapse("a");
		expect(saveFolders).toHaveBeenCalledTimes(3);
	});

	it("keeps the change on screen when the write fails", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		saveFolders.mockRejectedValue(new Error("EACCES"));
		projectFolders.createFolder("A");
		await Promise.resolve();
		expect(current()).toHaveLength(1);
	});
});
