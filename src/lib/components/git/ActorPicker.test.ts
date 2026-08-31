// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "$lib/types/integrations";

const searchForgeMembers = vi.fn();
vi.mock("$lib/stores/merge-request", () => ({
	searchForgeMembers: (...args: unknown[]) => searchForgeMembers(...args),
}));

const { default: ActorPicker } = await import("./ActorPicker.svelte");

const DEBOUNCE = 250;

function actor(login: string, displayName = ""): Actor {
	return { login, displayName, avatarUrl: null };
}

function mount(props: Record<string, unknown> = {}) {
	return render(ActorPicker, {
		id: "reviewers",
		label: "Reviewers",
		placeholder: "Search",
		projectId: "p1",
		selected: [],
		...props,
	});
}

const field = () => screen.getByRole("textbox") as HTMLInputElement;
const options = () => screen.queryAllByRole("option");
const chips = () =>
	Array.from(document.querySelectorAll(".chip")).map((c) =>
		c.textContent?.trim(),
	);
const spinner = () => document.querySelector(".mr-search-spinner");
const hint = () => document.querySelector(".mr-hint");

/** Types into the field, then lets the debounce and the pending search settle. */
async function search(text: string, user: ReturnType<typeof userEvent.setup>) {
	await user.type(field(), text);
	await vi.advanceTimersByTimeAsync(DEBOUNCE);
	await vi.advanceTimersByTimeAsync(0);
}

let user: ReturnType<typeof userEvent.setup>;

beforeEach(() => {
	vi.useFakeTimers();
	user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
	searchForgeMembers.mockReset();
	searchForgeMembers.mockResolvedValue([]);
});

afterEach(() => {
	vi.useRealTimers();
});

describe("ActorPicker", () => {
	describe("searching the forge", () => {
		it("waits for the typing to settle before asking the forge", async () => {
			mount();
			await user.type(field(), "ali");
			expect(searchForgeMembers).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(DEBOUNCE);
			expect(searchForgeMembers).toHaveBeenCalledTimes(1);
		});

		it("asks once for a burst of keystrokes, with the final text", async () => {
			mount();
			await search("alice", user);
			expect(searchForgeMembers).toHaveBeenCalledTimes(1);
			expect(searchForgeMembers).toHaveBeenCalledWith("p1", "alice");
		});

		it("searches the project it was given", async () => {
			mount({ projectId: "other-project" });
			await search("a", user);
			expect(searchForgeMembers).toHaveBeenCalledWith("other-project", "a");
		});

		it("lists what the forge returned", async () => {
			searchForgeMembers.mockResolvedValue([
				actor("alice", "Alice Martin"),
				actor("bob"),
			]);
			mount();
			await search("a", user);
			expect(options().map((o) => o.textContent)).toEqual([
				expect.stringContaining("Alice Martin"),
				expect.stringContaining("bob"),
			]);
		});

		it("falls back to the login when the member has no display name", async () => {
			searchForgeMembers.mockResolvedValue([actor("bob", "")]);
			mount();
			await search("b", user);
			expect(options()[0].textContent).toContain("bob");
		});

		it("does not search on whitespace alone", async () => {
			mount();
			await search("   ", user);
			expect(searchForgeMembers).not.toHaveBeenCalled();
		});

		it("clears the results when the field is emptied", async () => {
			searchForgeMembers.mockResolvedValue([actor("alice")]);
			mount();
			await search("a", user);
			expect(options()).toHaveLength(1);
			await user.clear(field());
			await vi.advanceTimersByTimeAsync(DEBOUNCE);
			expect(options()).toHaveLength(0);
			expect(hint()).toBeNull();
		});
	});

	describe("while the forge answers", () => {
		it("shows a spinner rather than a word", async () => {
			let settle: (value: Actor[]) => void = () => {};
			searchForgeMembers.mockReturnValue(
				new Promise<Actor[]>((resolve) => {
					settle = resolve;
				}),
			);
			mount();
			await search("a", user);
			expect(spinner()).not.toBeNull();
			expect(document.body.textContent).not.toMatch(/loading|chargement/i);

			settle([]);
			await vi.advanceTimersByTimeAsync(0);
			expect(spinner()).toBeNull();
		});

		it("says nothing about an empty result until the search has run", async () => {
			mount();
			expect(hint()).toBeNull();
			await search("nobody", user);
			expect(hint()).not.toBeNull();
		});

		/**
		 * Started from a list already on screen, and the query is widened rather
		 * than emptied - emptying it clears the results on its own, which would
		 * hide whether the failure clears them too. A failure that only stopped
		 * the spinner would leave stale names offered as if they still matched.
		 */
		it("stops the spinner when the forge fails, and drops what it was showing", async () => {
			searchForgeMembers.mockResolvedValue([actor("alice", "Alice")]);
			mount();
			await search("ali", user);
			expect(options()).toHaveLength(1);

			searchForgeMembers.mockRejectedValue(new Error("forge is down"));
			await search("ce", user);

			expect(field().value).toBe("alice");
			expect(spinner()).toBeNull();
			expect(options()).toHaveLength(0);
			expect(hint()).not.toBeNull();
		});

		/**
		 * A slow answer for text the user has since changed would overwrite the
		 * newer results with older ones, so it is dropped on arrival.
		 */
		it("drops an answer that arrives after the query moved on", async () => {
			const pending: ((value: Actor[]) => void)[] = [];
			searchForgeMembers.mockImplementation(
				() =>
					new Promise<Actor[]>((resolve) => {
						pending.push(resolve);
					}),
			);
			mount();
			await search("alice", user);
			await user.clear(field());
			await search("bob", user);
			expect(pending).toHaveLength(2);

			pending[1]([actor("bob")]);
			await vi.advanceTimersByTimeAsync(0);
			pending[0]([actor("alice")]);
			await vi.advanceTimersByTimeAsync(0);

			expect(options().map((o) => o.textContent)).toEqual([
				expect.stringContaining("bob"),
			]);
		});
	});

	describe("choosing members", () => {
		it("turns a result into a chip and clears the search", async () => {
			searchForgeMembers.mockResolvedValue([actor("alice", "Alice")]);
			mount();
			await search("a", user);
			await user.click(options()[0]);
			expect(chips()).toEqual([expect.stringContaining("Alice")]);
			expect(field().value).toBe("");
			expect(options()).toHaveLength(0);
		});

		it("keeps the members it was opened with", () => {
			mount({ selected: [actor("carol", "Carol")] });
			expect(chips()).toEqual([expect.stringContaining("Carol")]);
		});

		/** Offering someone already chosen would let them be added twice. */
		it("leaves out members already chosen", async () => {
			searchForgeMembers.mockResolvedValue([
				actor("alice", "Alice"),
				actor("bob", "Bob"),
			]);
			mount({ selected: [actor("alice", "Alice")] });
			await search("a", user);
			expect(options()).toHaveLength(1);
			expect(options()[0].textContent).toContain("Bob");
		});

		it("adds several members one after the other", async () => {
			searchForgeMembers.mockResolvedValue([actor("alice"), actor("bob")]);
			mount();
			await search("a", user);
			await user.click(options()[0]);
			await search("b", user);
			await user.click(
				options().find((o) => o.textContent?.includes("bob")) as HTMLElement,
			);
			expect(chips()).toHaveLength(2);
		});

		it("removes a chip on request", async () => {
			mount({ selected: [actor("alice", "Alice"), actor("bob", "Bob")] });
			const remove = document.querySelectorAll(".chip-x");
			await user.click(remove[0] as HTMLElement);
			expect(chips()).toEqual([expect.stringContaining("Bob")]);
		});

		it("shows no chip row at all when nobody is chosen", () => {
			mount({ selected: [] });
			expect(document.querySelector(".mr-chips")).toBeNull();
		});

		it("names the remove button for a screen reader", () => {
			mount({ selected: [actor("alice", "Alice")] });
			expect(
				(document.querySelector(".chip-x") as HTMLElement).getAttribute(
					"aria-label",
				),
			).toBeTruthy();
		});
	});
});
