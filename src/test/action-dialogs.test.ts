// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { describe, expect, it, vi } from "vitest";
import BranchInUseModal from "$lib/components/git/BranchInUseModal.svelte";
import DirtyWorktreeModal from "$lib/components/git/DirtyWorktreeModal.svelte";
import CreateFolderModal from "$lib/components/home/CreateFolderModal.svelte";
import DuplicateInstanceModal from "$lib/components/home/DuplicateInstanceModal.svelte";
import KillProcessModal from "$lib/components/home/KillProcessModal.svelte";
import type { ListeningPort } from "$lib/services/ports-service";
import { instance } from "./fixtures";

/**
 * The dialogs that ask for more than a yes or no: a name, a choice between two
 * ways out, or a variant of the same action. Their shared dismissal contract is
 * covered by `confirm-modals.test.ts`; what is here is what makes each of them
 * different from a plain confirmation.
 */

const dialog = () => screen.getByRole("dialog");
const body = () => document.querySelector(".modal") as HTMLElement;
const buttons = () =>
	Array.from(document.querySelectorAll<HTMLButtonElement>(".modal-foot .btn"));
const field = () => document.querySelector(".modal input") as HTMLInputElement;

describe("CreateFolderModal", () => {
	function mount() {
		const onConfirm = vi.fn();
		const onClose = vi.fn();
		render(CreateFolderModal, {
			props: {},
			events: {
				confirm: (e: CustomEvent) => onConfirm(e.detail),
				close: () => onClose(),
			},
		});
		return { onConfirm, onClose };
	}

	const submitButton = () => buttons()[buttons().length - 1];

	it("refuses to create a folder with no name", async () => {
		const { onConfirm } = mount();
		expect(submitButton().disabled).toBe(true);
		await userEvent.type(field(), "   ");
		expect(submitButton().disabled).toBe(true);
		expect(onConfirm).not.toHaveBeenCalled();
	});

	it("creates the folder once a name is typed", async () => {
		const { onConfirm } = mount();
		await userEvent.type(field(), "My folder");
		await userEvent.click(submitButton());
		expect(onConfirm).toHaveBeenCalledWith("My folder");
	});

	it("trims the name it creates", async () => {
		const { onConfirm } = mount();
		await userEvent.type(field(), "  spaced  ");
		await userEvent.click(submitButton());
		expect(onConfirm).toHaveBeenCalledWith("spaced");
	});

	it("creates it on Enter without reaching for the button", async () => {
		const { onConfirm } = mount();
		await userEvent.type(field(), "My folder{Enter}");
		expect(onConfirm).toHaveBeenCalledWith("My folder");
	});

	/** The disabled button and the guard in the handler are two defences. */
	it("still refuses a blank name on Enter", async () => {
		const { onConfirm } = mount();
		await userEvent.type(field(), "   {Enter}");
		expect(onConfirm).not.toHaveBeenCalled();
	});

	it("closes on Escape without creating anything", async () => {
		const { onConfirm, onClose } = mount();
		await userEvent.type(field(), "name{Escape}");
		expect(onClose).toHaveBeenCalled();
		expect(onConfirm).not.toHaveBeenCalled();
	});
});

describe("DuplicateInstanceModal", () => {
	function mount(props: Record<string, unknown> = {}) {
		const onConfirm = vi.fn();
		const onClose = vi.fn();
		render(DuplicateInstanceModal, {
			props: {
				instance: instance("i1", "p1"),
				defaultTitle: "i1 (copy)",
				...props,
			},
			events: {
				confirm: (e: CustomEvent) => onConfirm(e.detail),
				close: () => onClose(),
			},
		});
		return { onConfirm, onClose };
	}

	const submitButton = () => buttons()[buttons().length - 1];
	const copyChanges = () =>
		document.querySelector("[aria-pressed]") as HTMLElement;

	/** The suggested title is offered ready to be replaced by typing. */
	it("starts from the suggested title", () => {
		mount({ defaultTitle: "i1 (copy)" });
		expect(field().value).toBe("i1 (copy)");
	});

	it("duplicates under the title that was typed", async () => {
		const { onConfirm } = mount();
		await userEvent.clear(field());
		await userEvent.type(field(), "my copy");
		await userEvent.click(submitButton());
		expect(onConfirm).toHaveBeenCalledWith({
			title: "my copy",
			copyWorkingChanges: true,
		});
	});

	it("refuses a blank title", async () => {
		const { onConfirm } = mount();
		await userEvent.clear(field());
		expect(submitButton().disabled).toBe(true);
		await userEvent.type(field(), "{Enter}");
		expect(onConfirm).not.toHaveBeenCalled();
	});

	it("trims the title it submits", async () => {
		const { onConfirm } = mount();
		await userEvent.clear(field());
		await userEvent.type(field(), "  spaced  ");
		await userEvent.click(submitButton());
		expect(onConfirm.mock.calls[0][0].title).toBe("spaced");
	});

	/** Carrying the uncommitted work over is on by default, and can be refused. */
	it("carries the working changes over unless told not to", async () => {
		const { onConfirm } = mount();
		expect(copyChanges().getAttribute("aria-pressed")).toBe("true");
		await userEvent.click(copyChanges());
		await userEvent.click(submitButton());
		expect(onConfirm.mock.calls[0][0].copyWorkingChanges).toBe(false);
	});

	it("duplicates on Enter", async () => {
		const { onConfirm } = mount();
		await userEvent.type(field(), "{Enter}");
		expect(onConfirm).toHaveBeenCalled();
	});
});

describe("KillProcessModal", () => {
	function port(overrides: Partial<ListeningPort> = {}): ListeningPort {
		return {
			id: "p1",
			pid: 4242,
			port: 3000,
			address: "127.0.0.1",
			family: "IPv4",
			process: "node",
			command: "node server.js",
			user: "benjamin",
			...overrides,
		} as ListeningPort;
	}

	function mount(overrides: Partial<ListeningPort> = {}) {
		const onConfirm = vi.fn();
		const onClose = vi.fn();
		render(KillProcessModal, {
			props: { port: port(overrides) },
			events: {
				confirm: (e: CustomEvent) => onConfirm(e.detail),
				close: () => onClose(),
			},
		});
		return { onConfirm, onClose };
	}

	it("names the process and the port it holds", () => {
		mount();
		expect(body().textContent).toContain("node");
		expect(body().textContent).toMatch(/3000/);
		expect(body().textContent).toMatch(/4242/);
	});

	/**
	 * Two ways out, and they are not the same: the ordinary stop asks the
	 * process to quit, the forced one does not. The dialog must not confuse them.
	 */
	it("stops the process gently by default", async () => {
		const { onConfirm } = mount();
		await userEvent.click(buttons()[buttons().length - 1]);
		expect(onConfirm).toHaveBeenCalledWith({ force: false });
	});

	it("forces the stop on the other button", async () => {
		const { onConfirm } = mount();
		await userEvent.click(buttons()[0]);
		expect(onConfirm).toHaveBeenCalledWith({ force: true });
	});

	it("does nothing until one of them is chosen", () => {
		const { onConfirm, onClose } = mount();
		expect(onConfirm).not.toHaveBeenCalled();
		expect(onClose).not.toHaveBeenCalled();
	});

	it("cancels without stopping anything", async () => {
		const { onConfirm, onClose } = mount();
		const cancel = buttons().find(
			(b) => b.classList.contains("ghost") && b !== buttons()[0],
		);
		await userEvent.click(cancel as HTMLElement);
		expect(onClose).toHaveBeenCalled();
		expect(onConfirm).not.toHaveBeenCalled();
	});
});

describe("DirtyWorktreeModal", () => {
	function mount(props: Record<string, unknown> = {}) {
		const onStash = vi.fn();
		const onClose = vi.fn();
		render(DirtyWorktreeModal, {
			props: { branch: "feature/login", ...props },
			events: { stash: () => onStash(), close: () => onClose() },
		});
		return { onStash, onClose };
	}

	it("names the branch that cannot be checked out", () => {
		mount({ branch: "feature/login" });
		expect(body().textContent).toContain("feature/login");
	});

	/** Stashing is the one-click way out; committing is left to the git view. */
	it("offers to stash the changes", async () => {
		const { onStash } = mount();
		await userEvent.click(buttons()[buttons().length - 1]);
		expect(onStash).toHaveBeenCalled();
	});

	it("refuses a second stash while one is running", () => {
		mount({ isStashing: true });
		expect(buttons()[buttons().length - 1].disabled).toBe(true);
	});

	it("shows an animation rather than a word while stashing", () => {
		mount({ isStashing: true });
		expect(document.querySelector(".spinner")).not.toBeNull();
		expect(body().textContent?.toLowerCase()).not.toContain("loading");
	});

	it("gives up without stashing", async () => {
		const { onStash, onClose } = mount();
		await userEvent.click(buttons()[0]);
		expect(onClose).toHaveBeenCalled();
		expect(onStash).not.toHaveBeenCalled();
	});
});

describe("BranchInUseModal", () => {
	function mount(props: Record<string, unknown> = {}) {
		const onOpen = vi.fn();
		const onClose = vi.fn();
		render(BranchInUseModal, {
			props: {
				branch: "feature/login",
				worktreePath: "/worktrees/p1/other",
				instance: null,
				...props,
			},
			events: {
				open: (e: CustomEvent) => onOpen(e.detail),
				close: () => onClose(),
			},
		});
		return { onOpen, onClose };
	}

	it("names the branch and the worktree already holding it", () => {
		mount();
		expect(body().textContent).toContain("feature/login");
		expect(body().textContent).toContain("/worktrees/p1/other");
	});

	/**
	 * When the worktree belongs to a known instance, the way out is to open it
	 * rather than to free the branch - so that is what is offered.
	 */
	it("offers to open the instance holding the branch", async () => {
		const holder = instance("other", "p1");
		const { onOpen } = mount({ instance: holder });
		await userEvent.click(buttons()[buttons().length - 1]);
		expect(onOpen).toHaveBeenCalledWith(holder);
	});

	/** An unknown worktree has no instance to open, so nothing is offered. */
	it("offers no way out when no instance holds it", () => {
		mount({ instance: null });
		expect(buttons()).toHaveLength(1);
	});

	it("gives up without opening anything", async () => {
		const { onOpen, onClose } = mount({ instance: instance("other", "p1") });
		await userEvent.click(buttons()[0]);
		expect(onClose).toHaveBeenCalled();
		expect(onOpen).not.toHaveBeenCalled();
	});

	it("announces itself as a dialog", () => {
		mount();
		expect(dialog().getAttribute("aria-modal")).toBe("true");
		void tick;
	});
});
