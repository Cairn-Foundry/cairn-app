// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomCommand } from "$lib/services/custom-command-service";
import { DEFAULT_COMMAND_ICON } from "$lib/utils/icons";

const saveProjectCommands = vi.hoisted(() => vi.fn());
const saveGlobalCommands = vi.hoisted(() => vi.fn());
vi.mock("$lib/services/custom-command-service", () => ({
	saveProjectCommands,
	saveGlobalCommands,
	getProjectCommands: vi.fn().mockResolvedValue([]),
	getGlobalCommands: vi.fn().mockResolvedValue([]),
	getCommandState: vi.fn().mockResolvedValue(null),
	saveCommandState: vi.fn().mockResolvedValue(undefined),
}));

import {
	addCommand,
	addCommands,
	duplicateCommand,
	globalCommands,
	moveCommandToScope,
	newCommand,
	projectCommands,
	removeCommand,
	reorderCommand,
	toggleCommandPinned,
	updateCommand,
} from "./custom-command";

const globalList = () => get(globalCommands);
const projectList = (id = "p1") => get(projectCommands)[id] ?? [];
const names = (list: CustomCommand[]) => list.map((c) => c.name);

beforeEach(() => {
	vi.clearAllMocks();
	saveProjectCommands.mockResolvedValue(undefined);
	saveGlobalCommands.mockResolvedValue(undefined);
	globalCommands.set([]);
	projectCommands.set({});
});

describe("newCommand", () => {
	it("names the command and gives it a distinct id", () => {
		const a = newCommand("Build");
		const b = newCommand("Build");
		expect(a.name).toBe("Build");
		expect(a.id).not.toBe(b.id);
	});

	it("starts with one empty step, pinned, stopping on error", () => {
		expect(newCommand("Build")).toMatchObject({
			steps: [""],
			pinned: true,
			stopOnError: true,
			cwd: "worktree",
			autoClose: false,
			confirm: false,
			source: "manual",
		});
	});

	it("uses the default icon, which the picker offers", () => {
		expect(newCommand("Build").icon).toBe(DEFAULT_COMMAND_ICON);
	});
});

describe("addCommand", () => {
	it("appends to the project scope", () => {
		addCommand("project", "p1", newCommand("Build"));
		expect(names(projectList())).toEqual(["Build"]);
	});

	it("appends to the global scope", () => {
		addCommand("global", "p1", newCommand("Build"));
		expect(names(globalList())).toEqual(["Build"]);
	});

	it("keeps the scopes apart", () => {
		addCommand("project", "p1", newCommand("P"));
		addCommand("global", "p1", newCommand("G"));
		expect(names(projectList())).toEqual(["P"]);
		expect(names(globalList())).toEqual(["G"]);
	});

	it("keeps two projects apart", () => {
		addCommand("project", "p1", newCommand("A"));
		addCommand("project", "p2", newCommand("B"));
		expect(names(projectList("p1"))).toEqual(["A"]);
		expect(names(projectList("p2"))).toEqual(["B"]);
	});

	it("persists the scope it changed", () => {
		addCommand("project", "p1", newCommand("Build"));
		expect(saveProjectCommands).toHaveBeenCalled();
		expect(saveGlobalCommands).not.toHaveBeenCalled();
	});

	it("appends several at once, in order", () => {
		addCommands("project", "p1", [newCommand("A"), newCommand("B")]);
		expect(names(projectList())).toEqual(["A", "B"]);
	});
});

describe("updateCommand", () => {
	it("replaces a command by id, keeping its position", () => {
		const a = newCommand("A");
		addCommands("project", "p1", [a, newCommand("B")]);
		updateCommand("project", "p1", { ...a, name: "renamed" });
		expect(names(projectList())).toEqual(["renamed", "B"]);
	});

	it("leaves the list alone for an id it does not carry", () => {
		addCommand("project", "p1", newCommand("A"));
		updateCommand("project", "p1", newCommand("ghost"));
		expect(names(projectList())).toEqual(["A"]);
	});
});

describe("removeCommand", () => {
	it("deletes the command", () => {
		const a = newCommand("A");
		addCommands("project", "p1", [a, newCommand("B")]);
		removeCommand("project", "p1", a.id);
		expect(names(projectList())).toEqual(["B"]);
	});

	it("does nothing for an id the scope does not carry", () => {
		addCommand("project", "p1", newCommand("A"));
		removeCommand("project", "p1", "ghost");
		expect(projectList()).toHaveLength(1);
	});
});

describe("duplicateCommand", () => {
	it("copies the command under a new name", () => {
		const a = newCommand("Build");
		addCommand("project", "p1", a);
		duplicateCommand("project", "p1", a.id, "Build copy");
		expect(names(projectList())).toEqual(["Build", "Build copy"]);
	});

	it("gives the copy its own id, so editing one leaves the other alone", () => {
		const a = newCommand("Build");
		addCommand("project", "p1", a);
		duplicateCommand("project", "p1", a.id, "copy");
		expect(projectList()[1].id).not.toBe(a.id);
	});

	it("copies the steps and the settings", () => {
		const a = { ...newCommand("Build"), steps: ["one", "two"], confirm: true };
		addCommand("project", "p1", a);
		duplicateCommand("project", "p1", a.id, "copy");
		expect(projectList()[1]).toMatchObject({
			steps: ["one", "two"],
			confirm: true,
		});
	});

	it("does nothing for an id the scope does not carry", () => {
		addCommand("project", "p1", newCommand("A"));
		duplicateCommand("project", "p1", "ghost", "copy");
		expect(projectList()).toHaveLength(1);
	});
});

describe("toggleCommandPinned", () => {
	it("unpins a pinned command and pins it back", () => {
		const a = newCommand("A");
		addCommand("project", "p1", a);
		toggleCommandPinned("project", "p1", a.id);
		expect(projectList()[0].pinned).toBe(false);
		toggleCommandPinned("project", "p1", a.id);
		expect(projectList()[0].pinned).toBe(true);
	});

	it("leaves the other commands alone", () => {
		const a = newCommand("A");
		addCommands("project", "p1", [a, newCommand("B")]);
		toggleCommandPinned("project", "p1", a.id);
		expect(projectList()[1].pinned).toBe(true);
	});
});

describe("moveCommandToScope", () => {
	it("moves a project command to the global scope", () => {
		const a = newCommand("A");
		addCommand("project", "p1", a);
		moveCommandToScope("project", "global", "p1", a.id, 0);
		expect(names(globalList())).toEqual(["A"]);
		expect(projectList()).toEqual([]);
	});

	it("moves a global command down to a project", () => {
		const a = newCommand("A");
		addCommand("global", "p1", a);
		moveCommandToScope("global", "project", "p1", a.id, 0);
		expect(names(projectList())).toEqual(["A"]);
		expect(globalList()).toEqual([]);
	});

	it("keeps the command intact across the move", () => {
		const a = { ...newCommand("A"), steps: ["run"], pinned: false };
		addCommand("project", "p1", a);
		moveCommandToScope("project", "global", "p1", a.id, 0);
		expect(globalList()[0]).toEqual(a);
	});

	it("inserts at the position the drop asked for", () => {
		const c = newCommand("C");
		addCommands("global", "p1", [newCommand("A"), newCommand("B")]);
		addCommand("project", "p1", c);
		moveCommandToScope("project", "global", "p1", c.id, 1);
		expect(names(globalList())).toEqual(["A", "C", "B"]);
	});

	it("clamps an insertion point past the end", () => {
		const a = newCommand("A");
		addCommand("project", "p1", a);
		addCommand("global", "p1", newCommand("G"));
		moveCommandToScope("project", "global", "p1", a.id, 99);
		expect(names(globalList())).toEqual(["G", "A"]);
	});

	it("clamps a negative insertion point", () => {
		const a = newCommand("A");
		addCommand("project", "p1", a);
		addCommand("global", "p1", newCommand("G"));
		moveCommandToScope("project", "global", "p1", a.id, -5);
		expect(names(globalList())).toEqual(["A", "G"]);
	});

	it("does nothing when the two scopes are the same", () => {
		const a = newCommand("A");
		addCommands("project", "p1", [a, newCommand("B")]);
		moveCommandToScope("project", "project", "p1", a.id, 2);
		expect(names(projectList())).toEqual(["A", "B"]);
	});

	it("does nothing for a command the source scope does not carry", () => {
		addCommand("project", "p1", newCommand("A"));
		moveCommandToScope("project", "global", "p1", "ghost", 0);
		expect(projectList()).toHaveLength(1);
		expect(globalList()).toEqual([]);
	});

	it("persists both scopes, since both lists changed", () => {
		const a = newCommand("A");
		addCommand("project", "p1", a);
		vi.clearAllMocks();
		moveCommandToScope("project", "global", "p1", a.id, 0);
		expect(saveProjectCommands).toHaveBeenCalled();
		expect(saveGlobalCommands).toHaveBeenCalled();
	});
});

describe("reorderCommand", () => {
	it("moves a command later in its scope", () => {
		addCommands("project", "p1", [
			newCommand("A"),
			newCommand("B"),
			newCommand("C"),
		]);
		reorderCommand("project", "p1", 0, 2);
		expect(names(projectList())).toEqual(["B", "A", "C"]);
	});

	it("moves a command earlier in its scope", () => {
		addCommands("project", "p1", [
			newCommand("A"),
			newCommand("B"),
			newCommand("C"),
		]);
		reorderCommand("project", "p1", 2, 0);
		expect(names(projectList())).toEqual(["C", "A", "B"]);
	});

	it("keeps the order when the command does not move", () => {
		addCommands("project", "p1", [newCommand("A"), newCommand("B")]);
		reorderCommand("project", "p1", 1, 1);
		expect(names(projectList())).toEqual(["A", "B"]);
	});

	it("does not crash on a project with no command", () => {
		expect(() => reorderCommand("project", "empty", 0, 1)).not.toThrow();
	});
});
