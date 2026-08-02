import { describe, expect, it } from "vitest";
import {
	type PaneBox,
	resolvePaneDrop,
	toWorktreeRelative,
} from "./files-editor-drop";

const left: PaneBox = { left: 0, right: 400, top: 0, bottom: 300 };
const right: PaneBox = { left: 404, right: 800, top: 0, bottom: 300 };

describe("resolvePaneDrop", () => {
	it("returns null outside every pane", () => {
		expect(resolvePaneDrop([left, null], false, 900, 100)).toBeNull();
		expect(resolvePaneDrop([left, null], false, 100, 400)).toBeNull();
	});

	it("targets the only pane away from its right edge", () => {
		expect(resolvePaneDrop([left, null], false, 100, 100)).toEqual({
			pane: 0,
			openSplit: false,
		});
	});

	it("opens the split on the right edge of the only pane", () => {
		expect(resolvePaneDrop([left, null], false, 390, 100)).toEqual({
			pane: 1,
			openSplit: true,
		});
	});

	it("never opens a second split once the panes are already split", () => {
		expect(resolvePaneDrop([left, right], true, 390, 100)).toEqual({
			pane: 0,
			openSplit: false,
		});
		expect(resolvePaneDrop([left, right], true, 700, 100)).toEqual({
			pane: 1,
			openSplit: false,
		});
	});

	it("ignores a missing pane box", () => {
		expect(resolvePaneDrop([null, null], false, 10, 10)).toBeNull();
	});
});

describe("toWorktreeRelative", () => {
	it("strips the worktree prefix", () => {
		expect(toWorktreeRelative("/wt/src/app.ts", "/wt")).toBe("src/app.ts");
		expect(toWorktreeRelative("/wt/src/app.ts", "/wt/")).toBe("src/app.ts");
	});

	it("rejects a path outside the worktree", () => {
		expect(toWorktreeRelative("/other/app.ts", "/wt")).toBeNull();
		expect(toWorktreeRelative("/wt-other/app.ts", "/wt")).toBeNull();
	});

	it("rejects the worktree root itself and a missing worktree", () => {
		expect(toWorktreeRelative("/wt/", "/wt")).toBeNull();
		expect(toWorktreeRelative("/wt/app.ts", null)).toBeNull();
	});
});
