// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Terminals are scoped two ways: per instance and per project. Moving one
// across scopes must move the lists only - the PTY keeps running - which is
// what most of these tests pin down.

import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

const saveTerminalState = vi.hoisted(() => vi.fn());
const saveProjectTerminalState = vi.hoisted(() => vi.fn());
const closeTerminal = vi.hoisted(() => vi.fn());
const getTerminalState = vi.hoisted(() => vi.fn());
const getProjectTerminalState = vi.hoisted(() => vi.fn());
const createTerminal = vi.hoisted(() => vi.fn());
const closeAllTerminals = vi.hoisted(() => vi.fn());
const managerCreate = vi.hoisted(() => vi.fn());
const managerDispose = vi.hoisted(() => vi.fn());

vi.mock("#lib/services/terminal-service", () => ({
	saveTerminalState,
	saveProjectTerminalState,
	getTerminalState,
	getProjectTerminalState,
	closeTerminal,
	createTerminal,
	closeAllTerminals,
	killOrphanTerminals: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("#lib/utils/terminal/terminal-manager", () => ({
	create: managerCreate,
	dispose: managerDispose,
	size: () => ({ cols: 80, rows: 24 }),
}));

import {
	activeTerminalId,
	addCommandTerminal,
	addProjectTerminal,
	addTerminal,
	closeSplitTerminal,
	DEFAULT_SPLIT_RATIO,
	openSplitTerminal,
	projectTerminals,
	removeInstanceTerminals,
	removeProjectTerminal,
	removeTerminal,
	renameProjectTerminal,
	renameTerminal,
	reorderProjectTerminal,
	reorderTerminal,
	restoreProjectTerminals,
	restoreTerminals,
	setActiveTerminal,
	setSplitRatio,
	shareTerminal,
	splitTerminalId,
	splitTerminalRatio,
	terminalScope,
	terminalSessions,
	unshareTerminal,
} from "./terminal";

const KEY = terminalScope("p1", "i1");

const session = (id: string, title = id) => ({ id, title });
/** A shared terminal, which unlike an instance one carries where it respawns. */
const shared = (id: string, title = id, cwd: string | null = null) => ({
	id,
	title,
	cwd,
});

/** The instance-scoped terminals of p1:i1. */
const instanceList = () => get(terminalSessions)[KEY] ?? [];
/** The project-scoped terminals of p1. */
const projectList = () => get(projectTerminals).p1 ?? [];

beforeEach(() => {
	vi.clearAllMocks();
	saveTerminalState.mockResolvedValue(undefined);
	saveProjectTerminalState.mockResolvedValue(undefined);
	closeTerminal.mockResolvedValue(undefined);
	createTerminal.mockResolvedValue(undefined);
	getTerminalState.mockResolvedValue(null);
	getProjectTerminalState.mockResolvedValue(null);
	terminalSessions.set({});
	projectTerminals.set({});
	activeTerminalId.set({});
	splitTerminalId.set({});
	splitTerminalRatio.set({});
});

describe("terminalScope", () => {
	it("keys the instance maps by project and instance", () => {
		expect(terminalScope("p", "i")).toBe("p:i");
	});

	it("keeps two instances of one project apart", () => {
		expect(terminalScope("p", "a")).not.toBe(terminalScope("p", "b"));
	});
});

describe("shareTerminal", () => {
	beforeEach(() => {
		terminalSessions.set({ [KEY]: [session("t1"), session("t2")] });
	});

	it("moves the terminal out of the instance list", () => {
		shareTerminal("p1", "i1", "t1", "/cwd", 0);
		expect(instanceList().map((s) => s.id)).toEqual(["t2"]);
	});

	it("moves it into the project list", () => {
		shareTerminal("p1", "i1", "t1", "/cwd", 0);
		expect(projectList().map((s) => s.id)).toEqual(["t1"]);
	});

	it("never closes the PTY, so the session keeps running", () => {
		shareTerminal("p1", "i1", "t1", "/cwd", 0);
		expect(closeTerminal).not.toHaveBeenCalled();
	});

	it("records the worktree it was created in, so it respawns there", () => {
		shareTerminal("p1", "i1", "t1", "/worktrees/p1/i1", 0);
		expect(projectList()[0]).toMatchObject({ cwd: "/worktrees/p1/i1" });
	});

	it("keeps the title the user gave it", () => {
		terminalSessions.set({ [KEY]: [session("t1", "build")] });
		shareTerminal("p1", "i1", "t1", null, 0);
		expect(projectList()[0].title).toBe("build");
	});

	it("inserts at the position the drop asked for", () => {
		projectTerminals.set({ p1: [shared("a"), shared("b")] });
		shareTerminal("p1", "i1", "t1", null, 1);
		expect(projectList().map((s) => s.id)).toEqual(["a", "t1", "b"]);
	});

	it("does nothing for a terminal the instance does not have", () => {
		shareTerminal("p1", "i1", "unknown", null, 0);
		expect(instanceList()).toHaveLength(2);
		expect(projectList()).toEqual([]);
	});

	it("persists both scopes, since both lists changed", () => {
		shareTerminal("p1", "i1", "t1", null, 0);
		expect(saveTerminalState).toHaveBeenCalledWith("p1", "i1", {
			terminals: [session("t2")],
			activeId: null,
			splitId: null,
			splitRatio: expect.any(Number),
		});
		expect(saveProjectTerminalState).toHaveBeenCalledWith("p1", {
			terminals: [shared("t1")],
		});
	});
});

describe("unshareTerminal", () => {
	beforeEach(() => {
		projectTerminals.set({
			p1: [shared("t1", "t1", "/cwd"), shared("t2")],
		});
	});

	it("moves the terminal out of the project list", () => {
		unshareTerminal("p1", "i1", "t1", 0);
		expect(projectList().map((s) => s.id)).toEqual(["t2"]);
	});

	it("moves it into the instance list", () => {
		unshareTerminal("p1", "i1", "t1", 0);
		expect(instanceList().map((s) => s.id)).toEqual(["t1"]);
	});

	it("never closes the PTY", () => {
		unshareTerminal("p1", "i1", "t1", 0);
		expect(closeTerminal).not.toHaveBeenCalled();
	});

	it("drops the cwd, which only a shared terminal carries", () => {
		unshareTerminal("p1", "i1", "t1", 0);
		expect(instanceList()[0]).toEqual({ id: "t1", title: "t1" });
	});

	it("inserts at the position the drop asked for", () => {
		terminalSessions.set({ [KEY]: [session("a"), session("b")] });
		unshareTerminal("p1", "i1", "t1", 1);
		expect(instanceList().map((s) => s.id)).toEqual(["a", "t1", "b"]);
	});

	it("does nothing for a terminal the project does not share", () => {
		unshareTerminal("p1", "i1", "unknown", 0);
		expect(projectList()).toHaveLength(2);
		expect(instanceList()).toEqual([]);
	});

	it("round-trips a terminal back to where it started", () => {
		terminalSessions.set({ [KEY]: [] });
		unshareTerminal("p1", "i1", "t1", 0);
		shareTerminal("p1", "i1", "t1", "/cwd", 0);
		expect(projectList().map((s) => s.id)).toContain("t1");
		expect(instanceList()).toEqual([]);
		expect(closeTerminal).not.toHaveBeenCalled();
	});
});

describe("reorderTerminal", () => {
	beforeEach(() => {
		terminalSessions.set({
			[KEY]: [session("a"), session("b"), session("c")],
		});
	});

	it("moves a terminal later in the list", () => {
		reorderTerminal("p1", "i1", 0, 2);
		expect(instanceList().map((s) => s.id)).toEqual(["b", "a", "c"]);
	});

	it("moves a terminal earlier in the list", () => {
		reorderTerminal("p1", "i1", 2, 0);
		expect(instanceList().map((s) => s.id)).toEqual(["c", "a", "b"]);
	});

	it("keeps the list when the terminal does not move", () => {
		reorderTerminal("p1", "i1", 1, 1);
		expect(instanceList().map((s) => s.id)).toEqual(["a", "b", "c"]);
	});

	it("persists the new order", () => {
		reorderTerminal("p1", "i1", 0, 2);
		expect(saveTerminalState).toHaveBeenCalledWith(
			"p1",
			"i1",
			expect.objectContaining({ terminals: instanceList() }),
		);
	});

	it("does not crash on an instance with no terminal", () => {
		expect(() => reorderTerminal("p1", "other", 0, 1)).not.toThrow();
	});
});

describe("reorderProjectTerminal", () => {
	it("reorders the shared terminals", () => {
		projectTerminals.set({ p1: [shared("a"), shared("b")] });
		reorderProjectTerminal("p1", 0, 2);
		expect(projectList().map((s) => s.id)).toEqual(["b", "a"]);
	});

	it("persists the new order", () => {
		projectTerminals.set({ p1: [shared("a"), shared("b")] });
		reorderProjectTerminal("p1", 0, 2);
		expect(saveProjectTerminalState).toHaveBeenCalledWith("p1", {
			terminals: [shared("b"), shared("a")],
		});
	});
});

describe("renameTerminal", () => {
	it("renames an instance terminal tab", () => {
		terminalSessions.set({ [KEY]: [session("t1", "old")] });
		renameTerminal("p1", "i1", "t1", "new");
		expect(instanceList()[0].title).toBe("new");
	});

	it("leaves the other tabs alone", () => {
		terminalSessions.set({ [KEY]: [session("t1"), session("t2", "kept")] });
		renameTerminal("p1", "i1", "t1", "new");
		expect(instanceList()[1].title).toBe("kept");
	});

	it("renames a shared terminal in its own scope", () => {
		projectTerminals.set({ p1: [shared("t1", "old")] });
		renameProjectTerminal("p1", "t1", "new");
		expect(projectList()[0].title).toBe("new");
	});

	it("leaves the other shared tabs alone", () => {
		projectTerminals.set({ p1: [shared("t1"), shared("t2", "kept")] });
		renameProjectTerminal("p1", "t1", "new");
		expect(projectList().map((s) => s.title)).toEqual(["new", "kept"]);
	});
});

describe("setActiveTerminal", () => {
	it("records the active terminal of the instance", () => {
		setActiveTerminal("p1", "i1", "t1");
		expect(get(activeTerminalId)[KEY]).toBe("t1");
	});

	it("records the second pane separately", () => {
		setActiveTerminal("p1", "i1", "t1");
		setActiveTerminal("p1", "i1", "t2", 1);
		expect(get(activeTerminalId)[KEY]).toBe("t1");
		expect(get(splitTerminalId)[KEY]).toBe("t2");
	});

	it("keeps instances apart", () => {
		setActiveTerminal("p1", "i1", "t1");
		setActiveTerminal("p1", "i2", "t2");
		expect(get(activeTerminalId)[KEY]).toBe("t1");
		expect(get(activeTerminalId)[terminalScope("p1", "i2")]).toBe("t2");
	});
});

describe("split panes", () => {
	it("seeds the ratio the first time a split opens", () => {
		openSplitTerminal("p1", "i1", "t2");
		expect(get(splitTerminalRatio)[KEY]).toBe(DEFAULT_SPLIT_RATIO);
	});

	it("keeps a ratio the user already set", () => {
		setSplitRatio("p1", "i1", 0.7);
		openSplitTerminal("p1", "i1", "t2");
		expect(get(splitTerminalRatio)[KEY]).toBe(0.7);
	});

	it("collapses to one pane without touching the ratio", () => {
		openSplitTerminal("p1", "i1", "t2");
		closeSplitTerminal("p1", "i1");
		expect(get(splitTerminalId)[KEY]).toBeNull();
		expect(get(splitTerminalRatio)[KEY]).toBe(DEFAULT_SPLIT_RATIO);
	});

	it("reopens on the terminal it is given", () => {
		openSplitTerminal("p1", "i1", "t2");
		closeSplitTerminal("p1", "i1");
		openSplitTerminal("p1", "i1", "t3");
		expect(get(splitTerminalId)[KEY]).toBe("t3");
	});

	it("records a dragged divider position", () => {
		setSplitRatio("p1", "i1", 0.3);
		expect(get(splitTerminalRatio)[KEY]).toBe(0.3);
	});
});

describe("restoreTerminals", () => {
	it("respawns the saved terminals in the worktree, skipping command terminals", async () => {
		getTerminalState.mockResolvedValue({
			terminals: [
				session("a", "one"),
				{ id: "cmd", title: "Build", commandId: "c1" },
				session("b", "two"),
			],
			activeId: "b",
			splitId: "a",
			splitRatio: 0.3,
		});

		await restoreTerminals("r1", "i1", "/wt", { FOO: "1" });

		const key = terminalScope("r1", "i1");
		expect(get(terminalSessions)[key]).toEqual([
			session("a", "one"),
			session("b", "two"),
		]);
		expect(get(activeTerminalId)[key]).toBe("b");
		expect(get(splitTerminalId)[key]).toBe("a");
		expect(get(splitTerminalRatio)[key]).toBe(0.3);
		expect(createTerminal.mock.calls).toEqual([
			["a", "/wt", 80, 24, null, { FOO: "1" }],
			["b", "/wt", 80, 24, null, { FOO: "1" }],
		]);
		expect(managerCreate.mock.calls).toEqual([["a"], ["b"]]);
	});

	it("focuses the first terminal when none was active", async () => {
		getTerminalState.mockResolvedValue({
			terminals: [session("a"), session("b")],
			activeId: null,
			splitId: null,
			splitRatio: 0.5,
		});

		await restoreTerminals("r2", "i1", "/wt");

		expect(get(activeTerminalId)[terminalScope("r2", "i1")]).toBe("a");
		expect(createTerminal.mock.calls[0]).toEqual([
			"a",
			"/wt",
			80,
			24,
			null,
			null,
		]);
	});

	it("falls back to a single pane at the default ratio when nothing was saved", async () => {
		await restoreTerminals("r3", "i1", "/wt");

		const key = terminalScope("r3", "i1");
		expect(get(splitTerminalId)[key]).toBeNull();
		expect(get(splitTerminalRatio)[key]).toBe(DEFAULT_SPLIT_RATIO);
		expect(get(terminalSessions)[key]).toBeUndefined();
		expect(createTerminal).not.toHaveBeenCalled();
	});

	it("falls back the same way when the saved state cannot be read", async () => {
		getTerminalState.mockRejectedValue(new Error("unreadable"));

		await restoreTerminals("r4", "i1", "/wt");

		expect(get(splitTerminalRatio)[terminalScope("r4", "i1")]).toBe(
			DEFAULT_SPLIT_RATIO,
		);
		expect(createTerminal).not.toHaveBeenCalled();
	});

	it("restores an instance only once", async () => {
		await restoreTerminals("r5", "i1", "/wt");
		await restoreTerminals("r5", "i1", "/wt");

		expect(getTerminalState).toHaveBeenCalledTimes(1);
	});
});

describe("restoring after the launch cleanup", () => {
	async function freshTerminalStore() {
		vi.resetModules();
		return await import("./terminal");
	}

	it("holds an instance restore until the orphans are closed", async () => {
		let finishCleanup = () => {};
		closeAllTerminals.mockReturnValue(
			new Promise<void>((resolve) => {
				finishCleanup = resolve;
			}),
		);
		const fresh = await freshTerminalStore();
		fresh.initTerminals();

		const restoring = fresh.restoreTerminals("c1", "i1", "/wt");
		await Promise.resolve();
		expect(getTerminalState).not.toHaveBeenCalled();

		finishCleanup();
		await restoring;
		expect(getTerminalState).toHaveBeenCalledWith("c1", "i1");
	});

	it("holds a project restore until the orphans are closed", async () => {
		let finishCleanup = () => {};
		closeAllTerminals.mockReturnValue(
			new Promise<void>((resolve) => {
				finishCleanup = resolve;
			}),
		);
		const fresh = await freshTerminalStore();
		fresh.initTerminals();

		const restoring = fresh.restoreProjectTerminals("c2");
		await Promise.resolve();
		expect(getProjectTerminalState).not.toHaveBeenCalled();

		finishCleanup();
		await restoring;
		expect(getProjectTerminalState).toHaveBeenCalledWith("c2");
	});
});

describe("restoreProjectTerminals", () => {
	it("respawns each shared terminal in the cwd it was created with", async () => {
		getProjectTerminalState.mockResolvedValue({
			terminals: [shared("a", "one", "/wt/a"), shared("b", "two", null)],
		});

		await restoreProjectTerminals("r6", { FOO: "1" });

		expect(get(projectTerminals).r6).toEqual([
			shared("a", "one", "/wt/a"),
			shared("b", "two", null),
		]);
		expect(createTerminal.mock.calls).toEqual([
			["a", "/wt/a", 80, 24, null, { FOO: "1" }],
			["b", null, 80, 24, null, { FOO: "1" }],
		]);
	});

	it("leaves the project without terminals when none were saved", async () => {
		await restoreProjectTerminals("r7");

		expect(get(projectTerminals).r7).toBeUndefined();
		expect(createTerminal).not.toHaveBeenCalled();
	});

	it("restores a project only once", async () => {
		await restoreProjectTerminals("r8");
		await restoreProjectTerminals("r8");

		expect(getProjectTerminalState).toHaveBeenCalledTimes(1);
	});
});

describe("addTerminal", () => {
	it("opens a numbered terminal, focuses it and persists it", async () => {
		terminalSessions.set({ [KEY]: [session("t1")] });

		await addTerminal("p1", "i1", "/wt", { FOO: "1" });

		const added = instanceList()[1];
		expect(added.id).toMatch(/^i1:[0-9a-f-]{36}$/);
		expect(added.title).toBe("Terminal 2");
		expect(get(activeTerminalId)[KEY]).toBe(added.id);
		expect(createTerminal).toHaveBeenCalledWith(added.id, "/wt", 80, 24, null, {
			FOO: "1",
		});
		expect(saveTerminalState).toHaveBeenCalledWith("p1", "i1", {
			terminals: [session("t1"), added],
			activeId: added.id,
			splitId: null,
			splitRatio: DEFAULT_SPLIT_RATIO,
		});
	});
});

describe("addCommandTerminal", () => {
	it("runs the script in a new tab that carries the command metadata", async () => {
		const id = await addCommandTerminal(
			"p1",
			"i1",
			"/wt",
			{ title: "Build :3000", commandId: "c1", icon: "play", port: 3000 },
			"npm run build",
			{ PORT: "3000" },
		);

		expect(id).toMatch(/^i1:[0-9a-f-]{36}$/);
		expect(instanceList()).toEqual([
			{ id, title: "Build :3000", commandId: "c1", icon: "play", port: 3000 },
		]);
		expect(get(activeTerminalId)[KEY]).toBe(id);
		expect(createTerminal).toHaveBeenCalledWith(
			id,
			"/wt",
			80,
			24,
			"npm run build",
			{ PORT: "3000" },
		);
		expect(saveTerminalState).toHaveBeenCalledTimes(1);
	});
});

describe("addProjectTerminal", () => {
	it("opens a shared terminal that remembers its cwd and focuses it in the instance", async () => {
		projectTerminals.set({ p1: [shared("t1")] });

		await addProjectTerminal("p1", "i1", "/wt", null);

		const added = projectList()[1];
		expect(added.id).toMatch(/^p1:[0-9a-f-]{36}$/);
		expect(added).toEqual({ id: added.id, title: "Terminal 2", cwd: "/wt" });
		expect(get(activeTerminalId)[KEY]).toBe(added.id);
		expect(createTerminal).toHaveBeenCalledWith(
			added.id,
			"/wt",
			80,
			24,
			null,
			null,
		);
		expect(saveProjectTerminalState).toHaveBeenCalledWith("p1", {
			terminals: [shared("t1"), added],
		});
	});
});

describe("removeTerminal", () => {
	beforeEach(() => {
		terminalSessions.set({
			[KEY]: [session("a"), session("b"), session("c")],
		});
	});

	it("kills the PTY, forgets the tab and persists", async () => {
		await removeTerminal("p1", "i1", "b");

		expect(closeTerminal).toHaveBeenCalledWith("b");
		expect(managerDispose).toHaveBeenCalledWith("b");
		expect(instanceList().map((s) => s.id)).toEqual(["a", "c"]);
		expect(saveTerminalState).toHaveBeenCalledTimes(1);
	});

	it("still forgets the tab when the PTY cannot be closed", async () => {
		closeTerminal.mockRejectedValue(new Error("gone"));

		await removeTerminal("p1", "i1", "b");

		expect(instanceList().map((s) => s.id)).toEqual(["a", "c"]);
	});

	it("moves focus to the last remaining terminal when the active one closes", async () => {
		activeTerminalId.set({ [KEY]: "c" });

		await removeTerminal("p1", "i1", "c");

		expect(get(activeTerminalId)[KEY]).toBe("b");
	});

	it("keeps focus off the terminal shown in the split pane", async () => {
		activeTerminalId.set({ [KEY]: "c" });
		splitTerminalId.set({ [KEY]: "b" });

		await removeTerminal("p1", "i1", "c");

		expect(get(activeTerminalId)[KEY]).toBe("a");
	});

	it("leaves no focus when the last terminal closes", async () => {
		terminalSessions.set({ [KEY]: [session("a")] });
		activeTerminalId.set({ [KEY]: "a" });

		await removeTerminal("p1", "i1", "a");

		expect(get(activeTerminalId)[KEY]).toBeNull();
	});

	it("collapses the split when its terminal closes", async () => {
		splitTerminalId.set({ [KEY]: "b" });

		await removeTerminal("p1", "i1", "b");

		expect(get(splitTerminalId)[KEY]).toBeNull();
	});

	it("keeps focus and split when another terminal closes", async () => {
		activeTerminalId.set({ [KEY]: "a" });
		splitTerminalId.set({ [KEY]: "c" });

		await removeTerminal("p1", "i1", "b");

		expect(get(activeTerminalId)[KEY]).toBe("a");
		expect(get(splitTerminalId)[KEY]).toBe("c");
	});
});

describe("removeProjectTerminal", () => {
	beforeEach(() => {
		projectTerminals.set({ p1: [shared("a"), shared("b")] });
	});

	it("kills the PTY, forgets the tab and persists", async () => {
		await removeProjectTerminal("p1", "b");

		expect(closeTerminal).toHaveBeenCalledWith("b");
		expect(managerDispose).toHaveBeenCalledWith("b");
		expect(projectList()).toEqual([shared("a")]);
		expect(saveProjectTerminalState).toHaveBeenCalledWith("p1", {
			terminals: [shared("a")],
		});
	});

	it("moves every scope that had it focused or split onto what remains", async () => {
		activeTerminalId.set({ "p1:i1": "b", "p1:i2": "a" });
		splitTerminalId.set({ "p1:i1": "a", "p1:i2": "b" });

		await removeProjectTerminal("p1", "b");

		expect(get(activeTerminalId)).toEqual({ "p1:i1": "a", "p1:i2": "a" });
		expect(get(splitTerminalId)).toEqual({ "p1:i1": "a", "p1:i2": null });
	});

	it("leaves no focus when the last shared terminal closes", async () => {
		projectTerminals.set({ p1: [shared("a")] });
		activeTerminalId.set({ "p1:i1": "a" });

		await removeProjectTerminal("p1", "a");

		expect(get(activeTerminalId)["p1:i1"]).toBeNull();
	});
});

describe("removeInstanceTerminals", () => {
	it("kills the instance terminals and forgets its state, sparing the shared ones", async () => {
		terminalSessions.set({
			[KEY]: [session("a"), session("b")],
			"p1:i2": [session("z")],
		});
		projectTerminals.set({ p1: [shared("s")] });
		activeTerminalId.set({ [KEY]: "a", "p1:i2": "z" });
		splitTerminalId.set({ [KEY]: "b", "p1:i2": null });
		splitTerminalRatio.set({ [KEY]: 0.4, "p1:i2": 0.5 });

		await removeInstanceTerminals("p1", "i1");

		expect(closeTerminal.mock.calls).toEqual([["a"], ["b"]]);
		expect(managerDispose.mock.calls).toEqual([["a"], ["b"]]);
		expect(get(terminalSessions)).toEqual({ "p1:i2": [session("z")] });
		expect(get(activeTerminalId)).toEqual({ "p1:i2": "z" });
		expect(get(splitTerminalId)).toEqual({ "p1:i2": null });
		expect(get(splitTerminalRatio)).toEqual({ "p1:i2": 0.5 });
		expect(projectList()).toEqual([shared("s")]);
	});

	it("lets the instance be restored again", async () => {
		await restoreTerminals("r9", "i1", "/wt");
		await removeInstanceTerminals("r9", "i1");
		await restoreTerminals("r9", "i1", "/wt");

		expect(getTerminalState).toHaveBeenCalledTimes(2);
	});
});

describe("persisting a scope that holds no terminal yet", () => {
	const emptyState = {
		terminals: [],
		activeId: null,
		splitId: null,
		splitRatio: DEFAULT_SPLIT_RATIO,
	};

	it("saves the focused terminal", () => {
		setActiveTerminal("p1", "i1", "t1");
		expect(saveTerminalState).toHaveBeenCalledWith("p1", "i1", {
			...emptyState,
			activeId: "t1",
		});
	});

	it("saves the split pane when it opens", () => {
		openSplitTerminal("p1", "i1", "t2");
		expect(saveTerminalState).toHaveBeenCalledWith("p1", "i1", {
			...emptyState,
			splitId: "t2",
		});
	});

	it("saves the collapse of the split pane", () => {
		closeSplitTerminal("p1", "i1");
		expect(saveTerminalState).toHaveBeenCalledWith("p1", "i1", emptyState);
	});

	it("saves a dragged divider position", () => {
		setSplitRatio("p1", "i1", 0.3);
		expect(saveTerminalState).toHaveBeenCalledWith("p1", "i1", {
			...emptyState,
			splitRatio: 0.3,
		});
	});
});

describe("acting on a scope that holds no terminal yet", () => {
	it("numbers the first instance terminal 1", async () => {
		await addTerminal("p1", "i1", null);
		expect(instanceList().map((s) => s.title)).toEqual(["Terminal 1"]);
	});

	it("numbers the first command terminal's tab without a list to extend", async () => {
		const id = await addCommandTerminal(
			"p1",
			"i1",
			null,
			{ title: "run" },
			"x",
			{},
		);
		expect(instanceList()).toEqual([{ title: "run", id }]);
	});

	it("numbers the first shared terminal 1", async () => {
		await addProjectTerminal("p1", "i1", "/wt");
		expect(projectList().map((s) => s.title)).toEqual(["Terminal 1"]);
	});

	it("closes an unknown instance terminal and saves an empty list", async () => {
		await removeTerminal("p1", "i1", "ghost");
		expect(saveTerminalState).toHaveBeenCalledWith("p1", "i1", {
			terminals: [],
			activeId: null,
			splitId: null,
			splitRatio: DEFAULT_SPLIT_RATIO,
		});
	});

	it("closes an unknown shared terminal and saves an empty list", async () => {
		await removeProjectTerminal("p1", "ghost");
		expect(saveProjectTerminalState).toHaveBeenCalledWith("p1", {
			terminals: [],
		});
	});

	it("renames nothing and saves an empty list", () => {
		renameTerminal("p1", "i1", "ghost", "x");
		expect(saveTerminalState).toHaveBeenCalledWith(
			"p1",
			"i1",
			expect.objectContaining({ terminals: [] }),
		);
	});

	it("renames nothing shared and saves an empty list", () => {
		renameProjectTerminal("p1", "ghost", "x");
		expect(saveProjectTerminalState).toHaveBeenCalledWith("p1", {
			terminals: [],
		});
	});

	it("reorders nothing shared", () => {
		expect(() => reorderProjectTerminal("p1", 0, 1)).not.toThrow();
		expect(saveProjectTerminalState).toHaveBeenCalledWith("p1", {
			terminals: [],
		});
	});

	it("shares nothing from an empty instance", () => {
		expect(() => shareTerminal("p1", "i1", "ghost", null, 0)).not.toThrow();
	});

	it("unshares nothing from an empty project", () => {
		expect(() => unshareTerminal("p1", "i1", "ghost", 0)).not.toThrow();
	});
});

describe("closing a terminal that is not the focused one", () => {
	it("keeps the focus of the instance when no split is open", async () => {
		terminalSessions.set({
			[KEY]: [session("a"), session("b"), session("c")],
		});
		activeTerminalId.set({ [KEY]: "a" });

		await removeTerminal("p1", "i1", "b");

		expect(get(activeTerminalId)[KEY]).toBe("a");
	});

	it("keeps the focus of a scope that did not show the shared terminal", async () => {
		projectTerminals.set({ p1: [shared("a"), shared("b"), shared("c")] });
		activeTerminalId.set({ "p1:i1": "a", "p1:i2": "b" });
		splitTerminalId.set({ "p1:i1": "c", "p1:i2": "a" });

		await removeProjectTerminal("p1", "b");

		expect(get(activeTerminalId)).toEqual({ "p1:i1": "a", "p1:i2": "c" });
		expect(get(splitTerminalId)).toEqual({ "p1:i1": "c", "p1:i2": "a" });
	});
});

describe("unshareTerminal persistence", () => {
	it("saves both scopes, since both lists changed", () => {
		projectTerminals.set({ p1: [shared("t1", "t1", "/cwd")] });

		unshareTerminal("p1", "i1", "t1", 0);

		expect(saveTerminalState).toHaveBeenCalledWith("p1", "i1", {
			terminals: [session("t1")],
			activeId: null,
			splitId: null,
			splitRatio: DEFAULT_SPLIT_RATIO,
		});
		expect(saveProjectTerminalState).toHaveBeenCalledWith("p1", {
			terminals: [],
		});
	});
});

describe("initTerminals", () => {
	it("closes the leftover PTYs only once per launch", async () => {
		closeAllTerminals.mockResolvedValue(undefined);
		vi.resetModules();
		const fresh = await import("./terminal");

		fresh.initTerminals();
		fresh.initTerminals();

		expect(closeAllTerminals).toHaveBeenCalledTimes(1);
	});
});
