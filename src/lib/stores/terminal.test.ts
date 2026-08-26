// Terminals are scoped two ways: per instance and per project. Moving one
// across scopes must move the lists only - the PTY keeps running - which is
// what most of these tests pin down.

import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

const saveTerminalState = vi.hoisted(() => vi.fn());
const saveProjectTerminalState = vi.hoisted(() => vi.fn());
const closeTerminal = vi.hoisted(() => vi.fn());

vi.mock("$lib/services/terminal-service", () => ({
	saveTerminalState,
	saveProjectTerminalState,
	getTerminalState: vi.fn().mockResolvedValue(null),
	getProjectTerminalState: vi.fn().mockResolvedValue(null),
	closeTerminal,
	createTerminal: vi.fn().mockResolvedValue(undefined),
	killOrphanTerminals: vi.fn().mockResolvedValue(undefined),
}));

import {
	activeTerminalId,
	closeSplitTerminal,
	DEFAULT_SPLIT_RATIO,
	openSplitTerminal,
	projectTerminals,
	renameProjectTerminal,
	renameTerminal,
	reorderProjectTerminal,
	reorderTerminal,
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
		expect(saveTerminalState).toHaveBeenCalled();
		expect(saveProjectTerminalState).toHaveBeenCalled();
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
		expect(saveTerminalState).toHaveBeenCalled();
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
		expect(saveProjectTerminalState).toHaveBeenCalled();
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
