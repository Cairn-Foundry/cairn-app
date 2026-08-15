import { describe, expect, it } from "vitest";
import { resolveTabClose } from "./files-tab-close";

describe("resolveTabClose", () => {
	it("empties the pane when the last tab goes", () => {
		expect(resolveTabClose(0, 0, 0)).toEqual({
			activeTabIdx: -1,
			activeChanged: true,
		});
	});

	it("keeps the same index when closing the active tab mid-list", () => {
		expect(resolveTabClose(1, 1, 3)).toEqual({
			activeTabIdx: 1,
			activeChanged: true,
		});
	});

	it("falls back to the last tab when closing the active trailing tab", () => {
		expect(resolveTabClose(2, 2, 2)).toEqual({
			activeTabIdx: 1,
			activeChanged: true,
		});
	});

	it("shifts the active index down when closing a tab before it", () => {
		expect(resolveTabClose(2, 0, 3)).toEqual({
			activeTabIdx: 1,
			activeChanged: false,
		});
	});

	it("leaves the active index alone when closing a tab after it", () => {
		expect(resolveTabClose(0, 2, 3)).toEqual({
			activeTabIdx: 0,
			activeChanged: false,
		});
	});

	it("flags a diff reload exactly when the shown file changes", () => {
		expect(resolveTabClose(1, 1, 3).activeChanged).toBe(true);
		expect(resolveTabClose(1, 0, 3).activeChanged).toBe(false);
		expect(resolveTabClose(1, 2, 3).activeChanged).toBe(false);
	});
});
