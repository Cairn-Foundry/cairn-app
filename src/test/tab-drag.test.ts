import { render } from "@testing-library/svelte";
import { tick } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The editor body is a CodeMirror view; nothing about the tab bar depends on it.
vi.mock("$lib/components/files/CodeEditor.svelte", async () => ({
	default: (await import("./stubs/CodeEditorStub.svelte")).default,
}));

const activeInstance = (await import("svelte/store")).writable<unknown>(null);
vi.mock("$lib/stores/instance", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	activeInstance: { subscribe: activeInstance.subscribe },
}));

vi.mock("$lib/services/file-service", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return {
		...actual,
		readDirTree: vi.fn().mockResolvedValue([]),
		readDirTreeCached: vi.fn().mockResolvedValue([]),
		listDirNames: vi.fn().mockResolvedValue([]),
		readFile: vi.fn().mockResolvedValue(""),
		fileMtimes: vi.fn().mockResolvedValue({}),
		writeFile: vi.fn().mockResolvedValue(undefined),
		gitStatus: vi.fn().mockResolvedValue({}),
		gitBlame: vi.fn().mockResolvedValue(new Map()),
		gitShowFile: vi.fn().mockResolvedValue(""),
	};
});

vi.mock("$lib/stores/git", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	getRemoteUrl: vi.fn().mockResolvedValue(""),
	refreshStatus: vi.fn().mockResolvedValue(undefined),
	setGitWatched: vi.fn(),
}));

// The pane restore runs on mount and overwrites whatever is open; an empty
// state lets the test decide which tabs exist.
vi.mock("$lib/utils/files/files-persistence", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	loadEditorState: vi
		.fn()
		.mockResolvedValue({ persisted: null, recentFiles: [] }),
	saveEditorState: vi.fn(),
}));

vi.mock("$lib/services/fs-watch-service", () => ({
	onFsChanged: vi.fn().mockResolvedValue(() => {}),
	watchWorktree: vi.fn().mockResolvedValue(undefined),
	unwatchWorktree: vi.fn().mockResolvedValue(undefined),
}));

const { activeProjectId } = await import("$lib/stores/project");
const { default: FilesView } = await import(
	"$lib/components/files/FilesView.svelte"
);

// jsdom implements neither pointer capture nor layout; both are what the
// hand-written drag reads, so both are supplied here.
beforeEach(() => {
	Element.prototype.setPointerCapture = vi.fn();
	Element.prototype.releasePointerCapture = vi.fn();
	// The file tree measures its viewport to decide what to render.
	global.ResizeObserver = class {
		observe() {}
		disconnect() {}
	} as unknown as typeof ResizeObserver;
	activeProjectId.set("p1");
	activeInstance.set({
		id: "i1",
		projectId: "p1",
		branch: "feature",
		worktreePath: "/worktrees/p1/i1",
	});
});

const TAB_WIDTH = 100;

/**
 * Lays the tab bar out as a row of equal tabs starting at x=0, which is the
 * geometry `computeTabInsertIndex` reads to pick the insert slot.
 */
function layOutTabs() {
	const bar = document.querySelector(".tabs-bar") as HTMLElement;
	// Svelte recreates the tab elements on every reorder, so the geometry is
	// read from the element's position in the bar rather than pinned to the
	// nodes that happened to exist when this ran.
	Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
		configurable: true,
		writable: true,
		value(this: HTMLElement) {
			if (this === bar)
				return {
					left: 0,
					right: 1000,
					top: 0,
					bottom: 30,
					width: 1000,
					height: 30,
				};
			if (!this.classList.contains("file-tab"))
				return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };
			const i = Array.from(
				bar.querySelectorAll<HTMLElement>(".file-tab"),
			).indexOf(this);
			return {
				left: i * TAB_WIDTH,
				right: (i + 1) * TAB_WIDTH,
				top: 0,
				bottom: 30,
				width: TAB_WIDTH,
				height: 30,
			};
		},
	});
	return bar;
}

const tabs = () =>
	Array.from(
		(
			document.querySelector(".tabs-bar") as HTMLElement
		).querySelectorAll<HTMLElement>(".file-tab"),
	);
const tabNames = () =>
	tabs().map((el) => el.querySelector(".tab-name")?.textContent);

/** The centre of the slot at `index`, in the geometry laid out above. */
const slotX = (index: number) => index * TAB_WIDTH + TAB_WIDTH / 2;

function pointer(type: string, x: number, y = 15) {
	return new PointerEvent(type, {
		bubbles: true,
		cancelable: true,
		clientX: x,
		clientY: y,
		pointerId: 1,
	});
}

/** Lets the pending opens - reads, diff and blame - run to completion. */
async function settle() {
	for (let i = 0; i < 5; i++) {
		await Promise.resolve();
		await tick();
	}
}

async function mountWithTabs(paths: string[]) {
	const view = render(FilesView);
	await settle();
	const component = view.component as unknown as {
		openFileByPath: (path: string) => void;
	};
	for (const path of paths) {
		component.openFileByPath(path);
		await settle();
	}
	layOutTabs();
	return view;
}

/** A complete drag gesture from one slot to another. */
function drag(tab: HTMLElement, from: number, to: number) {
	tab.dispatchEvent(pointer("pointerdown", from));
	tab.dispatchEvent(pointer("pointermove", to));
	tab.dispatchEvent(pointer("pointerup", to));
}

describe("editor tab dragging", () => {
	it("mounts a tab per opened file", async () => {
		await mountWithTabs(["a.ts", "b.ts", "c.ts"]);
		expect(tabNames()).toEqual(["a.ts", "b.ts", "c.ts"]);
	});

	it("reorders a tab dropped further right", async () => {
		await mountWithTabs(["a.ts", "b.ts", "c.ts"]);
		drag(tabs()[0], slotX(0), slotX(2));
		await tick();
		expect(tabNames()).toEqual(["b.ts", "c.ts", "a.ts"]);
	});

	it("reorders a tab dropped further left", async () => {
		await mountWithTabs(["a.ts", "b.ts", "c.ts"]);
		drag(tabs()[2], slotX(2), slotX(0));
		await tick();
		expect(tabNames()).toEqual(["a.ts", "c.ts", "b.ts"]);
	});

	/**
	 * Under the threshold the gesture is a click, not a drag - even when those
	 * few pixels already reach into the neighbouring slot, which they do on a
	 * tab pressed right at its edge.
	 */
	it("ignores a movement too small to be a drag", async () => {
		await mountWithTabs(["a.ts", "b.ts", "c.ts"]);
		const tab = tabs()[1];
		tab.dispatchEvent(pointer("pointerdown", 248));
		tab.dispatchEvent(pointer("pointermove", 252));
		tab.dispatchEvent(pointer("pointerup", 252));
		await tick();
		expect(tabNames()).toEqual(["a.ts", "b.ts", "c.ts"]);
	});

	/** Just past it, the same gesture moves the tab. */
	it("starts the drag once the movement passes the threshold", async () => {
		await mountWithTabs(["a.ts", "b.ts", "c.ts"]);
		const tab = tabs()[1];
		tab.dispatchEvent(pointer("pointerdown", 248));
		tab.dispatchEvent(pointer("pointermove", 255));
		tab.dispatchEvent(pointer("pointerup", 255));
		await tick();
		expect(tabNames()).toEqual(["a.ts", "c.ts", "b.ts"]);
	});

	it("captures the pointer on the element that carries the click", async () => {
		await mountWithTabs(["a.ts", "b.ts"]);
		const tab = tabs()[0];
		tab.dispatchEvent(pointer("pointerdown", slotX(0)));
		expect(Element.prototype.setPointerCapture).toHaveBeenCalledWith(1);
		const capturedOn = (
			Element.prototype.setPointerCapture as ReturnType<typeof vi.fn>
		).mock.instances[0];
		expect(capturedOn).toBe(tab);
	});

	/**
	 * A drag is not a selection. The browser follows the captured pointerup with
	 * a compatibility click on the same element, which the guard must swallow -
	 * hence a bare click event here rather than a fresh userEvent gesture, which
	 * would open with its own pointerdown and clear the guard first.
	 */
	it("never lets a drag double as selecting the tab", async () => {
		await mountWithTabs(["a.ts", "b.ts", "c.ts"]);
		const selected = () =>
			tabNames()[
				tabs().findIndex((el) => el.getAttribute("aria-selected") === "true")
			];
		expect(selected()).toBe("c.ts");

		const dragged = tabs()[0];
		drag(dragged, slotX(0), slotX(2));
		await settle();
		expect(tabNames()).toEqual(["b.ts", "c.ts", "a.ts"]);

		// The compatibility click the browser sends to the capturing element
		// after a captured pointerup. Svelte reuses the nodes and rewrites their
		// text, so the captured element now shows the tab that took slot 0.
		dragged.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		await settle();
		expect(selected()).toBe("c.ts");
	});

	/**
	 * The counterpart of the test above: the same bare click, with no drag
	 * before it, does select - so what swallows the post-drag one is the guard,
	 * not a handler that never runs under jsdom.
	 *
	 * That guard is written twice - once on the tab's own click in `EditorPane`,
	 * once around `switchTab` in `FilesView` - so removing either one alone
	 * leaves the behaviour intact and no assertion can tell them apart. Removing
	 * both fails the pair of tests, which is the behaviour that matters.
	 */
	it("still selects a tab on a plain click", async () => {
		await mountWithTabs(["a.ts", "b.ts", "c.ts"]);
		tabs()[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
		await settle();
		const selectedName =
			tabNames()[
				tabs().findIndex((el) => el.getAttribute("aria-selected") === "true")
			];
		expect(selectedName).toBe("a.ts");
	});

	it("marks the body as dragging while the drag runs, and clears it after", async () => {
		await mountWithTabs(["a.ts", "b.ts"]);
		const tab = tabs()[0];
		tab.dispatchEvent(pointer("pointerdown", slotX(0)));
		expect(document.body.classList.contains("dragging")).toBe(false);
		tab.dispatchEvent(pointer("pointermove", slotX(1)));
		expect(document.body.classList.contains("dragging")).toBe(true);
		tab.dispatchEvent(pointer("pointerup", slotX(1)));
		expect(document.body.classList.contains("dragging")).toBe(false);
	});

	/** A press on the close button belongs to that button, not to a drag. */
	it("leaves a press on an inner button alone", async () => {
		await mountWithTabs(["a.ts", "b.ts"]);
		const close = tabs()[0].querySelector(".tab-close") as HTMLElement;
		close.dispatchEvent(pointer("pointerdown", slotX(0)));
		expect(Element.prototype.setPointerCapture).not.toHaveBeenCalled();
	});

	/** Dropping a tab back where it started leaves the order untouched. */
	it("does nothing when the tab is dropped on its own slot", async () => {
		await mountWithTabs(["a.ts", "b.ts", "c.ts"]);
		drag(tabs()[1], slotX(1) - 20, slotX(1) + 20);
		await tick();
		expect(tabNames()).toEqual(["a.ts", "b.ts", "c.ts"]);
	});
});
