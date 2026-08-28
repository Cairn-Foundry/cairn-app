import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileNode, QuickSearchHit } from "$lib/services/file-service";

const quickSearch = vi.fn();
vi.mock("$lib/services/file-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	quickSearch: (...args: unknown[]) => quickSearch(...args),
}));

// The toggle writes through the settings store, which round-trips the whole
// object through the backend; here the write is acknowledged as it stands.
vi.mock("$lib/services/settings-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	updateSettings: vi.fn(async (next: unknown) => next),
}));

const { settings } = await import("$lib/stores/settings");
const { default: QuickOpen } = await import("./QuickOpen.svelte");

function hit(path: string, isDir = false): QuickSearchHit {
	return { path, isDir };
}

function node(name: string, path: string, children?: FileNode[]): FileNode {
	return {
		name,
		path,
		isDir: children !== undefined,
		children,
	} as FileNode;
}

function mount(props: Record<string, unknown> = {}) {
	const onOpen = vi.fn();
	const onClose = vi.fn();
	const result = render(QuickOpen, {
		tree: [],
		worktreePath: "/repo",
		onOpen,
		onClose,
		...props,
	});
	return { ...result, onOpen, onClose };
}

const field = () => screen.getByRole("textbox") as HTMLInputElement;
const options = () => screen.queryAllByRole("option");
const names = () =>
	options().map((o) => o.querySelector(".result-name")?.textContent);
const selected = () =>
	document.querySelector(".result-item.selected .result-name")?.textContent;
const noResults = () => document.querySelector(".no-results")?.textContent;

/** Lets the search effect and its promise settle. */
async function settle() {
	await tick();
	await tick();
}

beforeEach(() => {
	quickSearch.mockReset();
	quickSearch.mockResolvedValue([]);
	settings.save({ quickSearchShowGitignored: false });
});

describe("QuickOpen", () => {
	describe("searching the worktree", () => {
		it("asks the backend for what was typed", async () => {
			mount();
			await userEvent.type(field(), "main");
			await settle();
			expect(quickSearch).toHaveBeenCalledWith(
				"/repo",
				"main",
				false,
				expect.any(Boolean),
				expect.any(Number),
			);
		});

		it("lists the hits it got back", async () => {
			quickSearch.mockResolvedValue([
				hit("src/main.ts"),
				hit("src/lib/util.ts"),
			]);
			mount();
			await userEvent.type(field(), "ts");
			await settle();
			expect(names()).toEqual(["main.ts", "util.ts"]);
		});

		it("shows the folder each hit sits in", async () => {
			quickSearch.mockResolvedValue([hit("src/lib/util.ts")]);
			mount();
			await userEvent.type(field(), "u");
			await settle();
			expect(options()[0].querySelector(".result-dir")?.textContent).toBe(
				"src/lib",
			);
		});

		it("says so when nothing matched, quoting what was typed", async () => {
			mount();
			await userEvent.type(field(), "zzz");
			await settle();
			expect(options()).toHaveLength(0);
			expect(noResults()).toContain("zzz");
		});

		/** An empty field is not a failed search, so it says nothing. */
		it("says nothing while the field is empty", async () => {
			mount();
			await settle();
			expect(noResults()).toBeUndefined();
		});

		it("takes the cursor so the user can type straight away", () => {
			mount();
			expect(document.activeElement).toBe(field());
		});
	});

	describe("when the index is unavailable", () => {
		/**
		 * The backend index can fail; the already loaded tree is still there, so
		 * the search falls back to ranking it rather than showing nothing.
		 */
		it("falls back to ranking the loaded tree", async () => {
			quickSearch.mockRejectedValue(new Error("no index"));
			mount({
				tree: [node("src", "src", [node("main.ts", "src/main.ts")])],
			});
			await userEvent.type(field(), "main");
			await settle();
			expect(names()).toContain("main.ts");
		});

		/** With no worktree there is no index to ask at all. */
		it("ranks the tree without asking the backend when there is no worktree", async () => {
			mount({
				worktreePath: "",
				tree: [node("src", "src", [node("main.ts", "src/main.ts")])],
			});
			await userEvent.type(field(), "main");
			await settle();
			expect(quickSearch).not.toHaveBeenCalled();
			expect(names()).toContain("main.ts");
		});

		it("leaves out the tree entries that do not match", async () => {
			quickSearch.mockRejectedValue(new Error("no index"));
			mount({
				tree: [
					node("src", "src", [
						node("main.ts", "src/main.ts"),
						node("other.css", "src/other.css"),
					]),
				],
			});
			await userEvent.type(field(), "main");
			await settle();
			expect(names()).not.toContain("other.css");
		});
	});

	describe("ignored files", () => {
		it("leaves them out by default", async () => {
			mount();
			await userEvent.type(field(), "a");
			await settle();
			expect(quickSearch).toHaveBeenLastCalledWith(
				"/repo",
				"a",
				false,
				expect.any(Boolean),
				expect.any(Number),
			);
		});

		it("searches them once the toggle is on", async () => {
			mount();
			await userEvent.click(
				document.querySelector(".gitignore-toggle") as HTMLElement,
			);
			await settle();
			expect(quickSearch).toHaveBeenLastCalledWith(
				"/repo",
				"",
				true,
				expect.any(Boolean),
				expect.any(Number),
			);
		});

		/**
		 * The index is built per worktree and per ignore setting, so it is only
		 * rebuilt when one of those changed - not on every keystroke.
		 */
		it("rebuilds the index when the ignore setting changes, not on every letter", async () => {
			mount();
			await userEvent.type(field(), "abc");
			await settle();
			const refreshes = quickSearch.mock.calls.filter((c) => c[3] === true);
			expect(refreshes).toHaveLength(1);

			await userEvent.click(
				document.querySelector(".gitignore-toggle") as HTMLElement,
			);
			await settle();
			expect(quickSearch.mock.calls.filter((c) => c[3] === true)).toHaveLength(
				2,
			);
		});

		it("puts the cursor back in the field after the toggle", async () => {
			mount();
			await userEvent.click(
				document.querySelector(".gitignore-toggle") as HTMLElement,
			);
			expect(document.activeElement).toBe(field());
		});
	});

	describe("choosing a file", () => {
		beforeEach(() => {
			quickSearch.mockResolvedValue([hit("a.ts"), hit("b.ts"), hit("c.ts")]);
		});

		it("selects the first hit to begin with", async () => {
			mount();
			await userEvent.type(field(), "ts");
			await settle();
			expect(selected()).toBe("a.ts");
		});

		it("walks down and back up the list", async () => {
			mount();
			await userEvent.type(field(), "ts");
			await settle();
			await userEvent.keyboard("{ArrowDown}{ArrowDown}");
			expect(selected()).toBe("c.ts");
			await userEvent.keyboard("{ArrowUp}");
			expect(selected()).toBe("b.ts");
		});

		it("stops at the ends rather than wrapping", async () => {
			mount();
			await userEvent.type(field(), "ts");
			await settle();
			await userEvent.keyboard("{ArrowUp}");
			expect(selected()).toBe("a.ts");
			await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}");
			expect(selected()).toBe("c.ts");
		});

		it("opens the hit the arrows landed on, and closes", async () => {
			const { onOpen, onClose } = mount();
			await userEvent.type(field(), "ts");
			await settle();
			await userEvent.keyboard("{ArrowDown}{Enter}");
			expect(onOpen).toHaveBeenCalledWith(hit("b.ts"));
			expect(onClose).toHaveBeenCalled();
		});

		it("opens the hit that was clicked", async () => {
			const { onOpen } = mount();
			await userEvent.type(field(), "ts");
			await settle();
			await userEvent.click(options()[2]);
			expect(onOpen).toHaveBeenCalledWith(hit("c.ts"));
		});

		/** A new search moves the list under the cursor, so the choice goes back up. */
		it("goes back to the first hit when the results change", async () => {
			mount();
			await userEvent.type(field(), "ts");
			await settle();
			await userEvent.keyboard("{ArrowDown}{ArrowDown}");
			expect(selected()).toBe("c.ts");

			quickSearch.mockResolvedValue([hit("x.ts"), hit("y.ts")]);
			await userEvent.type(field(), "x");
			await settle();
			expect(selected()).toBe("x.ts");
		});

		it("opens nothing when there is nothing to open", async () => {
			quickSearch.mockResolvedValue([]);
			const { onOpen } = mount();
			await userEvent.type(field(), "zzz");
			await settle();
			await userEvent.keyboard("{Enter}");
			expect(onOpen).not.toHaveBeenCalled();
		});

		it("marks the selected hit for a screen reader", async () => {
			mount();
			await userEvent.type(field(), "ts");
			await settle();
			expect(options()[0].getAttribute("aria-selected")).toBe("true");
			expect(options()[1].getAttribute("aria-selected")).toBe("false");
		});
	});

	describe("closing", () => {
		it("closes on Escape", async () => {
			const { onClose } = mount();
			await userEvent.type(field(), "{Escape}");
			expect(onClose).toHaveBeenCalled();
		});

		it("closes on a click outside the panel", async () => {
			const { onClose } = mount();
			await userEvent.click(document.querySelector(".overlay") as HTMLElement);
			expect(onClose).toHaveBeenCalled();
		});

		it("stays open on a click inside the panel", async () => {
			const { onClose } = mount();
			await userEvent.click(document.querySelector(".panel") as HTMLElement);
			expect(onClose).not.toHaveBeenCalled();
		});
	});
});
