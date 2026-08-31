// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomCommand } from "$lib/services/custom-command-service";

const commandRuns = writable<Record<string, unknown>>({});
const requestCommandLaunch = vi.fn();
const stopCommand = vi.fn();
vi.mock("$lib/stores/command-run", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	commandRuns: { subscribe: commandRuns.subscribe },
	requestCommandLaunch: (...a: unknown[]) => requestCommandLaunch(...a),
	stopCommand: (...a: unknown[]) => stopCommand(...a),
}));

const toggleCommandPinned = vi.fn();
const reorderCommand = vi.fn();
const moveCommandToScope = vi.fn();
vi.mock("$lib/stores/custom-command", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	toggleCommandPinned: (...a: unknown[]) => toggleCommandPinned(...a),
	reorderCommand: (...a: unknown[]) => reorderCommand(...a),
	moveCommandToScope: (...a: unknown[]) => moveCommandToScope(...a),
}));

const activeInstanceStore = writable<unknown>(null);
vi.mock("$lib/stores/instance", () => ({
	activeInstance: { subscribe: activeInstanceStore.subscribe },
}));

const setActiveTerminal = vi.fn();
vi.mock("$lib/stores/terminal", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	setActiveTerminal: (...a: unknown[]) => setActiveTerminal(...a),
}));

const showTool = vi.fn();
vi.mock("$lib/stores/ui", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	showTool: (...a: unknown[]) => showTool(...a),
}));

const { projects, activeProjectId } = await import("$lib/stores/project");
const { globalCommands, projectCommands } = await import(
	"$lib/stores/custom-command"
);
const { project, instance } = await import("./fixtures");
const { default: PinnedCommandsSidebar } = await import(
	"$lib/components/commands/PinnedCommandsSidebar.svelte"
);

function command(
	id: string,
	overrides: Partial<CustomCommand> = {},
): CustomCommand {
	return {
		id,
		name: id,
		icon: "play",
		steps: ["echo hi"],
		stopOnError: true,
		cwd: "worktree",
		pinned: true,
		autoClose: false,
		confirm: false,
		...overrides,
	} as CustomCommand;
}

function mount(props: Record<string, unknown> = {}) {
	render(PinnedCommandsSidebar, {
		globalPinned: [],
		projectPinned: [],
		position: "right",
		...props,
	});
}

const items = () =>
	Array.from(document.querySelectorAll<HTMLButtonElement>(".pinned-item"));
const itemFor = (name: string) =>
	items().find(
		(i) => i.getAttribute("aria-label") === name,
	) as HTMLButtonElement;
const sidebar = () => document.querySelector(".pinned-sidebar");
const divider = () => document.querySelector(".divider");
const runningDots = () => document.querySelectorAll(".running-dot");
const tooltip = () => document.querySelector(".pinned-tooltip");
const contextMenu = () => document.querySelector(".ctx-menu");
const menuItems = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".ctx-item"));
const menuItemNamed = (pattern: RegExp) =>
	menuItems().find((b) => pattern.test((b.textContent ?? "").trim()));

/** A run of the given command, on the active project and instance. */
function runOf(commandId: string) {
	return {
		[`k:${commandId}`]: {
			commandId,
			projectId: "p1",
			instanceId: "i1",
			terminalId: "t1",
		},
	};
}

beforeEach(() => {
	requestCommandLaunch.mockReset().mockResolvedValue(undefined);
	stopCommand.mockReset().mockResolvedValue(undefined);
	toggleCommandPinned.mockReset();
	reorderCommand.mockReset();
	moveCommandToScope.mockReset();
	setActiveTerminal.mockReset();
	showTool.mockReset();
	commandRuns.set({});
	projects.set([project("p1")]);
	activeProjectId.set("p1");
	activeInstanceStore.set(instance("i1", "p1"));
});

describe("PinnedCommandsSidebar", () => {
	describe("what it shows", () => {
		/** Nothing pinned means no sidebar at all, not an empty strip. */
		it("shows nothing when no command is pinned", () => {
			mount();
			expect(sidebar()).toBeNull();
		});

		it("shows the pinned commands of both scopes", () => {
			mount({
				globalPinned: [command("g1")],
				projectPinned: [command("p1cmd")],
			});
			expect(items()).toHaveLength(2);
		});

		/** The two scopes are separated, but only when both have something. */
		it("separates the two scopes when both have commands", () => {
			mount({
				globalPinned: [command("g1")],
				projectPinned: [command("p1cmd")],
			});
			expect(divider()).not.toBeNull();
		});

		it("shows no separator with only one scope", () => {
			mount({ globalPinned: [command("g1")] });
			expect(divider()).toBeNull();
		});

		it("names each command for a screen reader", () => {
			mount({ globalPinned: [command("deploy")] });
			expect(items()[0].getAttribute("aria-label")).toBe("deploy");
		});

		it("carries the colour a command was given", () => {
			mount({ globalPinned: [command("g1", { color: "#123456" })] });
			expect(
				(items()[0].querySelector(".icon") as HTMLElement).style.color,
			).toBe("rgb(18, 52, 86)");
		});

		/** A command cannot run without an instance to run it in. */
		it("refuses every command with no instance open", () => {
			activeInstanceStore.set(null);
			mount({ globalPinned: [command("g1")] });
			expect(items()[0].disabled).toBe(true);
		});

		it("allows them once an instance is open", () => {
			mount({ globalPinned: [command("g1")] });
			expect(items()[0].disabled).toBe(false);
		});
	});

	describe("running commands", () => {
		it("launches a command that is not running", async () => {
			mount({ globalPinned: [command("deploy")] });
			await userEvent.click(itemFor("deploy"));
			expect(requestCommandLaunch).toHaveBeenCalled();
			expect(requestCommandLaunch.mock.calls[0][0].id).toBe("deploy");
		});

		/**
		 * A command already running is revealed rather than started again: the
		 * click takes you to its terminal.
		 */
		it("reveals the terminal of a command already running", async () => {
			commandRuns.set(runOf("deploy"));
			mount({ globalPinned: [command("deploy")] });
			await userEvent.click(itemFor("deploy"));
			expect(setActiveTerminal).toHaveBeenCalledWith("p1", "i1", "t1");
			expect(showTool).toHaveBeenCalledWith("terminal");
			expect(requestCommandLaunch).not.toHaveBeenCalled();
		});

		it("marks a command that is running", () => {
			commandRuns.set(runOf("deploy"));
			mount({
				globalPinned: [command("deploy"), command("other")],
			});
			expect(runningDots()).toHaveLength(1);
			expect(itemFor("deploy").classList.contains("running")).toBe(true);
			expect(itemFor("other").classList.contains("running")).toBe(false);
		});

		/** A run belonging to another instance is not this instance's run. */
		it("ignores a run from another instance", async () => {
			commandRuns.set({
				"k:deploy": {
					commandId: "deploy",
					projectId: "p1",
					instanceId: "other",
					terminalId: "t9",
				},
			});
			mount({ globalPinned: [command("deploy")] });
			expect(runningDots()).toHaveLength(0);
			await userEvent.click(itemFor("deploy"));
			expect(requestCommandLaunch).toHaveBeenCalled();
		});

		it("ignores a run from another project", () => {
			commandRuns.set({
				"k:deploy": {
					commandId: "deploy",
					projectId: "other",
					instanceId: "i1",
					terminalId: "t9",
				},
			});
			mount({ globalPinned: [command("deploy")] });
			expect(runningDots()).toHaveLength(0);
		});
	});

	describe("the tooltip", () => {
		it("names the command the pointer is over", async () => {
			mount({ globalPinned: [command("deploy")] });
			await userEvent.hover(itemFor("deploy"));
			expect(tooltip()?.textContent).toBe("deploy");
		});

		it("goes away when the pointer leaves", async () => {
			mount({ globalPinned: [command("deploy")] });
			await userEvent.hover(itemFor("deploy"));
			await userEvent.unhover(itemFor("deploy"));
			expect(tooltip()).toBeNull();
		});

		/** The tooltip follows the side the sidebar is on. */
		it("sits on the side the sidebar is on", async () => {
			mount({ globalPinned: [command("deploy")], position: "left" });
			await userEvent.hover(itemFor("deploy"));
			expect(tooltip()?.classList.contains("pinned-tooltip-left")).toBe(true);
		});
	});

	describe("the context menu", () => {
		it("opens on a right click", async () => {
			mount({ globalPinned: [command("deploy")] });
			itemFor("deploy").dispatchEvent(
				new MouseEvent("contextmenu", { bubbles: true }),
			);
			await tick();
			expect(contextMenu()).not.toBeNull();
		});

		it("unpins the command it was opened on", async () => {
			mount({ globalPinned: [command("deploy")] });
			itemFor("deploy").dispatchEvent(
				new MouseEvent("contextmenu", { bubbles: true }),
			);
			await tick();
			const unpin = menuItemNamed(/unpin|détacher/i) as HTMLElement;
			expect(unpin).toBeTruthy();
			await userEvent.click(unpin);
			expect(toggleCommandPinned).toHaveBeenCalledWith(
				"global",
				"p1",
				"deploy",
			);
		});

		/** Only a running command can be stopped. */
		it("offers to stop a command that is running", async () => {
			commandRuns.set(runOf("deploy"));
			mount({ globalPinned: [command("deploy")] });
			itemFor("deploy").dispatchEvent(
				new MouseEvent("contextmenu", { bubbles: true }),
			);
			await tick();
			const stop = menuItemNamed(/stop|arrêter/i);
			expect(stop).toBeTruthy();
			await userEvent.click(stop as HTMLElement);
			expect(stopCommand).toHaveBeenCalled();
		});

		it("offers no stop for a command that is not running", async () => {
			mount({ globalPinned: [command("deploy")] });
			itemFor("deploy").dispatchEvent(
				new MouseEvent("contextmenu", { bubbles: true }),
			);
			await tick();
			expect(menuItems().length).toBeGreaterThan(0);
			expect(menuItemNamed(/stop|arrêter/i)).toBeUndefined();
		});

		/**
		 * The tooltip steps aside while the menu is open.
		 *
		 * Note: `openContextMenu` already calls `hideTooltip`, so the `!ctxMenu`
		 * guard on the tooltip is belt and braces - removing it changes nothing
		 * this suite can observe.
		 */
		it("hides the tooltip while the menu is open", async () => {
			mount({ globalPinned: [command("deploy")] });
			await userEvent.hover(itemFor("deploy"));
			expect(tooltip()).not.toBeNull();
			itemFor("deploy").dispatchEvent(
				new MouseEvent("contextmenu", { bubbles: true }),
			);
			await tick();
			expect(tooltip()).toBeNull();
		});
	});

	describe("drag to reorder", () => {
		/** Drags an item onto another, past the 6px threshold. */
		async function drag(from: HTMLButtonElement, to: HTMLButtonElement) {
			to.getBoundingClientRect = () => ({ top: 100, height: 20 }) as DOMRect;
			from.dispatchEvent(
				new PointerEvent("pointerdown", {
					bubbles: true,
					clientX: 0,
					clientY: 0,
				}),
			);
			from.dispatchEvent(
				new PointerEvent("pointermove", {
					bubbles: true,
					clientX: 0,
					clientY: 40,
				}),
			);
			from.dispatchEvent(
				new PointerEvent("pointermove", {
					bubbles: true,
					clientX: 0,
					clientY: 101,
				}),
			);
			from.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
			await tick();
		}

		/**
		 * The rail shows pinned commands only, while the store reorders the whole
		 * scope list: the index handed over has to be the one in that full list,
		 * not the one on screen.
		 */
		it("maps a rail index onto the full scope list", async () => {
			globalCommands.set([
				command("hidden", { pinned: false }),
				command("build"),
				command("deploy"),
			]);
			mount({ globalPinned: [command("build"), command("deploy")] });
			await drag(itemFor("deploy"), itemFor("build"));
			expect(reorderCommand).toHaveBeenCalledWith("global", "p1", 2, 1);
		});

		it("moves a command across the scope divider", async () => {
			globalCommands.set([command("build")]);
			projectCommands.set({ p1: [command("test")] });
			mount({
				globalPinned: [command("build")],
				projectPinned: [command("test")],
			});
			await drag(itemFor("build"), itemFor("test"));
			expect(moveCommandToScope).toHaveBeenCalledWith(
				"global",
				"project",
				"p1",
				"build",
				0,
			);
			expect(reorderCommand).not.toHaveBeenCalled();
		});

		it("leaves a click alone when the pointer never travelled", async () => {
			globalCommands.set([command("build")]);
			mount({ globalPinned: [command("build")] });
			await userEvent.click(itemFor("build"));
			expect(reorderCommand).not.toHaveBeenCalled();
			expect(requestCommandLaunch).toHaveBeenCalled();
		});
	});
});
