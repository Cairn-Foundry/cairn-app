import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CustomCommand } from "$lib/services/custom-command-service";
import type {
	ShortcutBinding,
	ShortcutDef,
	ShortcutId,
} from "$lib/types/shortcuts";
import CommandPalette from "./CommandPalette.svelte";

function command(
	id: string,
	overrides: Partial<CustomCommand> = {},
): CustomCommand {
	return {
		id,
		name: id,
		icon: "play",
		steps: ["echo hello"],
		stopOnError: true,
		cwd: "worktree" as CustomCommand["cwd"],
		pinned: false,
		autoClose: false,
		confirm: false,
		...overrides,
	};
}

function def(id: string, overrides: Partial<ShortcutDef> = {}): ShortcutDef {
	return {
		id: id as ShortcutId,
		label: id,
		description: `does ${id}`,
		group: "files",
		default: null,
		...overrides,
	};
}

const BINDING: ShortcutBinding = {
	key: "p",
	mod: true,
	shift: false,
	alt: false,
	ctrl: false,
};

function mount(props: Record<string, unknown> = {}) {
	const onClose = vi.fn();
	const onAction = vi.fn();
	const onRunCommand = vi.fn();
	const result = render(CommandPalette, {
		shortcuts: {} as Record<ShortcutId, ShortcutBinding | null>,
		shortcutDefs: [def("quickOpen"), def("saveFile")],
		customCommands: [],
		onClose,
		onAction,
		onRunCommand,
		...props,
	});
	return { ...result, onClose, onAction, onRunCommand };
}

const field = () => screen.getByRole("textbox") as HTMLInputElement;
const items = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".cp-item"));
const labels = () =>
	items().map((i) => i.querySelector(".cp-item-label")?.textContent);
const selected = () =>
	document.querySelector(".cp-item-selected")?.querySelector(".cp-item-label")
		?.textContent;
const empty = () => document.querySelector(".cp-empty")?.textContent;

describe("CommandPalette", () => {
	describe("what it lists", () => {
		it("lists the project commands before the shortcut actions", () => {
			mount({ customCommands: [command("deploy")] });
			expect(labels()).toEqual(["deploy", "quickOpen", "saveFile"]);
		});

		it("leaves out the shortcuts kept out of the palette", () => {
			mount({
				shortcutDefs: [def("shown"), def("secret", { hidden: true })],
			});
			expect(labels()).toEqual(["shown"]);
		});

		it("selects the first entry to begin with", () => {
			mount({ customCommands: [command("deploy")] });
			expect(selected()).toBe("deploy");
		});

		it("takes the cursor so the user can type straight away", () => {
			mount();
			expect(document.activeElement).toBe(field());
		});

		it("names itself for a screen reader", () => {
			mount();
			expect(
				screen.getByRole("dialog").getAttribute("aria-label"),
			).toBeTruthy();
		});

		it("shows the steps of a command as its description", () => {
			mount({
				customCommands: [
					command("build", { steps: ["npm ci", "npm run build"] }),
				],
			});
			expect(items()[0].querySelector(".cp-item-desc")?.textContent).toBe(
				"npm ci && npm run build",
			);
		});

		it("shows the keys bound to a shortcut, and nothing for an unbound one", () => {
			mount({
				shortcutDefs: [def("bound"), def("unbound")],
				shortcuts: { bound: BINDING, unbound: null },
			});
			expect(items()[0].querySelectorAll(".cp-kbd").length).toBeGreaterThan(0);
			expect(items()[1].querySelectorAll(".cp-kbd")).toHaveLength(0);
		});
	});

	describe("filtering", () => {
		it("keeps the entries matching the label", async () => {
			mount({ customCommands: [command("deploy"), command("build")] });
			await userEvent.type(field(), "depl");
			expect(labels()).toEqual(["deploy"]);
		});

		it("matches on the description too", async () => {
			mount({ shortcutDefs: [def("alpha"), def("beta")] });
			await userEvent.type(field(), "does beta");
			expect(labels()).toEqual(["beta"]);
		});

		it("ignores case", async () => {
			mount({ customCommands: [command("Deploy")] });
			await userEvent.type(field(), "DEPLOY");
			expect(labels()).toEqual(["Deploy"]);
		});

		/** Terms are matched independently, so word order does not matter. */
		it("matches the words in any order", async () => {
			mount({
				customCommands: [command("build the project")],
				shortcutDefs: [],
			});
			await userEvent.type(field(), "project build");
			expect(labels()).toEqual(["build the project"]);
		});

		it("says so when nothing matches, quoting what was typed", async () => {
			mount();
			await userEvent.type(field(), "zzz");
			expect(items()).toHaveLength(0);
			expect(empty()).toContain("zzz");
		});

		/** Filtering moves the list under the cursor, so the choice goes back to the top. */
		it("goes back to the first entry when the query changes", async () => {
			mount({ shortcutDefs: [def("alpha"), def("beta"), def("gamma")] });
			await userEvent.keyboard("{ArrowDown}{ArrowDown}");
			expect(selected()).toBe("gamma");
			await userEvent.type(field(), "a");
			expect(selected()).toBe("alpha");
		});

		it("lists everything again once the query is cleared", async () => {
			mount({ shortcutDefs: [def("alpha"), def("beta")] });
			await userEvent.type(field(), "alph");
			expect(labels()).toHaveLength(1);
			await userEvent.clear(field());
			expect(labels()).toHaveLength(2);
		});
	});

	describe("choosing with the keyboard", () => {
		it("walks down the list", async () => {
			mount({ shortcutDefs: [def("alpha"), def("beta")] });
			await userEvent.keyboard("{ArrowDown}");
			expect(selected()).toBe("beta");
		});

		it("walks back up", async () => {
			mount({ shortcutDefs: [def("alpha"), def("beta")] });
			await userEvent.keyboard("{ArrowDown}{ArrowUp}");
			expect(selected()).toBe("alpha");
		});

		/**
		 * The list stops at its ends rather than wrapping around. Three entries,
		 * not two: with two, a wrap would cycle back onto the same entry and the
		 * test would pass against the behaviour it means to rule out.
		 */
		it("stops at the last entry", async () => {
			mount({ shortcutDefs: [def("alpha"), def("beta"), def("gamma")] });
			await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}");
			expect(selected()).toBe("gamma");
		});

		/** One press, not three: three would cycle back onto alpha if it wrapped. */
		it("stops at the first entry", async () => {
			mount({ shortcutDefs: [def("alpha"), def("beta"), def("gamma")] });
			await userEvent.keyboard("{ArrowUp}");
			expect(selected()).toBe("alpha");
		});

		it("survives the arrows with nothing to walk", async () => {
			const { onAction, onRunCommand } = mount({ shortcutDefs: [] });
			await userEvent.keyboard("{ArrowDown}{Enter}");
			expect(onAction).not.toHaveBeenCalled();
			expect(onRunCommand).not.toHaveBeenCalled();
		});
	});

	describe("running the chosen entry", () => {
		/** The two kinds share one list but not one destination. */
		it("sends a shortcut to the action runner", async () => {
			const { onAction, onRunCommand } = mount({
				shortcutDefs: [def("saveFile")],
			});
			await userEvent.keyboard("{Enter}");
			expect(onAction).toHaveBeenCalledWith("saveFile");
			expect(onRunCommand).not.toHaveBeenCalled();
		});

		it("sends a custom command to the command runner", async () => {
			const deploy = command("deploy");
			const { onAction, onRunCommand } = mount({
				customCommands: [deploy],
				shortcutDefs: [],
			});
			await userEvent.keyboard("{Enter}");
			expect(onRunCommand).toHaveBeenCalledWith(deploy);
			expect(onAction).not.toHaveBeenCalled();
		});

		it("runs the entry the arrows landed on, not the first", async () => {
			const { onAction } = mount({
				shortcutDefs: [def("alpha"), def("beta")],
			});
			await userEvent.keyboard("{ArrowDown}{Enter}");
			expect(onAction).toHaveBeenCalledWith("beta");
		});

		it("runs the entry that was clicked", async () => {
			const { onAction } = mount({
				shortcutDefs: [def("alpha"), def("beta")],
			});
			await userEvent.click(items()[1]);
			expect(onAction).toHaveBeenCalledWith("beta");
		});

		it("follows the pointer moving over an entry", async () => {
			mount({ shortcutDefs: [def("alpha"), def("beta")] });
			await userEvent.hover(items()[1]);
			expect(selected()).toBe("beta");
		});

		it("runs what a filtered list left, not what was there before", async () => {
			const { onAction } = mount({
				shortcutDefs: [def("alpha"), def("beta")],
			});
			await userEvent.type(field(), "beta{Enter}");
			expect(onAction).toHaveBeenCalledWith("beta");
		});
	});

	describe("closing", () => {
		it("closes on Escape", async () => {
			const { onClose } = mount();
			await userEvent.keyboard("{Escape}");
			expect(onClose).toHaveBeenCalled();
		});

		/** Escape must reach it even once the focus has left the field. */
		it("closes on Escape from anywhere on the page", async () => {
			const { onClose } = mount();
			field().blur();
			document.body.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			);
			expect(onClose).toHaveBeenCalled();
		});

		it("stops listening for Escape once it is gone", async () => {
			const { onClose, unmount } = mount();
			unmount();
			document.body.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			);
			expect(onClose).not.toHaveBeenCalled();
		});

		it("closes on a click outside the panel", async () => {
			const { onClose } = mount();
			const backdrop = document.querySelector(".cp-backdrop") as HTMLElement;
			await userEvent.click(backdrop);
			expect(onClose).toHaveBeenCalled();
		});

		it("stays open on a click inside the panel", async () => {
			const { onClose } = mount();
			await userEvent.click(screen.getByRole("dialog"));
			expect(onClose).not.toHaveBeenCalled();
		});

		it("does not close merely because an entry was run", async () => {
			const { onClose } = mount({ shortcutDefs: [def("alpha")] });
			await userEvent.keyboard("{Enter}");
			expect(onClose).not.toHaveBeenCalled();
		});
	});
});
