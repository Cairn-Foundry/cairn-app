// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalSession } from "$lib/stores/terminal";

const attach = vi.fn<(...a: unknown[]) => unknown>();
const detach = vi.fn<(...a: unknown[]) => unknown>();
const focus = vi.fn<(...a: unknown[]) => unknown>();
const refit = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/utils/terminal/terminal-manager", () => ({
	attach: (...a: unknown[]) => attach(...a),
	detach: (...a: unknown[]) => detach(...a),
	focus: (...a: unknown[]) => focus(...a),
	refit: (...a: unknown[]) => refit(...a),
	observeInput: vi.fn(),
	observeOutput: vi.fn(),
}));

const prepareInstanceEnv = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/stores/env", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	prepareInstanceEnv: (...a: unknown[]) => prepareInstanceEnv(...a),
}));

const addTerminal = vi.fn<(...a: unknown[]) => unknown>();
const addProjectTerminal = vi.fn<(...a: unknown[]) => unknown>();
const removeTerminal = vi.fn<(...a: unknown[]) => unknown>();
const removeProjectTerminal = vi.fn<(...a: unknown[]) => unknown>();
const setActiveTerminal = vi.fn<(...a: unknown[]) => unknown>();
const renameTerminal = vi.fn<(...a: unknown[]) => unknown>();
const renameProjectTerminal = vi.fn<(...a: unknown[]) => unknown>();
const reorderTerminal = vi.fn<(...a: unknown[]) => unknown>();
const reorderProjectTerminal = vi.fn<(...a: unknown[]) => unknown>();
const shareTerminal = vi.fn<(...a: unknown[]) => unknown>();
const unshareTerminal = vi.fn<(...a: unknown[]) => unknown>();
const restoreTerminals = vi.fn<(...a: unknown[]) => unknown>();
const restoreProjectTerminals = vi.fn<(...a: unknown[]) => unknown>();
const openSplitTerminal = vi.fn<(...a: unknown[]) => unknown>();
const closeSplitTerminal = vi.fn<(...a: unknown[]) => unknown>();
const setSplitRatio = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/stores/terminal", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	addTerminal: (...a: unknown[]) => addTerminal(...a),
	addProjectTerminal: (...a: unknown[]) => addProjectTerminal(...a),
	removeTerminal: (...a: unknown[]) => removeTerminal(...a),
	removeProjectTerminal: (...a: unknown[]) => removeProjectTerminal(...a),
	setActiveTerminal: (...a: unknown[]) => setActiveTerminal(...a),
	renameTerminal: (...a: unknown[]) => renameTerminal(...a),
	renameProjectTerminal: (...a: unknown[]) => renameProjectTerminal(...a),
	reorderTerminal: (...a: unknown[]) => reorderTerminal(...a),
	reorderProjectTerminal: (...a: unknown[]) => reorderProjectTerminal(...a),
	shareTerminal: (...a: unknown[]) => shareTerminal(...a),
	unshareTerminal: (...a: unknown[]) => unshareTerminal(...a),
	restoreTerminals: (...a: unknown[]) => restoreTerminals(...a),
	restoreProjectTerminals: (...a: unknown[]) => restoreProjectTerminals(...a),
	openSplitTerminal: (...a: unknown[]) => openSplitTerminal(...a),
	closeSplitTerminal: (...a: unknown[]) => closeSplitTerminal(...a),
	setSplitRatio: (...a: unknown[]) => setSplitRatio(...a),
}));

const activeInstance = writable<unknown>(null);
vi.mock("$lib/stores/instance", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	activeInstance: { subscribe: activeInstance.subscribe },
}));

const {
	terminalSessions,
	projectTerminals,
	activeTerminalId,
	splitTerminalId,
	splitTerminalRatio,
	terminalScope,
} = await import("$lib/stores/terminal");
const { terminalActive } = await import("$lib/stores/ui");
const { projects, activeProjectId } = await import("$lib/stores/project");
const { project } = await import("./fixtures");
const { default: TerminalView } = await import(
	"$lib/components/terminal/TerminalView.svelte"
);

const SCOPE = terminalScope("p1", "i1");

function session(id: string, title = id): TerminalSession {
	return { id, title };
}

function mount() {
	render(TerminalView, { props: {} });
}

const sections = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".term-section"));
const itemsIn = (section: HTMLElement) =>
	Array.from(section.querySelectorAll<HTMLElement>(".term-item"));
const titlesIn = (section: HTMLElement) =>
	itemsIn(section).map((i) =>
		i.querySelector(".term-item-title")?.textContent?.trim(),
	);
const projectSection = () => sections()[0];
const instanceSection = () => sections()[1];
const commandSection = () => sections()[2];
const allItems = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".term-item"));
const splitToggle = () =>
	document.querySelector(".term-split-toggle") as HTMLButtonElement;
const panes = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".term-pane"));
const ctxItems = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".ctx-item"));
const ctxItem = (re: RegExp) =>
	ctxItems().find((b) => re.test(b.textContent ?? "")) as HTMLElement;
const renameInput = () =>
	document.querySelector(".term-item-input") as HTMLInputElement;
const dropIndicators = () => document.querySelectorAll(".term-drop");

async function settle() {
	await tick();
	await tick();
	await tick();
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

/** Lays the two scope lists out vertically: project 0-100, instance 200-300. */
function layOut() {
	const bodies = Array.from(
		document.querySelectorAll<HTMLElement>(".term-list-body"),
	);
	bodies[0].getBoundingClientRect = () => ({ top: 0, bottom: 100 }) as DOMRect;
	bodies[1].getBoundingClientRect = () =>
		({ top: 200, bottom: 300 }) as DOMRect;
	bodies.forEach((body, bodyIndex) => {
		const origin = bodyIndex === 0 ? 0 : 200;
		Array.from(body.querySelectorAll<HTMLElement>(".term-item")).forEach(
			(item, i) => {
				item.getBoundingClientRect = () =>
					({
						top: origin + i * 30,
						bottom: origin + i * 30 + 30,
						height: 30,
					}) as DOMRect;
			},
		);
	});
}

async function drag(item: HTMLElement, toY: number) {
	item.dispatchEvent(pointer("pointerdown", 0));
	await settle();
	layOut();
	item.dispatchEvent(pointer("pointermove", toY));
	await settle();
	item.dispatchEvent(pointer("pointerup", toY));
	await settle();
}

beforeEach(() => {
	Element.prototype.setPointerCapture = vi.fn();
	Element.prototype.releasePointerCapture = vi.fn();
	document.body.classList.remove("dragging");
	vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
		fn(0);
		return 0;
	});
	attach.mockClear();
	detach.mockClear();
	focus.mockClear();
	refit.mockClear();
	prepareInstanceEnv.mockReset().mockResolvedValue({});
	for (const fn of [
		addTerminal,
		addProjectTerminal,
		removeTerminal,
		removeProjectTerminal,
		setActiveTerminal,
		renameTerminal,
		renameProjectTerminal,
		reorderTerminal,
		reorderProjectTerminal,
		shareTerminal,
		unshareTerminal,
		restoreTerminals,
		restoreProjectTerminals,
		openSplitTerminal,
		closeSplitTerminal,
		setSplitRatio,
	])
		fn.mockReset().mockResolvedValue(undefined);
	projects.set([project("p1")]);
	activeProjectId.set("p1");
	activeInstance.set({ id: "i1", projectId: "p1", worktreePath: "/wt" });
	terminalActive.set(true);
	terminalSessions.set({ [SCOPE]: [session("t1", "shell")] });
	projectTerminals.set({ p1: [] });
	activeTerminalId.set({ [SCOPE]: "t1" });
	splitTerminalId.set({});
	splitTerminalRatio.set({});
});

describe("TerminalView", () => {
	describe("the two scopes", () => {
		it("keeps the project terminals apart from the instance's", async () => {
			projectTerminals.set({
				p1: [{ ...session("s1", "shared"), cwd: "/wt" }],
			});
			mount();
			await settle();
			expect(titlesIn(projectSection())).toEqual(["shared"]);
			expect(titlesIn(instanceSection())).toEqual(["shell"]);
		});

		/** A command terminal is neither: it belongs to the command that spawned it. */
		it("keeps a command terminal in its own section", async () => {
			terminalSessions.set({
				[SCOPE]: [
					session("t1", "shell"),
					{ ...session("c1", "build"), commandId: "cmd1" },
				],
			});
			mount();
			await settle();
			expect(titlesIn(instanceSection())).toEqual(["shell"]);
			expect(titlesIn(commandSection())).toEqual(["build"]);
		});

		it("says each empty section is empty", async () => {
			terminalSessions.set({ [SCOPE]: [] });
			mount();
			await settle();
			expect(document.querySelectorAll(".term-section-empty").length).toBe(3);
		});

		/** Another project's terminals are not this one's. */
		it("shows nothing from another project", async () => {
			projectTerminals.set({
				p1: [{ ...session("s1", "mine"), cwd: null }],
				p2: [{ ...session("s2", "theirs"), cwd: null }],
			});
			mount();
			await settle();
			expect(titlesIn(projectSection())).toEqual(["mine"]);
		});
	});

	describe("opening a terminal", () => {
		it("spawns an instance shell", async () => {
			mount();
			await settle();
			await userEvent.click(
				instanceSection().querySelector(".term-add") as HTMLElement,
			);
			await settle();
			expect(addTerminal).toHaveBeenCalledWith("p1", "i1", "/wt", {});
		});

		it("spawns a shared shell in the project scope", async () => {
			mount();
			await settle();
			await userEvent.click(
				projectSection().querySelector(".term-add") as HTMLElement,
			);
			await settle();
			expect(addProjectTerminal).toHaveBeenCalledWith("p1", "i1", "/wt", {});
		});

		/** With no instance there is no worktree to spawn a shell in. */
		it("spawns nothing with no instance", async () => {
			activeInstance.set(null);
			mount();
			await settle();
			expect(
				(instanceSection().querySelector(".term-add") as HTMLButtonElement)
					.disabled,
			).toBe(true);
		});

		it("offers to open one when there is none at all", async () => {
			terminalSessions.set({ [SCOPE]: [] });
			mount();
			await settle();
			await userEvent.click(
				document.querySelector(".term-empty .btn.primary") as HTMLElement,
			);
			await settle();
			expect(addTerminal).toHaveBeenCalled();
		});
	});

	describe("attaching the panes", () => {
		/** The DOM node is a mount point: the PTY lives in the manager. */
		it("attaches the active terminal to the pane", async () => {
			mount();
			await settle();
			expect(attach).toHaveBeenCalledWith("t1", expect.anything());
		});

		it("attaches nothing while the tool is closed", async () => {
			terminalActive.set(false);
			mount();
			await settle();
			expect(attach).not.toHaveBeenCalled();
		});

		it("restores the terminals of both scopes when opened", async () => {
			mount();
			await settle();
			expect(restoreProjectTerminals).toHaveBeenCalledWith("p1", {});
			expect(restoreTerminals).toHaveBeenCalledWith("p1", "i1", "/wt", {});
		});

		it("focuses the pane it attached", async () => {
			mount();
			await settle();
			expect(focus).toHaveBeenCalledWith("t1");
		});
	});

	describe("selecting a terminal", () => {
		beforeEach(() => {
			terminalSessions.set({
				[SCOPE]: [session("t1", "one"), session("t2", "two")],
			});
		});

		it("makes the terminal that was clicked the active one", async () => {
			mount();
			await settle();
			await userEvent.click(allItems()[1]);
			await settle();
			expect(setActiveTerminal).toHaveBeenCalledWith("p1", "i1", "t2", 0);
		});

		it("marks the active terminal", async () => {
			mount();
			await settle();
			expect(allItems()[0].classList.contains("active")).toBe(true);
			expect(allItems()[1].classList.contains("active")).toBe(false);
		});
	});

	describe("the split", () => {
		beforeEach(() => {
			terminalSessions.set({
				[SCOPE]: [session("t1", "one"), session("t2", "two")],
			});
		});

		it("shows one pane until it is split", async () => {
			mount();
			await settle();
			expect(panes()).toHaveLength(1);
		});

		it("opens a second pane on the other terminal", async () => {
			mount();
			await settle();
			await userEvent.click(splitToggle());
			await settle();
			expect(openSplitTerminal).toHaveBeenCalledWith("p1", "i1", "t2");
		});

		it("shows both panes once split", async () => {
			splitTerminalId.set({ [SCOPE]: "t2" });
			mount();
			await settle();
			expect(panes()).toHaveLength(2);
			expect(attach).toHaveBeenCalledWith("t2", expect.anything());
		});

		it("closes the split on the same button", async () => {
			splitTerminalId.set({ [SCOPE]: "t2" });
			mount();
			await settle();
			await userEvent.click(splitToggle());
			await settle();
			expect(closeSplitTerminal).toHaveBeenCalledWith("p1", "i1");
		});

		/** A split naming the terminal already active is not a split. */
		it("ignores a split pointing at the active terminal", async () => {
			splitTerminalId.set({ [SCOPE]: "t1" });
			mount();
			await settle();
			expect(panes()).toHaveLength(1);
		});

		it("ignores a split naming a terminal that is gone", async () => {
			splitTerminalId.set({ [SCOPE]: "vanished" });
			mount();
			await settle();
			expect(panes()).toHaveLength(1);
		});

		it("sizes the panes from the stored ratio", async () => {
			splitTerminalId.set({ [SCOPE]: "t2" });
			splitTerminalRatio.set({ [SCOPE]: 0.3 });
			mount();
			await settle();
			expect(panes()[0].getAttribute("style")).toContain("30%");
		});

		/** The split bar is clamped so neither pane can collapse. */
		it("clamps the split bar rather than collapsing a pane", async () => {
			splitTerminalId.set({ [SCOPE]: "t2" });
			mount();
			await settle();
			const panesEl = document.querySelector(".term-panes") as HTMLElement;
			panesEl.getBoundingClientRect = () =>
				({ left: 0, width: 1000 }) as DOMRect;
			const handle = document.querySelector(
				".term-split-handle",
			) as HTMLElement;
			handle.dispatchEvent(
				new PointerEvent("pointerdown", { bubbles: true, cancelable: true }),
			);
			window.dispatchEvent(
				new PointerEvent("pointermove", { clientX: 10, bubbles: true }),
			);
			await settle();
			expect(setSplitRatio).toHaveBeenCalledWith("p1", "i1", 0.15);
			window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
		});

		it("follows the bar between the two bounds", async () => {
			splitTerminalId.set({ [SCOPE]: "t2" });
			mount();
			await settle();
			const panesEl = document.querySelector(".term-panes") as HTMLElement;
			panesEl.getBoundingClientRect = () =>
				({ left: 0, width: 1000 }) as DOMRect;
			(
				document.querySelector(".term-split-handle") as HTMLElement
			).dispatchEvent(
				new PointerEvent("pointerdown", { bubbles: true, cancelable: true }),
			);
			window.dispatchEvent(
				new PointerEvent("pointermove", { clientX: 400, bubbles: true }),
			);
			await settle();
			expect(setSplitRatio).toHaveBeenCalledWith("p1", "i1", 0.4);
			window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
		});

		/** Selecting the terminal already in the other pane moves the focus there. */
		it("moves the focus rather than reassigning a pane", async () => {
			splitTerminalId.set({ [SCOPE]: "t2" });
			mount();
			await settle();
			await userEvent.click(allItems()[1]);
			await settle();
			expect(setActiveTerminal).not.toHaveBeenCalled();
		});
	});

	describe("renaming", () => {
		it("renames an instance terminal", async () => {
			mount();
			await settle();
			await userEvent.dblClick(allItems()[0]);
			await settle();
			await userEvent.clear(renameInput());
			await userEvent.type(renameInput(), "build{Enter}");
			await settle();
			expect(renameTerminal).toHaveBeenCalledWith("p1", "i1", "t1", "build");
		});

		it("renames a project terminal in its own scope", async () => {
			projectTerminals.set({
				p1: [{ ...session("s1", "shared"), cwd: "/wt" }],
			});
			mount();
			await settle();
			await userEvent.dblClick(itemsIn(projectSection())[0]);
			await settle();
			await userEvent.clear(renameInput());
			await userEvent.type(renameInput(), "deploy{Enter}");
			await settle();
			expect(renameProjectTerminal).toHaveBeenCalledWith("p1", "s1", "deploy");
			expect(renameTerminal).not.toHaveBeenCalled();
		});

		it("keeps the old name on Escape", async () => {
			mount();
			await settle();
			await userEvent.dblClick(allItems()[0]);
			await settle();
			await userEvent.clear(renameInput());
			await userEvent.type(renameInput(), "build{Escape}");
			await settle();
			expect(renameTerminal).not.toHaveBeenCalled();
			expect(renameInput()).toBeNull();
		});

		/** A blank name would leave the terminal unnameable in the list. */
		it("refuses a blank name", async () => {
			mount();
			await settle();
			await userEvent.dblClick(allItems()[0]);
			await settle();
			await userEvent.clear(renameInput());
			await userEvent.type(renameInput(), "   {Enter}");
			await settle();
			expect(renameTerminal).not.toHaveBeenCalled();
		});
	});

	describe("closing", () => {
		it("closes an instance terminal in its own scope", async () => {
			mount();
			await settle();
			await userEvent.click(
				allItems()[0].querySelector(".term-item-close") as HTMLElement,
			);
			await settle();
			expect(removeTerminal).toHaveBeenCalledWith("p1", "i1", "t1");
		});

		it("closes a project terminal in its own scope", async () => {
			projectTerminals.set({
				p1: [{ ...session("s1", "shared"), cwd: "/wt" }],
			});
			mount();
			await settle();
			await userEvent.click(
				itemsIn(projectSection())[0].querySelector(
					".term-item-close",
				) as HTMLElement,
			);
			await settle();
			expect(removeProjectTerminal).toHaveBeenCalledWith("p1", "s1");
			expect(removeTerminal).not.toHaveBeenCalled();
		});

		/** Closing a terminal must not also select it. */
		it("does not select the terminal being closed", async () => {
			terminalSessions.set({
				[SCOPE]: [session("t1", "one"), session("t2", "two")],
			});
			mount();
			await settle();
			await userEvent.click(
				allItems()[1].querySelector(".term-item-close") as HTMLElement,
			);
			await settle();
			expect(setActiveTerminal).not.toHaveBeenCalled();
		});
	});

	describe("the context menu", () => {
		beforeEach(() => {
			terminalSessions.set({
				[SCOPE]: [session("t1", "one"), session("t2", "two")],
			});
		});

		function rightClick(el: HTMLElement) {
			el.dispatchEvent(
				new MouseEvent("contextmenu", {
					bubbles: true,
					cancelable: true,
					clientX: 20,
					clientY: 30,
				}),
			);
		}

		it("opens on a right click", async () => {
			mount();
			await settle();
			rightClick(allItems()[0]);
			await settle();
			expect(ctxItems().length).toBeGreaterThan(0);
		});

		it("closes on a click outside", async () => {
			mount();
			await settle();
			rightClick(allItems()[0]);
			await settle();
			(document.querySelector(".ctx-backdrop") as HTMLElement).dispatchEvent(
				new MouseEvent("mousedown", { bubbles: true }),
			);
			await settle();
			expect(ctxItems()).toHaveLength(0);
		});

		it("renames from the menu", async () => {
			mount();
			await settle();
			rightClick(allItems()[0]);
			await settle();
			await userEvent.click(ctxItem(/rename|renommer/i));
			await settle();
			expect(renameInput()).not.toBeNull();
		});

		/** Moving a terminal to the project scope keeps its PTY running. */
		it("shares an instance terminal with the project", async () => {
			mount();
			await settle();
			rightClick(allItems()[0]);
			await settle();
			await userEvent.click(ctxItem(/shar|project|projet|partag/i));
			await settle();
			expect(shareTerminal).toHaveBeenCalledWith("p1", "i1", "t1", "/wt", 0);
		});

		it("takes a project terminal back to the instance", async () => {
			projectTerminals.set({
				p1: [{ ...session("s1", "shared"), cwd: "/wt" }],
			});
			mount();
			await settle();
			rightClick(itemsIn(projectSection())[0]);
			await settle();
			await userEvent.click(ctxItem(/shar|instance|projet|partag/i));
			await settle();
			expect(unshareTerminal).toHaveBeenCalledWith("p1", "i1", "s1", 2);
		});

		it("closes every other terminal", async () => {
			mount();
			await settle();
			rightClick(allItems()[0]);
			await settle();
			await userEvent.click(ctxItem(/other|autres/i));
			await settle();
			expect(removeTerminal).toHaveBeenCalledTimes(1);
			expect(removeTerminal).toHaveBeenCalledWith("p1", "i1", "t2");
		});
	});

	describe("dragging a terminal", () => {
		beforeEach(() => {
			projectTerminals.set({
				p1: [{ ...session("s1", "shared"), cwd: "/wt" }],
			});
			terminalSessions.set({
				[SCOPE]: [session("t1", "one"), session("t2", "two")],
			});
		});

		/** Below the threshold the gesture is a click, not a drag. */
		it("treats a small movement as a click", async () => {
			mount();
			await settle();
			layOut();
			const item = itemsIn(instanceSection())[0];
			item.dispatchEvent(pointer("pointerdown", 200));
			await settle();
			item.dispatchEvent(pointer("pointermove", 203));
			await settle();
			item.dispatchEvent(pointer("pointerup", 203));
			await settle();
			expect(reorderTerminal).not.toHaveBeenCalled();
		});

		/**
		 * The instance section only shows the shells, so a command terminal
		 * sitting before them shifts every stored index by one.
		 */
		it("reorders by the stored index, not the shown one", async () => {
			terminalSessions.set({
				[SCOPE]: [
					{ ...session("c1", "build"), commandId: "cmd1" },
					session("t1", "one"),
					session("t2", "two"),
				],
			});
			mount();
			await settle();
			layOut();
			await drag(itemsIn(instanceSection())[0], 295);
			expect(reorderTerminal).toHaveBeenCalledWith("p1", "i1", 1, 3);
		});

		it("reorders within the instance scope", async () => {
			mount();
			await settle();
			layOut();
			await drag(itemsIn(instanceSection())[0], 295);
			expect(reorderTerminal).toHaveBeenCalledWith("p1", "i1", 0, 2);
		});

		/** Dragging across the sections moves the terminal to the other scope. */
		it("shares a terminal dragged into the project section", async () => {
			mount();
			await settle();
			layOut();
			await drag(itemsIn(instanceSection())[0], 10);
			expect(shareTerminal).toHaveBeenCalledWith("p1", "i1", "t1", "/wt", 0);
		});

		it("unshares a terminal dragged into the instance section", async () => {
			mount();
			await settle();
			layOut();
			await drag(itemsIn(projectSection())[0], 295);
			expect(unshareTerminal).toHaveBeenCalledWith("p1", "i1", "s1", 2);
		});

		it("shows a drop line where the terminal would land", async () => {
			mount();
			await settle();
			layOut();
			const item = itemsIn(instanceSection())[0];
			item.dispatchEvent(pointer("pointerdown", 200));
			await settle();
			layOut();
			item.dispatchEvent(pointer("pointermove", 295));
			await settle();
			expect(dropIndicators()).toHaveLength(1);
		});

		it("shows no drop line for a drop that changes nothing", async () => {
			mount();
			await settle();
			layOut();
			const item = itemsIn(instanceSection())[0];
			item.dispatchEvent(pointer("pointerdown", 200));
			await settle();
			layOut();
			item.dispatchEvent(pointer("pointermove", 210));
			await settle();
			expect(dropIndicators()).toHaveLength(0);
		});

		it("clears the dragging cursor once dropped", async () => {
			mount();
			await settle();
			layOut();
			await drag(itemsIn(instanceSection())[0], 295);
			expect(document.body.classList.contains("dragging")).toBe(false);
		});
	});
});
