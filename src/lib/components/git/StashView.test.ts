// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GitStash } from "$lib/services/git-service";

const gitState = writable<{ stashes: GitStash[] }>({ stashes: [] });
const pushStash = vi.fn();
const popStash = vi.fn();
const applyStash = vi.fn();
const dropStash = vi.fn();
const clearStashes = vi.fn();
const renameStash = vi.fn();

vi.mock("$lib/stores/git", () => ({
	git: { subscribe: gitState.subscribe },
	pushStash: (...a: unknown[]) => pushStash(...a),
	popStash: (...a: unknown[]) => popStash(...a),
	applyStash: (...a: unknown[]) => applyStash(...a),
	dropStash: (...a: unknown[]) => dropStash(...a),
	clearStashes: (...a: unknown[]) => clearStashes(...a),
	renameStash: (...a: unknown[]) => renameStash(...a),
}));

const { default: StashView } = await import("./StashView.svelte");

function stash(index: number, overrides: Partial<GitStash> = {}): GitStash {
	return {
		index,
		name: `stash@{${index}}`,
		message: `work ${index}`,
		branch: "main",
		date: "",
		fileCount: 2,
		...overrides,
	};
}

function mount(props: Record<string, unknown> = {}) {
	const onSelect = vi.fn();
	const result = render(StashView, {
		props: { selectedStashIndex: null, ...props },
		events: { selectStash: (e: CustomEvent) => onSelect(e.detail) },
	});
	return { ...result, onSelect };
}

const items = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".stash-item"));
const messages = () =>
	items().map((i) => i.querySelector(".stash-message")?.textContent);
const itemFor = (message: string) =>
	items().find(
		(i) => i.querySelector(".stash-message")?.textContent === message,
	) as HTMLElement;
const search = () =>
	document.querySelector(".stash-search-input") as HTMLInputElement;
const modal = () => document.querySelector(".modal") as HTMLElement | null;
/** The open modal's single text field. */
const modalInput = () =>
	(modal() as HTMLElement).querySelector("input") as HTMLInputElement;
/** The confirming button of the open modal, always its last one. */
const confirmButton = () => {
	const buttons = Array.from(
		(modal() as HTMLElement).querySelectorAll<HTMLButtonElement>(
			".modal-foot .btn",
		),
	);
	return buttons[buttons.length - 1];
};

beforeEach(() => {
	for (const fn of [
		pushStash,
		popStash,
		applyStash,
		dropStash,
		clearStashes,
		renameStash,
	]) {
		fn.mockReset();
		fn.mockResolvedValue(undefined);
	}
	gitState.set({ stashes: [] });
});

describe("StashView", () => {
	describe("the list", () => {
		it("says so when there is no stash", () => {
			mount();
			expect(document.querySelector(".stash-empty")).not.toBeNull();
			expect(items()).toHaveLength(0);
		});

		it("lists the stashes it was given", () => {
			gitState.set({ stashes: [stash(0), stash(1)] });
			mount();
			expect(messages()).toEqual(["work 0", "work 1"]);
		});

		it("falls back to the stash name when it carries no message", () => {
			gitState.set({ stashes: [stash(0, { message: "" })] });
			mount();
			expect(messages()).toEqual(["stash@{0}"]);
		});

		it("marks the selected stash", () => {
			gitState.set({ stashes: [stash(0), stash(1)] });
			mount({ selectedStashIndex: 1 });
			expect(itemFor("work 0").classList.contains("is-selected")).toBe(false);
			expect(itemFor("work 1").classList.contains("is-selected")).toBe(true);
		});

		it("reports the stash that was clicked", async () => {
			gitState.set({ stashes: [stash(0), stash(1)] });
			const { onSelect } = mount();
			await userEvent.click(itemFor("work 1"));
			expect(onSelect).toHaveBeenCalledWith(stash(1));
		});

		/** Clearing everything is only offered when there is something to clear. */
		it("offers to clear them all only when some exist", async () => {
			mount();
			expect(document.querySelector(".stash-clear-btn")).toBeNull();
			gitState.set({ stashes: [stash(0)] });
			await tick();
			expect(document.querySelector(".stash-clear-btn")).not.toBeNull();
		});
	});

	describe("searching", () => {
		beforeEach(() => {
			gitState.set({
				stashes: [
					stash(0, { message: "fix the parser", branch: "main" }),
					stash(1, { message: "wip", branch: "feature/login" }),
				],
			});
		});

		it("matches on the message", async () => {
			mount();
			await userEvent.type(search(), "parser");
			expect(messages()).toEqual(["fix the parser"]);
		});

		it("matches on the branch the stash came from", async () => {
			mount();
			await userEvent.type(search(), "login");
			expect(messages()).toEqual(["wip"]);
		});

		/** Pasted, not typed: userEvent.type reads "{" as a key descriptor. */
		it("matches on the stash name", async () => {
			mount();
			search().focus();
			await userEvent.paste("stash@{1}");
			expect(messages()).toEqual(["wip"]);
		});

		it("ignores case", async () => {
			mount();
			await userEvent.type(search(), "PARSER");
			expect(messages()).toEqual(["fix the parser"]);
		});

		/** An empty result is not an empty stash list, and says so differently. */
		it("distinguishes no match from no stash at all", async () => {
			mount();
			await userEvent.type(search(), "zzz");
			expect(items()).toHaveLength(0);
			expect(document.querySelectorAll(".stash-empty")).toHaveLength(1);
		});

		it("lists everything again once the search is cleared", async () => {
			mount();
			await userEvent.type(search(), "parser");
			await userEvent.click(
				document.querySelector(".stash-search-clear") as HTMLElement,
			);
			expect(messages()).toHaveLength(2);
		});
	});

	describe("applying and popping", () => {
		beforeEach(() => {
			gitState.set({ stashes: [stash(0), stash(1)] });
		});

		/** The row's four actions, in the order the component lays them out. */
		const actionOn = (message: string, which: "apply" | "pop") => {
			const buttons = Array.from(
				itemFor(message).querySelectorAll<HTMLElement>(".stash-action-btn"),
			);
			return buttons[which === "apply" ? 0 : 1];
		};

		it("applies the stash it was asked to, keeping it in the list", async () => {
			const { onSelect } = mount({ selectedStashIndex: 1 });
			await userEvent.click(actionOn("work 1", "apply"));
			expect(applyStash).toHaveBeenCalledWith(1);
			expect(onSelect).not.toHaveBeenCalled();
		});

		/** Popping removes the entry, so a selection pointing at it must go. */
		it("clears the selection when the popped stash was the selected one", async () => {
			const { onSelect } = mount({ selectedStashIndex: 1 });
			await userEvent.click(actionOn("work 1", "pop"));
			expect(popStash).toHaveBeenCalledWith(1);
			expect(onSelect).toHaveBeenCalledWith(null);
		});

		it("leaves the selection alone when another stash is popped", async () => {
			const { onSelect } = mount({ selectedStashIndex: 0 });
			await userEvent.click(actionOn("work 1", "pop"));
			expect(popStash).toHaveBeenCalledWith(1);
			expect(onSelect).not.toHaveBeenCalled();
		});

		it("shows a spinner on the row it is working on, not on the others", async () => {
			let settle: () => void = () => {};
			popStash.mockReturnValue(
				new Promise<void>((resolve) => {
					settle = resolve;
				}),
			);
			mount();
			await userEvent.click(actionOn("work 1", "pop"));
			expect(itemFor("work 1").querySelector(".spinner")).not.toBeNull();
			expect(itemFor("work 0").querySelector(".spinner")).toBeNull();
			settle();
		});

		it("clicking an action does not also select the row", async () => {
			const { onSelect } = mount({ selectedStashIndex: 0 });
			await userEvent.click(actionOn("work 1", "apply"));
			expect(onSelect).not.toHaveBeenCalled();
		});
	});

	describe("creating a stash", () => {
		it("asks for the message and the options", async () => {
			mount();
			await userEvent.click(
				document.querySelector(".stash-new-btn") as HTMLElement,
			);
			expect(modal()).not.toBeNull();
			expect(pushStash).not.toHaveBeenCalled();
		});

		it("creates it with the message and the default options", async () => {
			mount();
			await userEvent.click(
				document.querySelector(".stash-new-btn") as HTMLElement,
			);
			const input = modalInput();
			await userEvent.type(input, "my work");
			await userEvent.click(confirmButton());
			expect(pushStash).toHaveBeenCalledWith("my work", true, false);
		});

		/** Creating one renumbers the stack, so whatever was selected no longer holds. */
		it("clears the selection once the stash is created", async () => {
			const { onSelect } = mount({ selectedStashIndex: 0 });
			await userEvent.click(
				document.querySelector(".stash-new-btn") as HTMLElement,
			);
			await userEvent.click(confirmButton());
			expect(onSelect).toHaveBeenCalledWith(null);
		});

		it("closes without creating anything on cancel", async () => {
			mount();
			await userEvent.click(
				document.querySelector(".stash-new-btn") as HTMLElement,
			);
			await userEvent.click(
				screen.getByRole("button", { name: /cancel|annuler/i }),
			);
			expect(modal()).toBeNull();
			expect(pushStash).not.toHaveBeenCalled();
		});

		it("closes on Escape", async () => {
			mount();
			await userEvent.click(
				document.querySelector(".stash-new-btn") as HTMLElement,
			);
			await userEvent.keyboard("{Escape}");
			await tick();
			expect(modal()).toBeNull();
		});
	});

	describe("renaming a stash", () => {
		beforeEach(() => {
			gitState.set({ stashes: [stash(0), stash(1)] });
		});

		const openRename = async (message: string) => {
			const button = Array.from(
				itemFor(message).querySelectorAll<HTMLElement>(".stash-action-btn"),
			).filter((b) => b.classList.contains("icon-only"))[0];
			await userEvent.click(button);
		};

		it("opens prefilled with the current message", async () => {
			mount();
			await openRename("work 1");
			expect(modalInput().value).toBe("work 1");
		});

		it("renames the stash it was opened on", async () => {
			mount();
			await openRename("work 1");
			const input = modalInput();
			await userEvent.clear(input);
			await userEvent.type(input, "better name");
			await userEvent.click(confirmButton());
			expect(renameStash).toHaveBeenCalledWith(1, "better name");
		});

		it("trims what it submits", async () => {
			mount();
			await openRename("work 0");
			const input = modalInput();
			await userEvent.clear(input);
			await userEvent.type(input, "  spaced  ");
			await userEvent.click(confirmButton());
			expect(renameStash).toHaveBeenCalledWith(0, "spaced");
		});

		it("refuses a blank name", async () => {
			mount();
			await openRename("work 0");
			const input = modalInput();
			await userEvent.clear(input);
			await userEvent.type(input, "   ");
			expect(confirmButton().disabled).toBe(true);
		});

		/**
		 * The disabled button and the guard inside the handler are two separate
		 * defences; forcing the click past the first one checks the second.
		 */
		it("still refuses a blank name if the button is forced", async () => {
			mount();
			await openRename("work 0");
			const input = modalInput();
			await userEvent.clear(input);
			await userEvent.type(input, "   ");
			confirmButton().disabled = false;
			await userEvent.click(confirmButton());
			expect(renameStash).not.toHaveBeenCalled();
		});

		/** Renaming recreates the stash, so the selection no longer points at it. */
		it("clears the selection once renamed", async () => {
			const { onSelect } = mount({ selectedStashIndex: 0 });
			await openRename("work 0");
			await userEvent.click(confirmButton());
			expect(onSelect).toHaveBeenCalledWith(null);
		});
	});

	describe("dropping and clearing", () => {
		beforeEach(() => {
			gitState.set({ stashes: [stash(0), stash(1)] });
		});

		const openDrop = async (message: string) => {
			const button = Array.from(
				itemFor(message).querySelectorAll<HTMLElement>(".stash-action-btn"),
			).find((b) => b.classList.contains("danger"));
			await userEvent.click(button as HTMLElement);
		};

		/** Dropping is destructive and irreversible: it always asks first. */
		it("asks before dropping one", async () => {
			mount();
			await openDrop("work 1");
			expect(modal()).not.toBeNull();
			expect(dropStash).not.toHaveBeenCalled();
		});

		it("drops the stash that was confirmed", async () => {
			mount();
			await openDrop("work 1");
			await userEvent.click(confirmButton());
			expect(dropStash).toHaveBeenCalledWith(1);
			expect(clearStashes).not.toHaveBeenCalled();
		});

		it("clears the selection only when the dropped stash was selected", async () => {
			const { onSelect, unmount } = mount({ selectedStashIndex: 1 });
			await openDrop("work 1");
			await userEvent.click(confirmButton());
			expect(onSelect).toHaveBeenCalledWith(null);
			unmount();

			const second = mount({ selectedStashIndex: 0 });
			await openDrop("work 1");
			await userEvent.click(confirmButton());
			expect(second.onSelect).not.toHaveBeenCalled();
		});

		it("asks before clearing them all", async () => {
			mount();
			await userEvent.click(
				document.querySelector(".stash-clear-btn") as HTMLElement,
			);
			expect(modal()).not.toBeNull();
			expect(clearStashes).not.toHaveBeenCalled();
		});

		/** Clearing everything removes whatever was selected, whichever it was. */
		it("clears them all and drops the selection", async () => {
			const { onSelect } = mount({ selectedStashIndex: 0 });
			await userEvent.click(
				document.querySelector(".stash-clear-btn") as HTMLElement,
			);
			await userEvent.click(confirmButton());
			expect(clearStashes).toHaveBeenCalled();
			expect(dropStash).not.toHaveBeenCalled();
			expect(onSelect).toHaveBeenCalledWith(null);
		});

		it("drops nothing on cancel", async () => {
			mount();
			await openDrop("work 1");
			await userEvent.click(
				screen.getByRole("button", { name: /cancel|annuler/i }),
			);
			expect(dropStash).not.toHaveBeenCalled();
			expect(modal()).toBeNull();
		});
	});
});
