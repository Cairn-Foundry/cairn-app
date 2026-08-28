import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileNode, GitStatusMap } from "$lib/services/file-service";
import FileTreeView from "./FileTreeView.svelte";

function file(path: string): FileNode {
	return { name: path.split("/").pop() as string, path, isDir: false };
}
function dir(path: string, children: FileNode[] = []): FileNode {
	return { name: path.split("/").pop() as string, path, isDir: true, children };
}

const callbacks = () => ({
	onCollapseAll: vi.fn(),
	onNewFileTopLevel: vi.fn(),
	onNewFolderTopLevel: vi.fn(),
	onToggleSearchPanel: vi.fn(),
	onRefresh: vi.fn(),
	onToggleSplit: vi.fn(),
	onToggleIgnored: vi.fn(),
	onMinWidthChange: vi.fn(),
	onRootClick: vi.fn(),
	onNodeClick: vi.fn(),
	onNodeAuxClick: vi.fn(),
	onContextMenu: vi.fn(),
	onNodePointerDown: vi.fn(),
	onCommitEdit: vi.fn(),
	onCancelEdit: vi.fn(),
	onEditValueChange: vi.fn(),
	onEmptyAreaClick: vi.fn(),
});

function mount(props: Record<string, unknown> = {}) {
	const spies = callbacks();
	const result = render(FileTreeView, {
		treeWidth: 240,
		treeMinWidth: 120,
		searchPanelOpen: false,
		splitMode: false,
		showIgnored: false,
		tooltipSearch: "Search",
		tooltipSplit: "Split",
		loading: false,
		error: "",
		worktreePath: "/repo",
		tree: [],
		expanded: new Set<string>(),
		selectedDir: "",
		multiSelected: new Set<string>(),
		dragOverDir: null,
		cutPaths: new Set<string>(),
		gitStatusMap: {} as GitStatusMap,
		loadingPaths: new Set<string>(),
		editState: null,
		editValue: "",
		editConflict: false,
		contextMenuTargetPath: null,
		openTabPaths: new Set<string>(),
		activeTabPath: null,
		dirtyTabPaths: new Set<string>(),
		...spies,
		...props,
	});
	return { ...result, ...spies };
}

const rows = () =>
	Array.from(document.querySelectorAll<HTMLElement>("[data-tree-path]"));
const paths = () => rows().map((r) => r.dataset.treePath);
const rowFor = (path: string) =>
	rows().find((r) => r.dataset.treePath === path) as HTMLElement;
const scroller = () =>
	document.querySelector(".files-tree-scroll") as HTMLElement;

beforeEach(() => {
	// The tree measures its viewport to decide what to render.
	global.ResizeObserver = class {
		observe() {}
		disconnect() {}
	} as unknown as typeof ResizeObserver;
});

describe("FileTreeView", () => {
	describe("what it draws", () => {
		it("shows the top level of the tree", () => {
			mount({ tree: [file("a.ts"), dir("src")] });
			expect(paths()).toEqual(["a.ts", "src"]);
		});

		/** A folded directory hides its children entirely. */
		it("hides the children of a folded directory", () => {
			mount({ tree: [dir("src", [file("src/main.ts")])] });
			expect(paths()).toEqual(["src"]);
		});

		it("shows them once the directory is unfolded", () => {
			mount({
				tree: [dir("src", [file("src/main.ts")])],
				expanded: new Set(["src"]),
			});
			expect(paths()).toEqual(["src", "src/main.ts"]);
		});

		it("indents each level deeper than the one above", () => {
			mount({
				tree: [dir("src", [dir("src/lib", [file("src/lib/a.ts")])])],
				expanded: new Set(["src", "src/lib"]),
			});
			const pad = rows().map((r) => Number.parseFloat(r.style.paddingLeft));
			expect(pad[0]).toBeLessThan(pad[1]);
			expect(pad[1]).toBeLessThan(pad[2]);
		});

		it("shows an error rather than an empty tree", () => {
			mount({ error: "cannot read the worktree" });
			expect(document.body.textContent).toContain("cannot read the worktree");
		});

		/** Loading shows an animation, never the word "loading". */
		it("shows a placeholder while it loads, not a word", () => {
			mount({ loading: true });
			expect(document.querySelector(".skeleton, .sk-line")).not.toBeNull();
			expect(document.body.textContent?.toLowerCase()).not.toContain("loading");
		});
	});

	describe("the state of each row", () => {
		const tree = [file("a.ts"), file("b.ts")];

		it("marks the file of the active tab", () => {
			mount({ tree, openTabPaths: new Set(["a.ts"]), activeTabPath: "a.ts" });
			expect(rowFor("a.ts").className).toContain("active");
			expect(rowFor("b.ts").className).not.toContain("active");
		});

		it("marks a file that is open but not active", () => {
			mount({ tree, openTabPaths: new Set(["a.ts"]), activeTabPath: "b.ts" });
			expect(rowFor("a.ts").className).toContain("open");
			expect(rowFor("a.ts").className).not.toContain("active");
		});

		it("shows the unsaved mark on a dirty tab", () => {
			mount({ tree, dirtyTabPaths: new Set(["a.ts"]) });
			expect(rowFor("a.ts").querySelector(".tab-dot")).not.toBeNull();
			expect(rowFor("b.ts").querySelector(".tab-dot")).toBeNull();
		});

		it("carries the git status of each file", () => {
			mount({
				tree,
				gitStatusMap: { "a.ts": "modified" } as unknown as GitStatusMap,
			});
			expect(rowFor("a.ts").className).toContain("git-modified");
			expect(rowFor("b.ts").className).not.toContain("git-");
		});

		it("marks the files taken by a cut", () => {
			mount({ tree, cutPaths: new Set(["a.ts"]) });
			expect(rowFor("a.ts").className).toContain("file-cut");
		});

		it("marks every file of a multiple selection", () => {
			mount({ tree, multiSelected: new Set(["a.ts", "b.ts"]) });
			expect(rowFor("a.ts").className).toContain("multi-selected");
			expect(rowFor("b.ts").className).toContain("multi-selected");
		});

		it("marks the directory a drag is hovering", () => {
			mount({ tree: [dir("src")], dragOverDir: "src" });
			expect(rowFor("src").className).toContain("drag-over");
		});

		it("spins on a row that is still loading", () => {
			mount({ tree, loadingPaths: new Set(["a.ts"]) });
			expect(rowFor("a.ts").querySelector(".spinner")).not.toBeNull();
		});
	});

	describe("reaching the rows", () => {
		/**
		 * The handlers are delegated to the scroll container rather than bound
		 * per row: a tree showing ignored files reaches tens of thousands of
		 * nodes, and three listeners each is most of what mounting it costs.
		 */
		it("reports a click on the node it landed on", async () => {
			const { onNodeClick } = mount({ tree: [file("a.ts"), file("b.ts")] });
			await userEvent.click(rowFor("b.ts"));
			expect(onNodeClick).toHaveBeenCalledTimes(1);
			expect(onNodeClick.mock.calls[0][1].path).toBe("b.ts");
		});

		it("reports a click landing on a child of the row", async () => {
			const { onNodeClick } = mount({ tree: [file("a.ts")] });
			await userEvent.click(
				rowFor("a.ts").querySelector(".file-tree-name") as HTMLElement,
			);
			expect(onNodeClick.mock.calls[0][1].path).toBe("a.ts");
		});

		it("reports a right click on the node it landed on", async () => {
			const { onContextMenu } = mount({ tree: [file("a.ts")] });
			rowFor("a.ts").dispatchEvent(
				new MouseEvent("contextmenu", { bubbles: true }),
			);
			expect(onContextMenu.mock.calls[0][1].path).toBe("a.ts");
		});

		it("reports a middle click on the node it landed on", async () => {
			const { onNodeAuxClick } = mount({ tree: [file("a.ts")] });
			rowFor("a.ts").dispatchEvent(
				new MouseEvent("auxclick", { bubbles: true }),
			);
			expect(onNodeAuxClick.mock.calls[0][1].path).toBe("a.ts");
		});

		/** A click on the empty space below the tree is not a click on a row. */
		it("reports a click on the empty area as such", async () => {
			const { onEmptyAreaClick, onNodeClick } = mount({
				tree: [file("a.ts")],
			});
			scroller().dispatchEvent(new MouseEvent("click", { bubbles: true }));
			expect(onEmptyAreaClick).toHaveBeenCalled();
			expect(onNodeClick).not.toHaveBeenCalled();
		});

		/**
		 * The pointer capture stays on the row itself: taken anywhere else, the
		 * compatibility click would be sent to the wrong element.
		 */
		it("hands the drag to the row that was pressed", () => {
			const { onNodePointerDown } = mount({ tree: [file("a.ts")] });
			rowFor("a.ts").dispatchEvent(
				new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 }),
			);
			expect(onNodePointerDown.mock.calls[0][1].path).toBe("a.ts");
		});
	});

	describe("renaming and creating in place", () => {
		it("shows a field instead of the row being renamed", () => {
			mount({
				tree: [file("a.ts"), file("b.ts")],
				editState: {
					type: "rename",
					node: file("a.ts"),
					parentPath: "",
					value: "a.ts",
				},
				editValue: "a.ts",
			});
			expect(document.querySelector(".tree-edit-input")).not.toBeNull();
			expect(rows().some((r) => r.dataset.treePath === "a.ts")).toBe(false);
		});

		it("reports what is typed into the field", async () => {
			const { onEditValueChange } = mount({
				tree: [file("a.ts")],
				editState: {
					type: "rename",
					node: file("a.ts"),
					parentPath: "",
					value: "a",
				},
				editValue: "a",
			});
			await userEvent.type(
				document.querySelector(".tree-edit-input") as HTMLElement,
				"b",
			);
			expect(onEditValueChange).toHaveBeenCalled();
		});

		it("submits on Enter and gives up on Escape", async () => {
			const { onCommitEdit, onCancelEdit } = mount({
				tree: [file("a.ts")],
				editState: {
					type: "rename",
					node: file("a.ts"),
					parentPath: "",
					value: "a",
				},
				editValue: "a",
			});
			const input = document.querySelector(".tree-edit-input") as HTMLElement;
			await userEvent.type(input, "{Enter}");
			expect(onCommitEdit).toHaveBeenCalled();
			await userEvent.type(input, "{Escape}");
			expect(onCancelEdit).toHaveBeenCalled();
		});

		/** A name already taken is marked before the user submits it. */
		it("marks a name that collides with an existing one", () => {
			mount({
				tree: [file("a.ts")],
				editState: {
					type: "rename",
					node: file("a.ts"),
					parentPath: "",
					value: "b.ts",
				},
				editValue: "b.ts",
				editConflict: true,
			});
			expect(document.querySelector(".tree-edit-input")?.className).toContain(
				"input-conflict",
			);
		});

		it("shows the new entry inside the directory it belongs to", () => {
			mount({
				tree: [dir("src", [file("src/a.ts")])],
				expanded: new Set(["src"]),
				editState: {
					type: "new-file",
					node: null,
					parentPath: "src",
					value: "",
				},
			});
			expect(document.querySelector(".tree-edit-input")).not.toBeNull();
		});
	});

	describe("the header actions", () => {
		/** The header buttons carry their label in `data-tooltip`, not `title`. */
		const clickTitled = async (pattern: RegExp) => {
			const button = Array.from(
				document.querySelectorAll<HTMLElement>(".tree-action-btn"),
			).find((b) => pattern.test(b.getAttribute("data-tooltip") ?? ""));
			expect(button, String(pattern)).toBeTruthy();
			await userEvent.click(button as HTMLElement);
		};

		it("collapses everything on request", async () => {
			const { onCollapseAll } = mount();
			await clickTitled(/collapse|replier/i);
			expect(onCollapseAll).toHaveBeenCalled();
		});

		it("refreshes on request", async () => {
			const { onRefresh } = mount();
			await clickTitled(/refresh|actualiser/i);
			expect(onRefresh).toHaveBeenCalled();
		});

		it("opens the search panel on request", async () => {
			const { onToggleSearchPanel } = mount({ tooltipSearch: "Search files" });
			await clickTitled(/search files/i);
			expect(onToggleSearchPanel).toHaveBeenCalled();
		});

		it("splits the editor on request", async () => {
			const { onToggleSplit } = mount({ tooltipSplit: "Split editor" });
			await clickTitled(/split editor/i);
			expect(onToggleSplit).toHaveBeenCalled();
		});
	});

	describe("large trees", () => {
		const many = (n: number) =>
			Array.from({ length: n }, (_, i) =>
				file(`f${String(i).padStart(4, "0")}.ts`),
			);

		/**
		 * A repo with ignored files shown reaches tens of thousands of nodes, and
		 * one DOM row each is what makes the tree crawl: only the slice around
		 * the viewport is drawn, and the rest is a pair of spacers.
		 */
		it("draws only a window of a very large tree", () => {
			mount({ tree: many(5000) });
			expect(rows().length).toBeGreaterThan(0);
			expect(rows().length).toBeLessThan(200);
		});

		it("draws the first rows of it", () => {
			mount({ tree: many(5000) });
			expect(paths()[0]).toBe("f0000.ts");
		});

		it("draws a small tree whole", () => {
			mount({ tree: many(5) });
			expect(rows()).toHaveLength(5);
		});

		it("draws further rows once it is scrolled", async () => {
			mount({ tree: many(5000) });
			const el = scroller();
			Object.defineProperty(el, "scrollTop", {
				value: 25 * 400,
				configurable: true,
			});
			el.dispatchEvent(new Event("scroll"));
			await tick();
			expect(paths()[0]).not.toBe("f0000.ts");
		});
	});
});
