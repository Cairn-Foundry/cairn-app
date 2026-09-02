// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const { default: SaveConflict } = await import("./SaveConflict.svelte");

function mount(
	props: Record<string, unknown> = {},
	events: Record<string, () => void> = {},
) {
	return render(SaveConflict, {
		props: { path: "src/a.ts", ...props },
		events,
	});
}

describe("SaveConflict", () => {
	it("names the file the conflict is about", () => {
		mount({ path: "src/deep/file.ts" });
		expect(screen.getByText("src/deep/file.ts")).toBeTruthy();
	});

	it("offers the three ways out, and no fourth", () => {
		const { container } = mount();
		expect(container.querySelectorAll(".choice").length).toBe(3);
	});

	/**
	 * The wording has to distinguish the two, because the consequence differs: one
	 * loses someone else's edit, the other resurrects a file that was deleted.
	 */
	it("says the file was deleted rather than changed when it is gone", () => {
		const changed = mount({ deleted: false });
		expect(screen.queryByText(/modified outside Cairn/)).toBeTruthy();
		changed.unmount();

		mount({ deleted: true });
		expect(screen.queryByText(/deleted outside Cairn/)).toBeTruthy();
	});

	it.each([
		["openDisk", 0],
		["cancel", 1],
		["overwrite", 2],
	])("dispatches %s from its own choice", async (event, index) => {
		const handler = vi.fn();
		const { container } = mount({}, { [event]: handler });

		const choices = container.querySelectorAll<HTMLElement>(".choice");
		await userEvent.click(choices[index]);
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it("cancels on Escape, so the modal never traps the user", async () => {
		const handler = vi.fn();
		const { container } = mount({}, { cancel: handler });

		const backdrop = container.querySelector<HTMLElement>(".modal-backdrop");
		if (!backdrop) throw new Error("no backdrop");
		backdrop.focus();
		await userEvent.keyboard("{Escape}");
		expect(handler).toHaveBeenCalled();
	});

	it("does not cancel when the click lands inside the dialog", async () => {
		const handler = vi.fn();
		const { container } = mount({}, { cancel: handler });

		const modal = container.querySelector<HTMLElement>(".modal");
		if (!modal) throw new Error("no modal");
		await userEvent.click(modal);
		expect(handler).not.toHaveBeenCalled();
	});
});
