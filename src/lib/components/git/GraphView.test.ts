// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitGraphCommit } from "$lib/services/git-service";
import { SEARCH_DEBOUNCE_MS } from "$lib/utils/timing";
import { instance } from "../../../test/fixtures";
import GraphView from "./GraphView.svelte";

function commit(
	hash: string,
	parents: string[] = [],
	overrides: Partial<GitGraphCommit> = {},
): GitGraphCommit {
	return {
		hash,
		shortHash: hash.slice(0, 7),
		message: `commit ${hash}`,
		author: "someone",
		authorEmail: "someone@example.com",
		date: new Date().toISOString(),
		committer: "someone",
		committerDate: new Date().toISOString(),
		parents,
		refs: [],
		...overrides,
	};
}

function mount(props: Record<string, unknown> = {}) {
	const events = {
		selectCommit: vi.fn(),
		selectStash: vi.fn(),
		branchAction: vi.fn(),
		switchInstance: vi.fn(),
		createInstanceFromRef: vi.fn(),
		loadMore: vi.fn(),
		searchToggle: vi.fn(),
		refresh: vi.fn(),
	};
	const result = render(GraphView, {
		props: { commits: [], currentBranch: "main", ...props },
		events: Object.fromEntries(
			Object.entries(events).map(([name, fn]) => [
				name,
				(e: CustomEvent) => fn(e.detail),
			]),
		),
	});
	return { ...result, ...events };
}

const rows = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".commit-outer"));
const messages = () =>
	rows().map((r) => r.querySelector(".commit-text")?.textContent?.trim());
const chipsOf = (rowIndex: number) =>
	Array.from(rows()[rowIndex].querySelectorAll<HTMLElement>(".ref-chip"));
const chipLabels = (rowIndex: number) =>
	chipsOf(rowIndex).map((c) => c.textContent?.trim().split(/\s+/)[0]);
const search = () =>
	document.querySelector(".graph-search-input") as HTMLInputElement;
const dots = () =>
	Array.from(document.querySelectorAll<SVGCircleElement>(".graph-svg circle"));
const empty = () => document.querySelector(".graph-empty")?.textContent;

describe("GraphView", () => {
	describe("the rows", () => {
		it("draws one row per commit", () => {
			mount({ commits: [commit("a", ["b"]), commit("b")] });
			expect(rows()).toHaveLength(2);
		});

		it("says so when there is no history at all", () => {
			mount({ commits: [] });
			expect(rows()).toHaveLength(0);
			expect(empty()).toBeTruthy();
		});

		it("reports the commit that was clicked", async () => {
			const head = commit("a", ["b"]);
			const { selectCommit } = mount({ commits: [head, commit("b")] });
			await userEvent.click(rows()[0]);
			expect(selectCommit).toHaveBeenCalledWith(head);
		});

		it("marks the selected commit", () => {
			mount({
				commits: [commit("a", ["b"]), commit("b")],
				selectedHash: "b",
			});
			expect(rows()[0].classList.contains("is-selected")).toBe(false);
			expect(rows()[1].classList.contains("is-selected")).toBe(true);
		});

		it("marks the commit the current branch points at", () => {
			mount({
				commits: [commit("a", ["b"], { refs: ["HEAD -> main"] }), commit("b")],
				currentBranch: "main",
			});
			expect(rows()[0].classList.contains("is-current")).toBe(true);
			expect(rows()[1].classList.contains("is-current")).toBe(false);
		});

		/** The ancestry of the current branch reads apart from unrelated work. */
		it("marks the ancestors of the current branch, but not the current commit twice", () => {
			mount({
				commits: [
					commit("a", ["b"], { refs: ["HEAD -> main"] }),
					commit("b", ["c"]),
					commit("c"),
					commit("x", [], { refs: ["other"] }),
				],
				currentBranch: "main",
			});
			expect(rows()[0].classList.contains("is-on-branch")).toBe(false);
			expect(rows()[1].classList.contains("is-on-branch")).toBe(true);
			expect(rows()[2].classList.contains("is-on-branch")).toBe(true);
			expect(rows()[3].classList.contains("is-on-branch")).toBe(false);
		});
	});

	describe("the lanes", () => {
		/** A straight history is one lane: every commit sits on the same x. */
		it("keeps a linear history in a single lane", () => {
			mount({
				commits: [commit("a", ["b"]), commit("b", ["c"]), commit("c")],
			});
			const xs = new Set(dots().map((d) => d.getAttribute("cx")));
			expect(xs.size).toBe(1);
		});

		/** Two heads over a shared parent need two lanes until they converge. */
		it("gives diverging heads lanes of their own", () => {
			mount({
				commits: [commit("a", ["base"]), commit("b", ["base"]), commit("base")],
			});
			const xs = dots().map((d) => d.getAttribute("cx"));
			expect(xs[0]).not.toBe(xs[1]);
		});

		/**
		 * A lane freed in the middle of the graph is taken again rather than the
		 * graph growing a new column for ever. The history below is the smallest
		 * one found that actually distinguishes the two behaviours: simpler
		 * shapes leave the first free slot at the end of the lane array, where
		 * reusing it and appending a new one give the same layout.
		 */
		it("takes a freed lane back rather than widening for ever", () => {
			mount({
				commits: [
					commit("h0", ["h2"]),
					commit("h1"),
					commit("h2", ["h3"]),
					commit("h3", ["h5", "h6"]),
					commit("h4", ["h9"]),
					commit("h5"),
					commit("h6", ["h8"]),
					commit("h7", ["h8", "h9"]),
					commit("h8", ["h9"]),
					commit("h9"),
				],
			});
			const xs = dots().map((d) => Number(d.getAttribute("cx")));
			// h7 onwards reuse the lanes h1 and h5 left behind; without reuse the
			// graph keeps widening and these commits sit further right.
			expect(xs.slice(7)).toEqual([xs[0], xs[0], xs[0]]);
			expect(Math.max(...xs)).toBe(xs[4]);
		});

		it("draws a merge commit joining more than one parent", () => {
			mount({
				commits: [
					commit("m", ["a", "b"]),
					commit("a", ["base"]),
					commit("b", ["base"]),
					commit("base"),
				],
			});
			expect(
				document.querySelectorAll(".graph-svg path").length,
			).toBeGreaterThan(0);
		});

		it("draws a graph for a commit with no parent at all", () => {
			mount({ commits: [commit("root")] });
			expect(dots()).toHaveLength(1);
		});
	});

	describe("the ref chips", () => {
		it("sorts the current branch first and tags last", () => {
			mount({
				commits: [
					commit("a", [], {
						refs: ["tag: v1", "origin/release", "feature", "HEAD -> main"],
					}),
				],
			});
			expect(chipLabels(0)).toEqual([
				"main",
				"feature",
				"origin/release",
				"v1",
			]);
		});

		it("classifies each ref by what it is", () => {
			mount({
				commits: [
					commit("a", [], {
						refs: ["HEAD -> main", "tag: v1", "origin/release", "feature"],
					}),
				],
			});
			const kinds = chipsOf(0).map((c) => c.className);
			expect(kinds[0]).toContain("chip-head-branch");
			expect(kinds[1]).toContain("chip-local");
			expect(kinds[2]).toContain("chip-remote");
			expect(kinds[3]).toContain("chip-tag");
		});

		it("shows a detached HEAD as its own chip", () => {
			mount({ commits: [commit("a", [], { refs: ["HEAD"] })] });
			expect(chipLabels(0)).toEqual(["HEAD"]);
			expect(chipsOf(0)[0].className).toContain("chip-head");
		});

		it("shows no chips on a commit carrying no ref", () => {
			mount({ commits: [commit("a")] });
			expect(chipsOf(0)).toHaveLength(0);
		});

		/**
		 * A branch in sync with its remote takes one chip, not two: the row is
		 * narrow and the second label said nothing the first one did not.
		 */
		it("folds the remote ref into the chip of its local branch", () => {
			mount({
				commits: [
					commit("a", [], { refs: ["HEAD -> develop", "origin/develop"] }),
				],
			});
			expect(chipsOf(0)).toHaveLength(1);
			expect(chipLabels(0)).toEqual(["develop"]);
			expect(chipsOf(0)[0].querySelector(".chip-remotes")?.textContent).toBe(
				"origin",
			);
		});

		it("folds a local branch that is not HEAD just the same", () => {
			mount({
				commits: [commit("a", [], { refs: ["master", "origin/master"] })],
			});
			expect(chipLabels(0)).toEqual(["master"]);
			expect(chipsOf(0)[0].className).toContain("chip-local");
		});

		it("names every remote the branch is in sync with", () => {
			mount({
				commits: [
					commit("a", [], {
						refs: ["main", "origin/main", "upstream/main"],
					}),
				],
			});
			expect(chipsOf(0)).toHaveLength(1);
			expect(chipsOf(0)[0].querySelector(".chip-remotes")?.textContent).toBe(
				"origin upstream",
			);
		});

		/** The gap between a branch and its remote is what the two chips are for. */
		it("keeps the remote ref on its own commit when it lags behind", () => {
			mount({
				commits: [
					commit("a", ["b"], { refs: ["HEAD -> develop"] }),
					commit("b", [], { refs: ["origin/develop"] }),
				],
			});
			expect(chipLabels(0)).toEqual(["develop"]);
			expect(chipsOf(0)[0].querySelector(".chip-remotes")).toBeNull();
			expect(chipLabels(1)).toEqual(["origin/develop"]);
		});

		it("folds a remote ref of a branch whose name has slashes", () => {
			mount({
				commits: [
					commit("a", [], {
						refs: ["HEAD -> fix/graph", "origin/fix/graph"],
					}),
				],
			});
			expect(chipsOf(0)).toHaveLength(1);
			expect(chipLabels(0)).toEqual(["fix/graph"]);
		});

		/** `origin/HEAD` names no local branch, so it has nothing to fold into. */
		it("leaves the remote HEAD symbolic ref alone", () => {
			mount({
				commits: [
					commit("a", [], {
						refs: ["HEAD -> main", "origin/main", "origin/HEAD"],
					}),
				],
			});
			expect(chipLabels(0)).toEqual(["main", "origin/HEAD"]);
		});
	});

	describe("instances behind the branches", () => {
		const withInstance = () => ({
			commits: [commit("a", [], { refs: ["HEAD -> main", "feature"] })],
			instances: [instance("i1", "p1", { branch: "feature" })],
		});

		it("shows the ticket of the instance sitting on a branch", () => {
			mount(withInstance());
			const chip = chipsOf(0).find((c) =>
				c.textContent?.includes("feature"),
			) as HTMLElement;
			expect(chip.querySelector(".chip-ticket")?.textContent).toBe("i1");
		});

		it("switches to that instance when its chip is used", async () => {
			const props = withInstance();
			const { switchInstance } = mount(props);
			const chip = chipsOf(0).find((c) =>
				c.textContent?.includes("feature"),
			) as HTMLElement;
			await userEvent.click(chip);
			expect(switchInstance).toHaveBeenCalledWith(props.instances[0]);
		});

		/** A branch with no instance offers to start one rather than doing nothing. */
		it("offers to branch off a ref that has no instance", async () => {
			const { createInstanceFromRef } = mount({
				commits: [commit("a", [], { refs: ["orphan"] })],
			});
			const chip = chipsOf(0)[0];
			expect(chip.classList.contains("chip-creatable")).toBe(true);
			await userEvent.click(chip);
			expect(createInstanceFromRef).toHaveBeenCalledWith("orphan");
		});

		it("offers nothing on a tag, which is not a branch", async () => {
			const { createInstanceFromRef } = mount({
				commits: [commit("a", [], { refs: ["tag: v1"] })],
			});
			await userEvent.click(chipsOf(0)[0]);
			expect(createInstanceFromRef).not.toHaveBeenCalled();
		});

		/** `origin/HEAD` is a symbolic ref, not a branch anyone can work on. */
		it("offers nothing on a remote HEAD symbolic ref", async () => {
			const { createInstanceFromRef } = mount({
				commits: [commit("a", [], { refs: ["origin/HEAD"] })],
			});
			await userEvent.click(chipsOf(0)[0]);
			expect(createInstanceFromRef).not.toHaveBeenCalled();
		});
	});

	describe("searching", () => {
		// The filter trails the input by a debounce window, so a test types and
		// then lets that window elapse rather than asserting on the keystroke.
		beforeEach(() => {
			vi.useFakeTimers({ shouldAdvanceTime: true });
		});
		afterEach(() => {
			vi.useRealTimers();
		});

		async function typeSearch(text: string) {
			await userEvent.type(search(), text);
			await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
			await tick();
		}

		const history = [
			commit("aaa1", [], { message: "fix the parser", author: "alice" }),
			commit("bbb2", [], { message: "add a button", author: "bob" }),
		];

		it("matches on the message", async () => {
			mount({ commits: history });
			await typeSearch("parser");
			expect(messages()).toEqual(["fix the parser"]);
		});

		it("matches on the author", async () => {
			mount({ commits: history });
			await typeSearch("bob");
			expect(messages()).toEqual(["add a button"]);
		});

		it("matches on the hash", async () => {
			mount({ commits: history });
			await typeSearch("aaa1");
			expect(messages()).toEqual(["fix the parser"]);
		});

		it("matches on a ref", async () => {
			mount({
				commits: [
					commit("a", [], { message: "one", refs: ["release/2.0"] }),
					commit("b", [], { message: "two" }),
				],
			});
			await typeSearch("release");
			expect(messages()).toEqual(["one"]);
		});

		/** The instance behind a branch is findable by its ticket, not only its name. */
		it("matches on the ticket of an instance sitting on a branch", async () => {
			mount({
				commits: [
					commit("a", [], { message: "one", refs: ["feature"] }),
					commit("b", [], { message: "two" }),
				],
				instances: [instance("PROJ-42", "p1", { branch: "feature" })],
			});
			await typeSearch("proj-42");
			expect(messages()).toEqual(["one"]);
		});

		it("distinguishes no match from no history", async () => {
			mount({ commits: history });
			await typeSearch("zzz");
			expect(rows()).toHaveLength(0);
			expect(empty()).toBeTruthy();
		});

		it("says when the search starts and when it stops", async () => {
			const { searchToggle } = mount({ commits: history });
			await typeSearch("a");
			expect(searchToggle).toHaveBeenLastCalledWith(true);
			await userEvent.clear(search());
			await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
			await tick();
			expect(searchToggle).toHaveBeenLastCalledWith(false);
		});

		it("lists everything again once the search is cleared", async () => {
			mount({ commits: history });
			await typeSearch("parser");
			await userEvent.click(
				document.querySelector(".graph-search-clear") as HTMLElement,
			);
			await tick();
			expect(rows()).toHaveLength(2);
		});

		/** The whole point of the debounce: typing does not filter on each key. */
		it("waits for the typing to settle before filtering", async () => {
			mount({ commits: history });
			await userEvent.type(search(), "parser");
			expect(messages()).toHaveLength(2);

			await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
			await tick();
			expect(messages()).toEqual(["fix the parser"]);
		});

		/** Clearing restores everything at once - a delay would read as stuck. */
		it("restores the full list without waiting when the field is cleared", async () => {
			mount({ commits: history });
			await typeSearch("parser");
			expect(messages()).toEqual(["fix the parser"]);

			await userEvent.clear(search());
			await tick();
			expect(messages()).toHaveLength(2);
		});
	});

	describe("loading more history", () => {
		const scroller = () =>
			document.querySelector(".graph-scroll") as HTMLElement;

		/** Asks for the next page once the scroll nears the bottom. */
		function scrollNearBottom(el: HTMLElement) {
			Object.defineProperty(el, "scrollHeight", {
				value: 1000,
				configurable: true,
			});
			Object.defineProperty(el, "clientHeight", {
				value: 400,
				configurable: true,
			});
			el.scrollTop = 500;
			el.dispatchEvent(new Event("scroll"));
		}

		it("asks for another page near the bottom", () => {
			const { loadMore } = mount({
				commits: [commit("a")],
				hasMore: true,
			});
			scrollNearBottom(scroller());
			expect(loadMore).toHaveBeenCalledTimes(1);
		});

		it("asks for nothing when there is no more history", () => {
			const { loadMore } = mount({
				commits: [commit("a")],
				hasMore: false,
			});
			scrollNearBottom(scroller());
			expect(loadMore).not.toHaveBeenCalled();
		});

		/** Measures the scroller as a real layout would: a panel `panel` tall holding `content`. */
		function laidOut(panel: number, content: number) {
			const proto = HTMLElement.prototype;
			const saved = {
				clientHeight: Object.getOwnPropertyDescriptor(proto, "clientHeight"),
				scrollHeight: Object.getOwnPropertyDescriptor(proto, "scrollHeight"),
			};
			Object.defineProperty(proto, "clientHeight", {
				get: () => panel,
				configurable: true,
			});
			Object.defineProperty(proto, "scrollHeight", {
				get: () => content,
				configurable: true,
			});
			return () => {
				for (const [key, desc] of Object.entries(saved)) {
					if (desc) Object.defineProperty(proto, key, desc);
					else delete (proto as unknown as Record<string, unknown>)[key];
				}
			};
		}

		/** Nothing to scroll means no scroll event: the list must fill the panel on its own. */
		it("tops the list up while it does not fill the panel", async () => {
			const restore = laidOut(900, 400);
			try {
				const { loadMore } = mount({ commits: [commit("a")], hasMore: true });
				await tick();
				await tick();
				expect(loadMore).toHaveBeenCalledTimes(1);
			} finally {
				restore();
			}
		});

		it("waits for a scroll once the list overflows the panel", async () => {
			const restore = laidOut(400, 3000);
			try {
				const { loadMore } = mount({ commits: [commit("a")], hasMore: true });
				await tick();
				await tick();
				expect(loadMore).not.toHaveBeenCalled();
			} finally {
				restore();
			}
		});

		/** One request at a time: scrolling further must not stack pages. */
		it("asks for nothing while a page is still coming", () => {
			const { loadMore } = mount({
				commits: [commit("a")],
				hasMore: true,
				paging: "loading",
			});
			scrollNearBottom(scroller());
			expect(loadMore).not.toHaveBeenCalled();
		});

		it("asks again once the page arrived", async () => {
			const { loadMore, rerender } = mount({
				commits: [commit("a")],
				hasMore: true,
				paging: "loading",
			});
			await rerender({
				commits: [commit("a"), commit("b")],
				currentBranch: "main",
				hasMore: true,
				paging: "idle",
			});
			scrollNearBottom(scroller());
			expect(loadMore).toHaveBeenCalledTimes(1);
		});

		/** A failed page must not spin forever: it says so and offers a retry. */
		it("offers a retry instead of a spinner when a page failed", async () => {
			const { loadMore } = mount({
				commits: [commit("a")],
				hasMore: true,
				paging: "failed",
			});
			scrollNearBottom(scroller());
			expect(loadMore).not.toHaveBeenCalled();
			await userEvent.click(
				document.querySelector(".graph-retry-btn") as HTMLElement,
			);
			expect(loadMore).toHaveBeenCalledTimes(1);
		});

		/**
		 * The lane layout is cached across renders, and a pull or a push moves a
		 * ref without adding a commit: the chips have to follow anyway.
		 */
		it("redraws the chips when a ref moves without the commits changing", async () => {
			const { rerender } = mount({
				commits: [
					commit("a", ["b"], { refs: ["HEAD -> develop"] }),
					commit("b", [], { refs: ["origin/develop"] }),
				],
				currentBranch: "develop",
			});
			expect(chipLabels(1)).toEqual(["origin/develop"]);
			await rerender({
				commits: [
					commit("a", ["b"], { refs: ["HEAD -> develop", "origin/develop"] }),
					commit("b", []),
				],
				currentBranch: "develop",
			});
			expect(chipsOf(0)[0].querySelector(".chip-remotes")?.textContent).toBe(
				"origin",
			);
			expect(chipsOf(1)).toHaveLength(0);
		});

		it("asks for a refresh on request", async () => {
			const { refresh } = mount({ commits: [commit("a")] });
			await userEvent.click(
				document.querySelector(".graph-refresh-btn") as HTMLElement,
			);
			expect(refresh).toHaveBeenCalled();
		});
	});
});

describe("stashes", () => {
	const stash = commit("s0", ["b"], {
		refs: ["stash@{0}"],
		message: "WIP on main: b",
	});

	it("draws a stash above the commit it was taken on, with its own chip", () => {
		mount({
			commits: [commit("c", ["b"]), commit("b")],
			stashes: [stash],
		});
		expect(messages()).toEqual(["commit c", "WIP on main: b", "commit b"]);
		expect(chipsOf(1)[0].classList.contains("chip-stash")).toBe(true);
	});

	it("opens the stash rather than selecting a commit", async () => {
		const { selectCommit, selectStash } = mount({
			commits: [commit("b")],
			stashes: [stash],
		});
		await userEvent.click(rows()[0]);
		expect(selectStash).toHaveBeenCalledWith(0);
		expect(selectCommit).not.toHaveBeenCalled();
	});

	it("offers no commit menu on a stash", async () => {
		mount({ commits: [commit("b")], stashes: [stash] });
		rows()[0].dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
		await tick();
		expect(document.querySelector(".commit-menu")).toBeNull();
	});
});

describe("the branch chip menu", () => {
	const rightClick = (el: HTMLElement) =>
		el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
	const menuItems = () =>
		Array.from(document.querySelectorAll<HTMLElement>(".chip-menu button"));

	it("offers rename and delete on a local branch, not the commit menu", async () => {
		const { branchAction } = mount({
			commits: [commit("a", [], { refs: ["feat/x"] })],
			localBranches: ["feat/x"],
		});
		rightClick(chipsOf(0)[0]);
		await tick();
		expect(document.querySelector(".commit-menu")).toBeNull();
		expect(menuItems()).toHaveLength(2);
		await userEvent.click(menuItems()[1]);
		expect(branchAction).toHaveBeenCalledWith({
			action: "delete",
			branch: "feat/x",
		});
	});

	/** A remote-tracking ref has no local name to change. */
	it("offers only the remote deletion on a remote branch", async () => {
		const { branchAction } = mount({
			commits: [commit("a", [], { refs: ["origin/feat/y"] })],
		});
		rightClick(chipsOf(0)[0]);
		await tick();
		expect(menuItems()).toHaveLength(1);
		await userEvent.click(menuItems()[0]);
		expect(branchAction).toHaveBeenCalledWith({
			action: "delete",
			branch: "origin/feat/y",
		});
	});

	it("leaves the click on a chip as it was", async () => {
		const { branchAction, createInstanceFromRef } = mount({
			commits: [commit("a", [], { refs: ["feat/x"] })],
			localBranches: ["feat/x"],
		});
		await userEvent.click(chipsOf(0)[0]);
		expect(createInstanceFromRef).toHaveBeenCalledWith("feat/x");
		expect(branchAction).not.toHaveBeenCalled();
	});
});

describe("the hover card", () => {
	beforeEach(() => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	const card = () => document.querySelector(".commit-card");

	async function hover(row: HTMLElement) {
		row.dispatchEvent(new MouseEvent("mouseenter", { clientX: 10 }));
		await vi.advanceTimersByTimeAsync(500);
		await tick();
	}

	/** The row truncates the subject; the card is where it can be read whole. */
	it("shows the full subject, the body, the author and the full hash", async () => {
		const long = "feat: a subject far too long to fit in the row of the graph";
		const fetchBody = vi.fn().mockResolvedValue("The body of the commit.");
		mount({
			commits: [commit("abcdef1234567890", [], { message: long })],
			fetchBody,
		});
		await hover(rows()[0]);
		expect(card()?.textContent).toContain(long);
		expect(card()?.textContent).toContain("The body of the commit.");
		expect(card()?.textContent).toContain("someone@example.com");
		expect(card()?.textContent).toContain("abcdef1234567890");
		expect(fetchBody).toHaveBeenCalledWith("abcdef1234567890");
	});

	it("waits before showing, and leaves with the pointer", async () => {
		mount({ commits: [commit("a")] });
		rows()[0].dispatchEvent(new MouseEvent("mouseenter"));
		await tick();
		expect(card()).toBeNull();
		await vi.advanceTimersByTimeAsync(500);
		await tick();
		expect(card()).not.toBeNull();
		rows()[0].dispatchEvent(new MouseEvent("mouseleave"));
		await tick();
		expect(card()).toBeNull();
	});

	it("names the committer only when it differs from the author", async () => {
		mount({
			commits: [commit("a", [], { committer: "a maintainer" })],
		});
		await hover(rows()[0]);
		expect(card()?.textContent).toContain("a maintainer");
	});
});

describe("virtualised rows", () => {
	// jsdom lays nothing out, so the component falls back to its assumed 2000px
	// viewport: at 36px a row that is well under a thousand commits.
	const many = Array.from({ length: 1_000 }, (_, i) =>
		commit(`h${String(i).padStart(6, "0")}`),
	);

	it("keeps the DOM to the rows the viewport can show", () => {
		mount({ commits: many });
		expect(rows().length).toBeGreaterThan(0);
		expect(rows().length).toBeLessThan(many.length);
	});

	it("stands in for the rows it left out, so the scrollbar stays honest", () => {
		mount({ commits: many });
		const scroller = document.querySelector(".graph-scroll") as HTMLElement;
		const spacers = Array.from(scroller.children).filter(
			(el) => el instanceof HTMLElement && el.style.height.endsWith("px"),
		);
		const padding = spacers.reduce(
			(acc, el) => acc + Number.parseInt((el as HTMLElement).style.height, 10),
			0,
		);
		expect(padding).toBe((many.length - rows().length) * 36);
	});
});
