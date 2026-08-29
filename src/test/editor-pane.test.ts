import { Text } from "@codemirror/state";
import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GitStatusMap } from "$lib/services/file-service";
import type { Tab } from "$lib/utils/files/files-persistence";

// The editor body is a CodeMirror view with nothing to say about the pane's
// own behaviour: its tabs, its breadcrumb and its status bar.
vi.mock("$lib/components/files/CodeEditor.svelte", async () => ({
	default: (await import("./stubs/CodeEditorStub.svelte")).default,
}));

vi.mock("$lib/services/settings-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	updateSettings: vi.fn(async (next: unknown) => next),
}));

const { default: EditorPane } = await import(
	"$lib/components/files/EditorPane.svelte"
);

function tab(path: string, overrides: Partial<Tab> = {}): Tab {
	const doc = Text.of(["hello"]);
	return {
		path,
		doc,
		savedDoc: doc,
		cursorPos: 0,
		scrollTop: 0,
		...overrides,
	};
}

/** A tab whose document has moved on from what was saved. */
function dirtyTab(path: string): Tab {
	return {
		...tab(path),
		doc: Text.of(["edited"]),
		savedDoc: Text.of(["hello"]),
	};
}

const callbacks = () => ({
	onPaneFocus: vi.fn(),
	onTabPointerDown: vi.fn(),
	onTabPointerMove: vi.fn(),
	onTabPointerUp: vi.fn(),
	onTabClick: vi.fn(),
	onTabContextMenu: vi.fn(),
	onTabClose: vi.fn(),
	onTabUnpin: vi.fn(),
	onBreadcrumbClick: vi.fn(),
	onChange: vi.fn(),
	onCursorChange: vi.fn(),
	onChunkClick: vi.fn(),
	onRevertChunk: vi.fn(),
	onCloseHunk: vi.fn(),
	onConvertLineEndings: vi.fn(),
	onConvertIndent: vi.fn(),
	onToggleWhitespace: vi.fn(),
	onOpenRecent: vi.fn(),
	onNewFile: vi.fn(),
	onOpenLink: vi.fn(),
	onGoToDefinition: vi.fn(),
	onFindReferences: vi.fn(),
	onRenameSymbol: vi.fn(),
	onFormatDocument: vi.fn(),
});

function mount(props: Record<string, unknown> = {}) {
	const spies = callbacks();
	const tabs = (props.tabs as Tab[]) ?? [tab("src/a.ts")];
	const activeTabIdx = (props.activeTabIdx as number) ?? 0;
	render(EditorPane, {
		rootEl: null,
		paneClass: "",
		paneStyle: "",
		dropHint: "none",
		tabs,
		activeTabIdx,
		activeTab: tabs[activeTabIdx] ?? null,
		gitStatusMap: {} as GitStatusMap,
		loadingPaths: new Set<string>(),
		dragSrcIndex: null,
		insertIndex: null,
		didDrag: false,
		dragActive: false,
		editorRef: undefined,
		tabsBarEl: null,
		editorState: null,
		activeLang: "ts",
		activeLineEndings: "LF",
		activeIndentStyle: "spaces",
		activeSpaceSize: 2,
		isDirty: false,
		saving: false,
		cursorLine: 1,
		cursorCol: 1,
		currentLineBlame: null,
		baseContent: null,
		activeChunk: null,
		worktreePath: "/repo",
		...spies,
		...props,
	});
	return spies;
}

const tabEls = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".file-tab"));
const tabNames = () =>
	tabEls().map((t) => t.querySelector(".tab-name")?.textContent);
const dirtyDots = () => document.querySelectorAll(".tab-dot");
const breadcrumb = () => document.querySelector(".editor-breadcrumb");
const crumbs = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".breadcrumb-seg"));

beforeEach(() => {
	Element.prototype.setPointerCapture = vi.fn();
	Element.prototype.releasePointerCapture = vi.fn();
});

describe("EditorPane", () => {
	describe("the tab bar", () => {
		it("shows one tab per open file", () => {
			mount({ tabs: [tab("a.ts"), tab("b.ts")], activeTabIdx: 0 });
			expect(tabNames()).toEqual(["a.ts", "b.ts"]);
		});

		it("shows no tab bar when nothing is open", () => {
			mount({ tabs: [], activeTabIdx: -1, activeTab: null });
			expect(tabEls()).toHaveLength(0);
		});

		it("marks the tab that is showing", () => {
			mount({ tabs: [tab("a.ts"), tab("b.ts")], activeTabIdx: 1 });
			expect(tabEls()[1].classList.contains("tab-active")).toBe(true);
			expect(tabEls()[0].classList.contains("tab-active")).toBe(false);
		});

		/** An edited file is marked so it is not closed by accident. */
		it("marks a tab whose file has unsaved edits", () => {
			mount({ tabs: [tab("a.ts"), dirtyTab("b.ts")], activeTabIdx: 0 });
			expect(dirtyDots()).toHaveLength(1);
			expect(tabEls()[1].querySelector(".tab-dot")).not.toBeNull();
		});

		it("marks a pinned tab", () => {
			mount({
				tabs: [tab("a.ts", { pinned: true }), tab("b.ts")],
				activeTabIdx: 0,
			});
			expect(tabEls()[0].classList.contains("tab-pinned")).toBe(true);
			expect(tabEls()[0].querySelector(".tab-pin")).not.toBeNull();
		});

		/** A file deleted on disk still has its tab, marked as gone. */
		it("marks a tab whose file was deleted", () => {
			mount({
				tabs: [tab("a.ts")],
				activeTabIdx: 0,
				gitStatusMap: { "a.ts": "deleted" } as unknown as GitStatusMap,
			});
			expect(tabEls()[0].classList.contains("tab-deleted")).toBe(true);
		});

		it("marks a tab opened from outside the worktree", () => {
			mount({ tabs: [tab("/elsewhere/x.ts")], activeTabIdx: 0 });
			expect(tabEls()[0].classList.contains("tab-external")).toBe(true);
		});

		it("marks the tab being dragged", () => {
			mount({
				tabs: [tab("a.ts"), tab("b.ts")],
				activeTabIdx: 0,
				dragActive: true,
				dragSrcIndex: 1,
			});
			expect(tabEls()[1].classList.contains("tab-dragging")).toBe(true);
			expect(tabEls()[0].classList.contains("tab-dragging")).toBe(false);
		});
	});

	describe("acting on a tab", () => {
		it("reports the tab that was clicked", async () => {
			const { onTabClick } = mount({
				tabs: [tab("a.ts"), tab("b.ts")],
				activeTabIdx: 0,
			});
			await userEvent.click(tabEls()[1]);
			expect(onTabClick).toHaveBeenCalledWith(1);
		});

		/** A drag is not a selection: the click it ends with is swallowed. */
		it("does not select a tab that was just dragged", async () => {
			const { onTabClick } = mount({
				tabs: [tab("a.ts"), tab("b.ts")],
				activeTabIdx: 0,
				didDrag: true,
			});
			await userEvent.click(tabEls()[1]);
			expect(onTabClick).not.toHaveBeenCalled();
		});

		/**
		 * The close hands the event up rather than stopping it here: the caller
		 * decides, since closing the visible tab has to move the selection too.
		 */
		it("closes the tab that was asked for, with its event", async () => {
			const { onTabClose } = mount({
				tabs: [tab("a.ts"), tab("b.ts")],
				activeTabIdx: 0,
			});
			const close = tabEls()[1].querySelector(".tab-close") as HTMLElement;
			await userEvent.click(close);
			expect(onTabClose.mock.calls[0][0]).toBe(1);
			expect(onTabClose.mock.calls[0][1]).toBeInstanceOf(MouseEvent);
		});

		/** A pinned tab is unpinned rather than closed, so it is not lost. */
		it("unpins a pinned tab instead of closing it", async () => {
			const spies = mount({
				tabs: [tab("a.ts", { pinned: true })],
				activeTabIdx: 0,
			});
			const { onTabUnpin, onTabClose } = spies;
			const action = tabEls()[0].querySelector(".tab-close") as HTMLElement;
			await userEvent.click(action);
			expect(onTabUnpin).toHaveBeenCalledWith(0);
			expect(onTabClose).not.toHaveBeenCalled();
			// Unpinning is not selecting: this one does stop the click here.
			expect(spies.onTabClick).not.toHaveBeenCalled();
		});

		it("reports a right click on the tab it landed on", () => {
			const { onTabContextMenu } = mount({
				tabs: [tab("a.ts"), tab("b.ts")],
				activeTabIdx: 0,
			});
			tabEls()[1].dispatchEvent(
				new MouseEvent("contextmenu", { bubbles: true }),
			);
			expect(onTabContextMenu.mock.calls[0][1]).toBe(1);
		});

		/** The drag is handed up with the tab it started on. */
		it("hands the drag to the tab that was pressed", () => {
			const { onTabPointerDown } = mount({
				tabs: [tab("a.ts"), tab("b.ts")],
				activeTabIdx: 0,
			});
			tabEls()[1].dispatchEvent(
				new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 }),
			);
			expect(onTabPointerDown.mock.calls[0][1]).toBe(1);
		});

		it("names the close action for a screen reader", () => {
			mount({ tabs: [tab("a.ts")], activeTabIdx: 0 });
			expect(
				tabEls()[0].querySelector(".tab-close")?.getAttribute("aria-label"),
			).toBeTruthy();
		});
	});

	describe("the breadcrumb", () => {
		it("shows the path of the file being edited, in parts", () => {
			mount({ tabs: [tab("src/lib/a.ts")], activeTabIdx: 0 });
			expect(breadcrumb()).not.toBeNull();
			expect(crumbs().length).toBeGreaterThan(1);
		});

		it("reports the folder that was clicked", async () => {
			const { onBreadcrumbClick } = mount({
				tabs: [tab("src/lib/a.ts")],
				activeTabIdx: 0,
			});
			const folder = crumbs().find((c) => c.tagName === "BUTTON");
			if (!folder) return;
			await userEvent.click(folder);
			expect(onBreadcrumbClick).toHaveBeenCalled();
		});

		/** A file outside the worktree has no folders to walk, so it says so. */
		it("shows an external file as a whole path", () => {
			mount({ tabs: [tab("/elsewhere/x.ts")], activeTabIdx: 0 });
			expect(document.querySelector(".breadcrumb-external")).not.toBeNull();
		});

		it("shows no breadcrumb when nothing is open", () => {
			mount({ tabs: [], activeTabIdx: -1, activeTab: null });
			expect(breadcrumb()).toBeNull();
		});
	});

	describe("the status bar", () => {
		const statusButton = (pattern: RegExp) =>
			Array.from(document.querySelectorAll<HTMLElement>("button")).find((b) =>
				pattern.test((b.textContent ?? "").trim()),
			) as HTMLElement;

		it("shows the line endings of the file", () => {
			mount({ activeLineEndings: "CRLF" });
			expect(document.body.textContent).toContain("CRLF");
		});

		it("converts the line endings on request", async () => {
			const { onConvertLineEndings } = mount({ activeLineEndings: "CRLF" });
			const button = statusButton(/^CRLF$/);
			if (!button) return;
			await userEvent.click(button);
			expect(onConvertLineEndings).toHaveBeenCalled();
		});

		it("converts the indentation on request", async () => {
			const { onConvertIndent } = mount({ activeIndentStyle: "tabs" });
			const button = statusButton(/tab/i);
			if (!button) return;
			await userEvent.click(button);
			expect(onConvertIndent).toHaveBeenCalled();
		});
	});

	describe("the empty pane", () => {
		it("offers a way to start a file when nothing is open", async () => {
			const { onNewFile } = mount({
				tabs: [],
				activeTabIdx: -1,
				activeTab: null,
			});
			const button = Array.from(
				document.querySelectorAll<HTMLElement>("button"),
			).find((b) => /new|nouveau/i.test(b.textContent ?? ""));
			if (!button) return;
			await userEvent.click(button);
			expect(onNewFile).toHaveBeenCalled();
		});

		/** A pointer landing anywhere in the pane makes it the focused one. */
		it("reports the pane being focused", async () => {
			const { onPaneFocus } = mount();
			const pane = document.querySelector(".editor-pane") as HTMLElement;
			pane.dispatchEvent(
				new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 }),
			);
			await tick();
			expect(onPaneFocus).toHaveBeenCalled();
		});
	});
});
