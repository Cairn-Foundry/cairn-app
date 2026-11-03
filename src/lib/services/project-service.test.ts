// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "#lib/types/project.ts";
import {
	addProject,
	cloneRepository,
	duplicateProject,
	getListing,
	getProjectGitProfile,
	listProjects,
	relocateProject,
	removeProject,
	revealInFileManager,
	saveFolders,
	saveProjectOrder,
	setActiveInstance,
	setProjectGitProfile,
	updateProject,
	validateDirectory,
} from "./project-service";

const mockInvoke = vi.mocked(invoke);

const PROJECT = { id: "p1", name: "Alpha" } as unknown as Project;
const LIST = [PROJECT];

beforeEach(() => {
	mockInvoke.mockReset();
	mockInvoke.mockResolvedValue(undefined);
});

describe("project list", () => {
	it("lists the projects", async () => {
		mockInvoke.mockResolvedValue(LIST);
		await expect(listProjects()).resolves.toBe(LIST);
		expect(mockInvoke).toHaveBeenCalledWith("list_projects");
	});

	it("adds a project and returns the new list", async () => {
		mockInvoke.mockResolvedValue(LIST);
		await expect(addProject(PROJECT)).resolves.toBe(LIST);
		expect(mockInvoke).toHaveBeenCalledWith("add_project", {
			project: PROJECT,
		});
	});

	it("removes a project and returns the new list", async () => {
		mockInvoke.mockResolvedValue(LIST);
		await expect(removeProject("p1")).resolves.toBe(LIST);
		expect(mockInvoke).toHaveBeenCalledWith("remove_project", { id: "p1" });
	});

	it("updates a project without a branch template by default", async () => {
		mockInvoke.mockResolvedValue(LIST);
		await expect(updateProject("p1", "Beta", "#fff")).resolves.toBe(LIST);
		expect(mockInvoke).toHaveBeenCalledWith("update_project", {
			id: "p1",
			name: "Beta",
			color: "#fff",
			branchTemplate: null,
		});
	});

	it("forwards a branch template", async () => {
		await updateProject("p1", "Beta", "#fff", "{id}-{slug}");
		expect(mockInvoke).toHaveBeenCalledWith("update_project", {
			id: "p1",
			name: "Beta",
			color: "#fff",
			branchTemplate: "{id}-{slug}",
		});
	});

	it("relocates a project", async () => {
		mockInvoke.mockResolvedValue(LIST);
		await expect(relocateProject("p1", "/new")).resolves.toBe(LIST);
		expect(mockInvoke).toHaveBeenCalledWith("relocate_project", {
			id: "p1",
			path: "/new",
		});
	});

	it("duplicates a project, flattening the copy options", async () => {
		mockInvoke.mockResolvedValue(LIST);
		await expect(
			duplicateProject("p1", "p2", {
				name: "Copy",
				color: "#000",
				destParent: "/parent",
				folderName: "copy",
			}),
		).resolves.toBe(LIST);
		expect(mockInvoke).toHaveBeenCalledWith("duplicate_project", {
			id: "p1",
			newId: "p2",
			name: "Copy",
			color: "#000",
			destParent: "/parent",
			folderName: "copy",
		});
	});
});

describe("project actions", () => {
	it("reveals a path in the file manager", async () => {
		await revealInFileManager("/repo");
		expect(mockInvoke).toHaveBeenCalledWith("reveal_in_file_manager", {
			path: "/repo",
		});
	});

	it("sets the active instance of a project", async () => {
		await setActiveInstance("p1", "i1");
		expect(mockInvoke).toHaveBeenCalledWith("set_active_instance", {
			projectId: "p1",
			instanceId: "i1",
		});
	});

	it("clears the active instance with null", async () => {
		await setActiveInstance("p1", null);
		expect(mockInvoke).toHaveBeenCalledWith("set_active_instance", {
			projectId: "p1",
			instanceId: null,
		});
	});

	it("validates a directory and returns its resolved path", async () => {
		mockInvoke.mockResolvedValue("/repo");
		await expect(validateDirectory("/repo/")).resolves.toBe("/repo");
		expect(mockInvoke).toHaveBeenCalledWith("validate_directory", {
			path: "/repo/",
		});
	});

	it("clones a repository and returns where it landed", async () => {
		mockInvoke.mockResolvedValue("/parent/name");
		await expect(
			cloneRepository("git@x:y.git", "/parent", "name"),
		).resolves.toBe("/parent/name");
		expect(mockInvoke).toHaveBeenCalledWith("clone_repository", {
			url: "git@x:y.git",
			destParent: "/parent",
			name: "name",
		});
	});
});

describe("git profile", () => {
	it("reads the profile of a project", async () => {
		mockInvoke.mockResolvedValue("work");
		await expect(getProjectGitProfile("p1")).resolves.toBe("work");
		expect(mockInvoke).toHaveBeenCalledWith("get_project_git_profile", {
			projectId: "p1",
		});
	});

	it("answers null when the read fails", async () => {
		mockInvoke.mockRejectedValue(new Error("disk"));
		await expect(getProjectGitProfile("p1")).resolves.toBeNull();
	});

	it("writes the profile of a project", async () => {
		await setProjectGitProfile("p1", "work");
		expect(mockInvoke).toHaveBeenCalledWith("set_project_git_profile", {
			projectId: "p1",
			profileId: "work",
		});
	});

	it("surfaces a failed profile write", async () => {
		mockInvoke.mockRejectedValue(new Error("disk"));
		await expect(setProjectGitProfile("p1", "work")).rejects.toThrow("disk");
	});
});

describe("listing", () => {
	it("reads the folders and the order", async () => {
		const listing = { folders: [], projectOrder: ["p1"] };
		mockInvoke.mockResolvedValue(listing);
		await expect(getListing()).resolves.toBe(listing);
		expect(mockInvoke).toHaveBeenCalledWith("get_listing");
	});

	it("saves the folders", async () => {
		const folders = [{ id: "f1" }] as unknown as Parameters<
			typeof saveFolders
		>[0];
		await saveFolders(folders);
		expect(mockInvoke).toHaveBeenCalledWith("save_folders", { folders });
	});

	it("saves the project order", async () => {
		await saveProjectOrder(["p2", "p1"]);
		expect(mockInvoke).toHaveBeenCalledWith("save_project_order", {
			ids: ["p2", "p1"],
		});
	});
});
