import { render, screen, within } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { conversation } from "../../../test/fixtures";
import ConversationHistoryPanel from "./ConversationHistoryPanel.svelte";

const handlers = () => ({
	onSelect: vi.fn(),
	onNewSession: vi.fn(),
	onRename: vi.fn(),
	onDelete: vi.fn(),
	onTogglePin: vi.fn(),
	onToggleArchive: vi.fn(),
	onMoveScope: vi.fn(),
});

// jsdom implements neither pointer capture nor layout; both are what the
// hand-written drag reads, so both are supplied here.
beforeEach(() => {
	Element.prototype.setPointerCapture = vi.fn();
	Element.prototype.releasePointerCapture = vi.fn();
});

function mount(props: Record<string, unknown> = {}) {
	const spies = handlers();
	const result = render(ConversationHistoryPanel, {
		instanceConversations: [],
		projectConversations: [],
		activeId: null,
		cliLabel: (cli: string) => cli,
		newSessionActive: false,
		...spies,
		...props,
	});
	return { ...result, ...spies };
}

/** The two collapsible groups, project first then instance. */
const sections = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".section"));
const rowsIn = (section: HTMLElement) =>
	Array.from(section.querySelectorAll<HTMLElement>(".row"));
const titlesIn = (section: HTMLElement) =>
	rowsIn(section).map((row) => row.querySelector(".row-label")?.textContent);
const rowNamed = (title: string) => {
	const label = Array.from(
		document.querySelectorAll<HTMLElement>(".row-label"),
	).find((el) => el.textContent === title);
	return label?.closest(".row") as HTMLElement;
};
/** Opens the row's action menu, which is what every row action goes through. */
async function openMenu(title: string) {
	const row = rowNamed(title);
	await userEvent.click(within(row).getByTitle(/actions/i));
	return row.querySelector(".row-dropdown") as HTMLElement;
}

describe("ConversationHistoryPanel", () => {
	describe("the two scopes", () => {
		it("lists project conversations before instance ones", () => {
			mount({
				projectConversations: [conversation("shared")],
				instanceConversations: [conversation("mine")],
			});
			expect(titlesIn(sections()[0])).toEqual(["shared"]);
			expect(titlesIn(sections()[1])).toEqual(["mine"]);
		});

		it("counts what each group shows, not what it holds", async () => {
			mount({
				projectConversations: [
					conversation("visible"),
					conversation("hidden", { archived: true }),
				],
			});
			const count = sections()[0].querySelector(".section-count");
			expect(count?.textContent).toBe("1");
		});

		it("hides a group's rows when it is collapsed, keeping the other open", async () => {
			mount({
				projectConversations: [conversation("shared")],
				instanceConversations: [conversation("mine")],
			});
			await userEvent.click(
				within(sections()[0]).getByRole("button", { expanded: true }),
			);
			expect(rowsIn(sections()[0])).toHaveLength(0);
			expect(titlesIn(sections()[1])).toEqual(["mine"]);
		});

		it("says a group is empty rather than showing nothing at all", () => {
			mount();
			expect(rowsIn(sections()[0])).toHaveLength(0);
			expect(sections()[0].querySelector(".section-empty")).not.toBeNull();
		});
	});

	describe("ordering", () => {
		it("puts pinned conversations first, then the most recently answered", () => {
			mount({
				projectConversations: [
					conversation("old", { lastOpenedAt: 10 }),
					conversation("recent", { lastOpenedAt: 300 }),
					conversation("pinned-old", { pinned: true, lastOpenedAt: 1 }),
				],
			});
			expect(titlesIn(sections()[0])).toEqual(["pinned-old", "recent", "old"]);
		});

		it("dates a conversation that never got an answer by its creation", () => {
			mount({
				projectConversations: [
					conversation("answered", { lastOpenedAt: 100 }),
					conversation("fresh", { createdAt: 500, lastOpenedAt: 0 }),
				],
			});
			expect(titlesIn(sections()[0])).toEqual(["fresh", "answered"]);
		});
	});

	describe("the archived filter", () => {
		it("shows only the active ones by default", () => {
			mount({
				projectConversations: [
					conversation("live"),
					conversation("filed", { archived: true }),
				],
			});
			expect(titlesIn(sections()[0])).toEqual(["live"]);
		});

		/** Archiving filters the same two groups, it never adds a third list. */
		it("swaps both groups to their archived rows, never adding a third", async () => {
			mount({
				projectConversations: [
					conversation("live"),
					conversation("filed", { archived: true }),
				],
				instanceConversations: [conversation("filed-mine", { archived: true })],
			});
			await userEvent.click(screen.getByRole("button", { name: /archiv/i }));
			expect(sections()).toHaveLength(2);
			expect(titlesIn(sections()[0])).toEqual(["filed"]);
			expect(titlesIn(sections()[1])).toEqual(["filed-mine"]);
		});

		it("counts the archived conversations of both scopes together", () => {
			mount({
				projectConversations: [conversation("a", { archived: true })],
				instanceConversations: [
					conversation("b", { archived: true }),
					conversation("c"),
				],
			});
			expect(document.querySelector(".filter-count")?.textContent).toBe("2");
		});

		it("shows no count when nothing is archived", () => {
			mount({ projectConversations: [conversation("a")] });
			expect(document.querySelector(".filter-count")).toBeNull();
		});

		/** Starting a session is an active-list action; there is none to start in the archive. */
		it("offers a new session on the active list only", async () => {
			mount();
			expect(document.querySelector(".new-session")).not.toBeNull();
			await userEvent.click(screen.getByRole("button", { name: /archiv/i }));
			expect(document.querySelector(".new-session")).toBeNull();
		});
	});

	describe("search", () => {
		it("matches on the title", async () => {
			mount({
				projectConversations: [
					conversation("refactor"),
					conversation("deploy"),
				],
			});
			await userEvent.type(screen.getByRole("textbox"), "refac");
			expect(titlesIn(sections()[0])).toEqual(["refactor"]);
		});

		it("matches on the title, which is all Cairn keeps of a conversation", () => {
			// The transcript belongs to the CLI, so there is no preview to search.
			mount({
				projectConversations: [
					conversation("fix the migration"),
					conversation("bump the version"),
				],
			});
			return userEvent
				.type(screen.getByRole("textbox"), "migration")
				.then(() => {
					expect(titlesIn(sections()[0])).toEqual(["fix the migration"]);
				});
		});

		it("ignores case and surrounding spaces", async () => {
			mount({ projectConversations: [conversation("Refactor")] });
			await userEvent.type(screen.getByRole("textbox"), "  REFAC ");
			expect(titlesIn(sections()[0])).toEqual(["Refactor"]);
		});

		it("searches inside the archive when the archive is shown", async () => {
			mount({
				projectConversations: [
					conversation("filed-refactor", { archived: true }),
					conversation("filed-deploy", { archived: true }),
					conversation("live-refactor"),
				],
			});
			await userEvent.click(screen.getByRole("button", { name: /archiv/i }));
			await userEvent.type(screen.getByRole("textbox"), "refactor");
			expect(titlesIn(sections()[0])).toEqual(["filed-refactor"]);
		});
	});

	describe("what a row shows", () => {
		it("marks the row with the logo of the CLI that owns the conversation", () => {
			mount({
				projectConversations: [conversation("mine", { cli: "opencode" })],
			});
			expect(rowNamed("mine").querySelector(".row-mark svg")).not.toBeNull();
		});

		/** The logo says which CLI it is; spelling the name out again is noise. */
		it("shows the title alone beside the logo, not the CLI's name", () => {
			mount({
				projectConversations: [conversation("fix the parser")],
				cliLabel: () => "Claude Code",
			});
			const row = rowNamed("fix the parser");
			expect(row.querySelector(".row-label")?.textContent).toBe(
				"fix the parser",
			);
			expect(row.textContent).not.toContain("Claude Code");
		});

		/**
		 * Whether a CLI is running is no longer shown here. Cairn does not read
		 * the CLI's output, so it cannot tell an answer from a prompt, and a dot
		 * that only meant "the process is alive" said less than it implied.
		 */
		it("shows no running indicator", () => {
			mount({ projectConversations: [conversation("any")] });
			expect(document.querySelector(".conv-busy-dot")).toBeNull();
		});

		/**
		 * The archive glyph carries the named sub-parts the icon stylesheet
		 * animates. Nothing is declared on the button: the shared rules key off
		 * the nearest interactive host, so a menu entry animates like a toolbar
		 * button without either of them opting in.
		 */
		it("draws the archive entry with the glyph the icon rules animate", async () => {
			mount({ projectConversations: [conversation("mine")] });
			const menu = await openMenu("mine");
			const entry = within(menu).getByRole("button", { name: /archive/i });
			const glyph = entry.querySelector(".ic-archive");
			expect(glyph).not.toBeNull();
			expect(glyph?.querySelector(".ic-archive-lid")).not.toBeNull();
			expect(glyph?.querySelector(".ic-archive-slot")).not.toBeNull();
		});

		/** A row action nobody can see is a row action nobody uses. */
		it("keeps the actions button on screen without hovering", () => {
			mount({ projectConversations: [conversation("mine")] });
			const menu = rowNamed("mine").querySelector<HTMLElement>(".row-menu");
			expect(menu).not.toBeNull();
			expect(getComputedStyle(menu as HTMLElement).opacity).not.toBe("0");
		});
	});

	describe("selecting", () => {
		it("reports the conversation and the scope it was clicked in", async () => {
			const { onSelect } = mount({
				projectConversations: [conversation("shared")],
				instanceConversations: [conversation("mine")],
			});
			await userEvent.click(rowNamed("mine"));
			expect(onSelect).toHaveBeenCalledWith("mine", "instance");
			await userEvent.click(rowNamed("shared"));
			expect(onSelect).toHaveBeenCalledWith("shared", "project");
		});

		it("opens a conversation from the keyboard", async () => {
			const { onSelect } = mount({
				projectConversations: [conversation("a")],
			});
			rowNamed("a").focus();
			await userEvent.keyboard("{Enter}");
			expect(onSelect).toHaveBeenCalledWith("a", "project");
		});
	});

	describe("row actions", () => {
		it("passes each action its conversation and scope", async () => {
			const spies = mount({
				instanceConversations: [conversation("mine")],
			});
			for (const [label, spy] of [
				[/pin/i, spies.onTogglePin],
				[/archive/i, spies.onToggleArchive],
			] as const) {
				const menu = await openMenu("mine");
				await userEvent.click(
					within(menu).getByRole("button", { name: label }),
				);
				expect(spy).toHaveBeenCalledWith("mine", "instance");
			}
		});

		it("offers to undo pinning and archiving once they are on", async () => {
			mount({
				projectConversations: [
					conversation("a", { pinned: true, archived: true }),
				],
			});
			await userEvent.click(screen.getByRole("button", { name: /archiv/i }));
			const menu = await openMenu("a");
			expect(within(menu).getByRole("button", { name: /unpin/i })).toBeTruthy();
			expect(
				within(menu).getByRole("button", { name: /unarchive/i }),
			).toBeTruthy();
		});

		it("keeps opening a conversation out of clicking its menu", async () => {
			const { onSelect } = mount({
				projectConversations: [conversation("a")],
			});
			await openMenu("a");
			expect(onSelect).not.toHaveBeenCalled();
		});

		it("closes the open menu when another row's menu opens", async () => {
			mount({
				projectConversations: [conversation("a"), conversation("b")],
			});
			await openMenu("a");
			await openMenu("b");
			expect(document.querySelectorAll(".row-dropdown")).toHaveLength(1);
		});
	});

	describe("renaming", () => {
		it("submits the new title on Enter", async () => {
			const { onRename } = mount({
				projectConversations: [conversation("before")],
			});
			const menu = await openMenu("before");
			await userEvent.click(
				within(menu).getByRole("button", { name: /rename/i }),
			);
			const input = document.querySelector(".rename-input") as HTMLInputElement;
			await userEvent.clear(input);
			await userEvent.type(input, "after{Enter}");
			expect(onRename).toHaveBeenCalledWith("before", "project", "after");
		});

		it("keeps the old title when Escape cancels", async () => {
			const { onRename } = mount({
				projectConversations: [conversation("before")],
			});
			const menu = await openMenu("before");
			await userEvent.click(
				within(menu).getByRole("button", { name: /rename/i }),
			);
			const input = document.querySelector(".rename-input") as HTMLInputElement;
			await userEvent.type(input, "x{Escape}");
			expect(onRename).not.toHaveBeenCalled();
			expect(document.querySelector(".rename-input")).toBeNull();
		});

		it("refuses a blank title rather than erasing the name", async () => {
			const { onRename } = mount({
				projectConversations: [conversation("before")],
			});
			const menu = await openMenu("before");
			await userEvent.click(
				within(menu).getByRole("button", { name: /rename/i }),
			);
			const input = document.querySelector(".rename-input") as HTMLInputElement;
			await userEvent.clear(input);
			await userEvent.type(input, "   {Enter}");
			expect(onRename).not.toHaveBeenCalled();
		});

		it("trims what it submits", async () => {
			const { onRename } = mount({
				projectConversations: [conversation("before")],
			});
			const menu = await openMenu("before");
			await userEvent.click(
				within(menu).getByRole("button", { name: /rename/i }),
			);
			const input = document.querySelector(".rename-input") as HTMLInputElement;
			await userEvent.clear(input);
			await userEvent.type(input, "  after  {Enter}");
			expect(onRename).toHaveBeenCalledWith("before", "project", "after");
		});
	});

	describe("deleting", () => {
		it("asks before deleting", async () => {
			const { onDelete } = mount({
				projectConversations: [conversation("doomed")],
			});
			const menu = await openMenu("doomed");
			await userEvent.click(
				within(menu).getByRole("button", { name: /delete/i }),
			);
			expect(onDelete).not.toHaveBeenCalled();
			expect(screen.getByRole("dialog")).toBeTruthy();
		});

		it("deletes the conversation the confirmation named", async () => {
			const { onDelete } = mount({
				instanceConversations: [conversation("doomed")],
			});
			const menu = await openMenu("doomed");
			await userEvent.click(
				within(menu).getByRole("button", { name: /delete/i }),
			);
			const dialog = screen.getByRole("dialog");
			const confirm = within(dialog)
				.getAllByRole("button")
				.filter((b) => /delete|supprimer/i.test(b.textContent ?? ""))
				.pop() as HTMLElement;
			await userEvent.click(confirm);
			expect(onDelete).toHaveBeenCalledWith("doomed", "instance");
		});
	});

	describe("new session", () => {
		it("starts one on request", async () => {
			const { onNewSession } = mount();
			await userEvent.click(
				document.querySelector(".new-session") as HTMLElement,
			);
			expect(onNewSession).toHaveBeenCalled();
		});

		it("shows itself as the current one while it is unsaved", () => {
			mount({ newSessionActive: true });
			expect(
				document.querySelector(".new-session")?.classList.contains("active"),
			).toBe(true);
		});
	});
});

/**
 * The drag is written on pointer events on purpose: the webview swallows the
 * HTML5 drag API. jsdom supplies neither pointer capture nor layout, so both
 * are stubbed - the geometry is what the component reads to pick a drop target.
 */
describe("ConversationHistoryPanel dragging between scopes", () => {
	const PROJECT_Y = 50;
	const INSTANCE_Y = 200;

	/** Stacks the project section above the instance one, as the panel renders them. */
	function layOutSections() {
		const [project, instance] = sections();
		project.getBoundingClientRect = () => ({ top: 0, bottom: 100 }) as DOMRect;
		instance.getBoundingClientRect = () =>
			({ top: 100, bottom: 300 }) as DOMRect;
	}

	function pointer(type: string, y: number) {
		return new PointerEvent(type, {
			bubbles: true,
			cancelable: true,
			clientX: 0,
			clientY: y,
			pointerId: 1,
		});
	}

	function mountTwoScopes() {
		const spies = handlers();
		render(ConversationHistoryPanel, {
			projectConversations: [conversation("shared")],
			instanceConversations: [conversation("mine")],
			activeId: null,
			cliLabel: (cli: string) => cli,
			newSessionActive: false,
			...spies,
		});
		layOutSections();
		return spies;
	}

	function drag(row: HTMLElement, from: number, to: number) {
		row.dispatchEvent(pointer("pointerdown", from));
		row.dispatchEvent(pointer("pointermove", to));
		row.dispatchEvent(pointer("pointerup", to));
	}

	it("moves a conversation to the other scope", () => {
		const { onMoveScope } = mountTwoScopes();
		drag(rowNamed("mine"), INSTANCE_Y, PROJECT_Y);
		expect(onMoveScope).toHaveBeenCalledWith("instance", "mine");
	});

	it("moves it back the other way", () => {
		const { onMoveScope } = mountTwoScopes();
		drag(rowNamed("shared"), PROJECT_Y, INSTANCE_Y);
		expect(onMoveScope).toHaveBeenCalledWith("project", "shared");
	});

	it("does nothing when the row is dropped on its own scope", () => {
		const { onMoveScope } = mountTwoScopes();
		drag(rowNamed("mine"), INSTANCE_Y, INSTANCE_Y + 50);
		expect(onMoveScope).not.toHaveBeenCalled();
	});

	it("does nothing when the row is dropped outside any scope", () => {
		const { onMoveScope } = mountTwoScopes();
		drag(rowNamed("mine"), INSTANCE_Y, 900);
		expect(onMoveScope).not.toHaveBeenCalled();
	});

	/**
	 * Under the threshold the gesture is a click, not a drag - even when those
	 * few pixels already cross into the other scope, which they do on a row
	 * sitting right at the boundary.
	 */
	it("ignores a movement too small to be a drag", () => {
		const { onMoveScope } = mountTwoScopes();
		const row = rowNamed("mine");
		row.dispatchEvent(pointer("pointerdown", 102));
		row.dispatchEvent(pointer("pointermove", 98));
		row.dispatchEvent(pointer("pointerup", 98));
		expect(onMoveScope).not.toHaveBeenCalled();
	});

	/** Just past it, the same gesture is a drag. */
	it("starts the drag once the movement passes the threshold", () => {
		const { onMoveScope } = mountTwoScopes();
		const row = rowNamed("mine");
		row.dispatchEvent(pointer("pointerdown", 102));
		row.dispatchEvent(pointer("pointermove", 95));
		row.dispatchEvent(pointer("pointerup", 95));
		expect(onMoveScope).toHaveBeenCalledWith("instance", "mine");
	});

	it("captures the pointer on the element that carries the click", () => {
		mountTwoScopes();
		const row = rowNamed("mine");
		row.dispatchEvent(pointer("pointerdown", INSTANCE_Y));
		expect(Element.prototype.setPointerCapture).toHaveBeenCalledWith(1);
		const capturedOn = (
			Element.prototype.setPointerCapture as ReturnType<typeof vi.fn>
		).mock.instances[0];
		expect(capturedOn).toBe(row);
		expect(row.onclick ?? row.getAttribute("role")).toBeTruthy();
	});

	/**
	 * A drag is not a selection. The browser follows the captured pointerup with
	 * a compatibility click on the same element, which the guard must swallow -
	 * hence a bare click event here rather than a fresh userEvent gesture, which
	 * would open with its own pointerdown and clear the guard first.
	 */
	it("never lets a drag double as opening the conversation", () => {
		const { onMoveScope, onSelect } = mountTwoScopes();
		const row = rowNamed("mine");
		drag(row, INSTANCE_Y, PROJECT_Y);
		row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		expect(onMoveScope).toHaveBeenCalled();
		expect(onSelect).not.toHaveBeenCalled();
	});

	/** ...and the guard clears, so the next plain click still selects. */
	it("selects again on the click after a drag", async () => {
		const { onSelect } = mountTwoScopes();
		const row = rowNamed("mine");
		drag(row, INSTANCE_Y, PROJECT_Y);
		row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		await userEvent.click(row);
		expect(onSelect).toHaveBeenCalledWith("mine", "instance");
	});

	it("highlights the scope the row would land in, and drops it after", async () => {
		mountTwoScopes();
		const row = rowNamed("mine");
		row.dispatchEvent(pointer("pointerdown", INSTANCE_Y));
		row.dispatchEvent(pointer("pointermove", PROJECT_Y));
		await tick();
		expect(sections()[0].classList.contains("drop-target")).toBe(true);
		row.dispatchEvent(pointer("pointerup", PROJECT_Y));
		await tick();
		expect(sections()[0].classList.contains("drop-target")).toBe(false);
	});

	it("leaves the body cursor alone once the drag ends", () => {
		mountTwoScopes();
		const row = rowNamed("mine");
		row.dispatchEvent(pointer("pointerdown", INSTANCE_Y));
		row.dispatchEvent(pointer("pointermove", PROJECT_Y));
		expect(document.body.classList.contains("dragging")).toBe(true);
		row.dispatchEvent(pointer("pointerup", PROJECT_Y));
		expect(document.body.classList.contains("dragging")).toBe(false);
	});

	it("does not start a drag from the row menu", () => {
		const { onMoveScope } = mountTwoScopes();
		const row = rowNamed("mine");
		const menu = row.querySelector(".row-menu") as HTMLElement;
		menu.dispatchEvent(pointer("pointerdown", INSTANCE_Y));
		row.dispatchEvent(pointer("pointermove", PROJECT_Y));
		row.dispatchEvent(pointer("pointerup", PROJECT_Y));
		expect(onMoveScope).not.toHaveBeenCalled();
	});

	/** Archived rows are a filtered view; moving one between scopes is not offered. */
	it("does not drag from the archive", async () => {
		const spies = handlers();
		render(ConversationHistoryPanel, {
			projectConversations: [conversation("shared", { archived: true })],
			instanceConversations: [conversation("mine", { archived: true })],
			activeId: null,
			cliLabel: (cli: string) => cli,
			newSessionActive: false,
			...spies,
		});
		await userEvent.click(screen.getByRole("button", { name: /archiv/i }));
		layOutSections();
		drag(rowNamed("mine"), INSTANCE_Y, PROJECT_Y);
		expect(spies.onMoveScope).not.toHaveBeenCalled();
	});
});
