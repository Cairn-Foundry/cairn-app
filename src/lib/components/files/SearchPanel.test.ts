// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchMatch } from "$lib/services/file-service";

const searchInFiles = vi.fn();
vi.mock("$lib/services/file-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	searchInFiles: (...a: unknown[]) => searchInFiles(...a),
}));

const { SEARCH_DEBOUNCE_MS } = await import("$lib/utils/timing");
const { default: SearchPanel } = await import("./SearchPanel.svelte");

function match(
	path: string,
	line: number,
	overrides: Partial<SearchMatch> = {},
): SearchMatch {
	return {
		path,
		line,
		col: 1,
		text: "const value = 1;",
		matchStart: 6,
		matchEnd: 11,
		...overrides,
	};
}

function mount(props: Record<string, unknown> = {}) {
	const onOpen = vi.fn();
	const onClose = vi.fn();
	const result = render(SearchPanel, {
		worktreePath: "/repo",
		hidden: false,
		onOpen,
		onClose,
		...props,
	});
	return { ...result, onOpen, onClose };
}

const queryField = () =>
	document.querySelector(".search-input") as HTMLInputElement;
const groups = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".result-file-header"));
const groupNames = () =>
	groups().map((g) => g.querySelector(".result-filename")?.textContent);
const matchRows = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".result-match"));
const summary = () => document.querySelector(".summary-text")?.textContent;
const toggleTitled = (pattern: RegExp) =>
	Array.from(document.querySelectorAll<HTMLElement>(".toggle-btn")).find((b) =>
		pattern.test(b.getAttribute("title") ?? ""),
	) as HTMLElement;

let user: ReturnType<typeof userEvent.setup>;

/** Types a query and lets the debounce and the pending search settle. */
async function search(text: string) {
	await user.type(queryField(), text);
	await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
	await vi.advanceTimersByTimeAsync(0);
	await tick();
}

beforeEach(() => {
	vi.useFakeTimers();
	user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
	searchInFiles.mockReset();
	searchInFiles.mockResolvedValue([]);
});

afterEach(() => {
	vi.useRealTimers();
});

describe("SearchPanel", () => {
	describe("running the search", () => {
		it("waits for the typing to settle before searching", async () => {
			mount();
			await user.type(queryField(), "value");
			expect(searchInFiles).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
			expect(searchInFiles).toHaveBeenCalledTimes(1);
		});

		it("searches the worktree for what was typed", async () => {
			mount();
			await search("value");
			expect(searchInFiles).toHaveBeenCalledWith(
				"/repo",
				"value",
				expect.objectContaining({ caseSensitive: false, isRegex: false }),
			);
		});

		it("searches nothing while the query is blank", async () => {
			mount();
			await search("   ");
			expect(searchInFiles).not.toHaveBeenCalled();
		});

		it("searches nothing without a worktree", async () => {
			mount({ worktreePath: null });
			await search("value");
			expect(searchInFiles).not.toHaveBeenCalled();
		});

		it("reports a failed search rather than showing nothing", async () => {
			searchInFiles.mockRejectedValue(new Error("bad regex"));
			mount();
			await search("bad");
			expect(
				document.querySelector(".summary-text.error")?.textContent,
			).toContain("bad regex");
		});

		it("says so when nothing matched", async () => {
			mount();
			await search("nothing");
			expect(document.querySelector(".summary-text.dimmed")).not.toBeNull();
		});

		/** A slow answer for a query the user has moved past must not land. */
		it("drops an answer that arrives after the query moved on", async () => {
			const pending: ((v: SearchMatch[]) => void)[] = [];
			searchInFiles.mockImplementation(
				() =>
					new Promise<SearchMatch[]>((resolve) => {
						pending.push(resolve);
					}),
			);
			mount();
			await search("first");
			await user.clear(queryField());
			await search("second");
			expect(pending).toHaveLength(2);

			pending[1]([match("b.ts", 1)]);
			await vi.advanceTimersByTimeAsync(0);
			await tick();
			pending[0]([match("a.ts", 1)]);
			await vi.advanceTimersByTimeAsync(0);
			await tick();
			expect(groupNames()).toEqual(["b.ts"]);
		});
	});

	describe("the filters", () => {
		it("searches case sensitively once asked", async () => {
			mount();
			await user.click(toggleTitled(/case/i));
			await search("value");
			expect(searchInFiles).toHaveBeenLastCalledWith(
				"/repo",
				"value",
				expect.objectContaining({ caseSensitive: true }),
			);
		});

		it("searches by regular expression once asked", async () => {
			mount();
			await user.click(toggleTitled(/regul|regex/i));
			await search("va.ue");
			expect(searchInFiles).toHaveBeenLastCalledWith(
				"/repo",
				"va.ue",
				expect.objectContaining({ isRegex: true }),
			);
		});

		/** Changing a filter re-runs the search, it does not wait for a keystroke. */
		it("searches again when a filter changes", async () => {
			mount();
			await search("value");
			const before = searchInFiles.mock.calls.length;
			await user.click(toggleTitled(/case/i));
			await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
			expect(searchInFiles.mock.calls.length).toBeGreaterThan(before);
		});

		/** Noise folders are excluded by default rather than drowning the results. */
		it("excludes the usual noise folders by default", async () => {
			mount();
			await search("value");
			const options = searchInFiles.mock.calls[0][2] as {
				excludeGlob: string;
			};
			expect(options.excludeGlob).toContain("node_modules");
		});
	});

	describe("the results", () => {
		beforeEach(() => {
			searchInFiles.mockResolvedValue([
				match("src/a.ts", 3),
				match("src/a.ts", 9),
				match("src/b.ts", 1),
			]);
		});

		it("groups the matches by the file they are in", async () => {
			mount();
			await search("value");
			expect(groupNames()).toEqual(["a.ts", "b.ts"]);
		});

		it("counts the matches of each file", async () => {
			mount();
			await search("value");
			expect(groups()[0].querySelector(".result-count")?.textContent).toBe("2");
		});

		it("shows the folder each file sits in", async () => {
			mount();
			await search("value");
			expect(groups()[0].querySelector(".result-dir")?.textContent).toBe("src");
		});

		it("opens the file at the position that was clicked", async () => {
			const { onOpen } = mount();
			await search("value");
			await user.click(matchRows()[1]);
			expect(onOpen).toHaveBeenCalledWith("src/a.ts", 9, 1);
		});

		it("folds a group away and back", async () => {
			mount();
			await search("value");
			expect(matchRows()).toHaveLength(3);
			await user.click(groups()[0]);
			expect(matchRows()).toHaveLength(1);
			await user.click(groups()[0]);
			expect(matchRows()).toHaveLength(3);
		});

		it("folds every group at once", async () => {
			mount();
			await search("value");
			await user.click(
				document.querySelector(".summary-collapse") as HTMLElement,
			);
			expect(matchRows()).toHaveLength(0);
		});

		it("says how many matches in how many files", async () => {
			mount();
			await search("value");
			expect(summary()).toMatch(/3/);
		});
	});

	describe("highlighting the match inside its line", () => {
		const parts = () => [
			document.querySelector(".result-pre")?.textContent,
			document.querySelector(".result-hit")?.textContent,
			document.querySelector(".result-post")?.textContent,
		];

		it("splits the line around what matched", async () => {
			searchInFiles.mockResolvedValue([
				match("a.ts", 1, {
					text: "const value = 1;",
					matchStart: 6,
					matchEnd: 11,
				}),
			]);
			mount();
			await search("value");
			expect(parts()).toEqual(["const ", "value", " = 1;"]);
		});

		/**
		 * The line is shown without its indentation, so the offsets the backend
		 * gave shift by exactly what was trimmed.
		 */
		it("keeps the highlight aligned once the indentation is trimmed", async () => {
			searchInFiles.mockResolvedValue([
				match("a.ts", 1, {
					text: "      const value = 1;",
					matchStart: 12,
					matchEnd: 17,
				}),
			]);
			mount();
			await search("value");
			expect(parts()).toEqual(["const ", "value", " = 1;"]);
		});

		it("shows a match at the very start of a line", async () => {
			searchInFiles.mockResolvedValue([
				match("a.ts", 1, { text: "value = 1;", matchStart: 0, matchEnd: 5 }),
			]);
			mount();
			await search("value");
			expect(parts()).toEqual(["", "value", " = 1;"]);
		});
	});

	describe("being hidden and shown again", () => {
		/** Hidden but mounted: the query survives being closed and reopened. */
		it("keeps the query when the panel is hidden", async () => {
			const { rerender } = mount();
			await search("value");
			await rerender({
				worktreePath: "/repo",
				hidden: true,
				onOpen: vi.fn(),
				onClose: vi.fn(),
			});
			expect(queryField().value).toBe("value");
		});

		it("searches nothing while it is hidden", async () => {
			mount({ hidden: true });
			await search("value");
			expect(searchInFiles).not.toHaveBeenCalled();
		});

		/**
		 * Showing the panel again runs exactly one search, not one per keystroke
		 * typed while it was hidden.
		 *
		 * Note: the `hidden` guard inside `scheduleSearch` is not reachable from
		 * behaviour - removing it changes nothing observable, because the block
		 * that reacts to unhiding schedules a search of its own and the search
		 * itself refuses to run while hidden. It is belt and braces, not a
		 * behaviour this suite can pin down.
		 */
		it("searches once when the panel is shown again", async () => {
			const props = {
				worktreePath: "/repo",
				onOpen: vi.fn(),
				onClose: vi.fn(),
			};
			const { rerender } = mount({ ...props, hidden: true });
			await user.type(queryField(), "value");
			await rerender({ ...props, hidden: false });
			await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
			await vi.advanceTimersByTimeAsync(0);
			expect(searchInFiles).toHaveBeenCalledTimes(1);
		});

		it("closes on request", async () => {
			const { onClose } = mount();
			await user.click(
				document.querySelector(
					".search-header-actions .search-icon-btn:last-child",
				) as HTMLElement,
			);
			expect(onClose).toHaveBeenCalled();
		});
	});

	describe("changing worktree", () => {
		/** Each worktree keeps its own search rather than inheriting the last one. */
		it("clears the results of the previous worktree", async () => {
			searchInFiles.mockResolvedValue([match("a.ts", 1)]);
			const { rerender } = mount();
			await search("value");
			expect(groups()).toHaveLength(1);

			await rerender({
				worktreePath: "/other",
				hidden: false,
				onOpen: vi.fn(),
				onClose: vi.fn(),
			});
			await tick();
			expect(groups()).toHaveLength(0);
			expect(queryField().value).toBe("");
		});

		it("restores the search of a worktree it comes back to", async () => {
			const props = { hidden: false, onOpen: vi.fn(), onClose: vi.fn() };
			const { rerender } = mount();
			await search("value");
			await rerender({ ...props, worktreePath: "/other" });
			await tick();
			await rerender({ ...props, worktreePath: "/repo" });
			await tick();
			expect(queryField().value).toBe("value");
		});
	});
});
