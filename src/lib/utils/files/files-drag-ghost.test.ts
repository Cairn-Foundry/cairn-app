import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createDragGhost,
	findDropTargetDir,
	moveGhost,
	removeDragGhost,
} from "./files-drag-ghost";

/** The floating label, or null when there is none. */
const ghost = () => document.querySelector<HTMLElement>(".drag-ghost");

beforeEach(() => {
	document.body.innerHTML = "";
	removeDragGhost();
});

afterEach(() => {
	removeDragGhost();
	document.body.innerHTML = "";
	vi.restoreAllMocks();
});

describe("createDragGhost", () => {
	it("puts a labelled ghost in the document", () => {
		createDragGhost("src/main.ts");
		expect(ghost()?.textContent).toBe("src/main.ts");
	});

	it("keeps the pointer able to reach what is underneath", () => {
		createDragGhost("a.ts");
		expect(ghost()?.style.pointerEvents).toBe("none");
	});

	it("floats above the rest of the interface", () => {
		createDragGhost("a.ts");
		expect(ghost()?.style.position).toBe("fixed");
		expect(Number(ghost()?.style.zIndex)).toBeGreaterThan(100);
	});

	it("replaces a ghost left over from a previous drag", () => {
		createDragGhost("first");
		createDragGhost("second");
		expect(document.querySelectorAll(".drag-ghost")).toHaveLength(1);
		expect(ghost()?.textContent).toBe("second");
	});

	it("shows a label with no text rather than failing", () => {
		createDragGhost("");
		expect(ghost()).not.toBeNull();
		expect(ghost()?.textContent).toBe("");
	});

	it("renders a name with accents and spaces as text, not as markup", () => {
		createDragGhost("<b>dossier été</b>");
		expect(ghost()?.textContent).toBe("<b>dossier été</b>");
		expect(ghost()?.querySelector("b")).toBeNull();
	});
});

describe("moveGhost", () => {
	it("follows the pointer, offset so it never sits under the cursor", () => {
		createDragGhost("a.ts");
		moveGhost(100, 200);
		expect(ghost()?.style.left).toBe("112px");
		expect(ghost()?.style.top).toBe("212px");
	});

	it("keeps following on every move", () => {
		createDragGhost("a.ts");
		moveGhost(10, 10);
		moveGhost(50, 60);
		expect(ghost()?.style.left).toBe("62px");
		expect(ghost()?.style.top).toBe("72px");
	});

	it("handles the origin and negative coordinates", () => {
		createDragGhost("a.ts");
		moveGhost(0, 0);
		expect(ghost()?.style.left).toBe("12px");
		moveGhost(-20, -20);
		expect(ghost()?.style.left).toBe("-8px");
	});

	it("does nothing when there is no ghost", () => {
		expect(() => moveGhost(10, 10)).not.toThrow();
	});
});

describe("removeDragGhost", () => {
	it("takes the ghost away", () => {
		createDragGhost("a.ts");
		removeDragGhost();
		expect(ghost()).toBeNull();
	});

	it("is safe to call when there is none", () => {
		expect(() => removeDragGhost()).not.toThrow();
		expect(() => {
			removeDragGhost();
			removeDragGhost();
		}).not.toThrow();
	});

	it("leaves no ghost behind for the next drag to inherit", () => {
		createDragGhost("first");
		removeDragGhost();
		moveGhost(10, 10);
		expect(document.querySelectorAll(".drag-ghost")).toHaveLength(0);
	});
});

describe("findDropTargetDir", () => {
	/**
	 * Answers elementFromPoint with the element a test names. jsdom does not
	 * implement it at all, so it is defined here rather than spied on.
	 */
	function pointsAt(el: Element | null) {
		Object.defineProperty(document, "elementFromPoint", {
			configurable: true,
			value: () => el,
		});
	}

	it("drops a directory row into itself", () => {
		const dir = document.createElement("button");
		dir.setAttribute("data-tree-dir", "src/lib");
		document.body.append(dir);
		pointsAt(dir);
		expect(findDropTargetDir(0, 0)).toBe("src/lib");
	});

	it("drops a file row into the directory that holds it", () => {
		const file = document.createElement("button");
		file.setAttribute("data-tree-parent", "src");
		document.body.append(file);
		pointsAt(file);
		expect(findDropTargetDir(0, 0)).toBe("src");
	});

	it("reads the row through the element actually under the pointer", () => {
		const dir = document.createElement("button");
		dir.setAttribute("data-tree-dir", "src");
		const label = document.createElement("span");
		dir.append(label);
		document.body.append(dir);
		pointsAt(label);
		expect(findDropTargetDir(0, 0)).toBe("src");
	});

	it("prefers the directory attribute when a row carries both", () => {
		const row = document.createElement("button");
		row.setAttribute("data-tree-dir", "src/lib");
		row.setAttribute("data-tree-parent", "src");
		document.body.append(row);
		pointsAt(row);
		expect(findDropTargetDir(0, 0)).toBe("src/lib");
	});

	it("answers null when the pointer is over nothing", () => {
		pointsAt(null);
		expect(findDropTargetDir(0, 0)).toBeNull();
	});

	it("answers null when the pointer is outside any tree row", () => {
		const plain = document.createElement("div");
		document.body.append(plain);
		pointsAt(plain);
		expect(findDropTargetDir(0, 0)).toBeNull();
	});

	it("names the worktree root as an empty directory path", () => {
		const dir = document.createElement("button");
		dir.setAttribute("data-tree-dir", "");
		document.body.append(dir);
		pointsAt(dir);
		expect(findDropTargetDir(0, 0)).toBe("");
	});
});
