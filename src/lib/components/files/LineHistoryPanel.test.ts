import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LineHistoryEntry } from "$lib/services/file-service";

const gitLineHistory = vi.fn();
vi.mock("$lib/services/file-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	gitLineHistory: (...a: unknown[]) => gitLineHistory(...a),
}));

const { default: LineHistoryPanel } = await import("./LineHistoryPanel.svelte");

const MAX_CHANGES = 12;

function entry(
	hash: string,
	overrides: Partial<LineHistoryEntry> = {},
): LineHistoryEntry {
	return {
		hash: `${hash}0000000000000000000000000000000000000`,
		shortHash: hash,
		author: "Alice",
		email: "alice@example.com",
		timestamp: 1_700_000_000_000,
		subject: `commit ${hash}`,
		changes: [],
		...overrides,
	};
}

function mount(props: Record<string, unknown> = {}) {
	const onClose = vi.fn();
	const result = render(LineHistoryPanel, {
		worktreePath: "/repo",
		relPath: "src/a.ts",
		line: 42,
		onClose,
		...props,
	});
	return { ...result, onClose };
}

const entries = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".lh-entry"));
const hashes = () =>
	entries().map((e) => e.querySelector(".lh-hash")?.textContent);
const changes = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".lh-change"));
const more = () => document.querySelector(".lh-more")?.textContent;

/** Lets the load effect and its promise settle. */
async function settle() {
	await tick();
	await tick();
}

beforeEach(() => {
	gitLineHistory.mockReset();
	gitLineHistory.mockResolvedValue([]);
});

describe("LineHistoryPanel", () => {
	describe("loading the history", () => {
		it("asks for the history of the line it was opened on", async () => {
			mount();
			await settle();
			expect(gitLineHistory).toHaveBeenCalledWith("/repo", "src/a.ts", 42);
		});

		it("shows a placeholder while it loads, not a word", () => {
			gitLineHistory.mockReturnValue(new Promise(() => {}));
			mount();
			expect(document.querySelector(".lh-skeleton")).not.toBeNull();
			expect(document.body.textContent?.toLowerCase()).not.toContain("loading");
		});

		it("says so when the line has no history", async () => {
			mount();
			await settle();
			expect(document.querySelector(".lh-note.dimmed")).not.toBeNull();
		});

		it("reports a failed lookup", async () => {
			gitLineHistory.mockRejectedValue(new Error("not a git repo"));
			mount();
			await settle();
			expect(document.querySelector(".lh-note.error")?.textContent).toContain(
				"not a git repo",
			);
		});

		it("asks for nothing without a worktree", async () => {
			mount({ worktreePath: null });
			await settle();
			expect(gitLineHistory).not.toHaveBeenCalled();
		});

		/** A line number counted from one; zero means nothing to look up. */
		it("asks for nothing on an impossible line", async () => {
			mount({ line: 0 });
			await settle();
			expect(gitLineHistory).not.toHaveBeenCalled();
		});

		/** A slow answer for a line the user has moved past must not land. */
		it("drops an answer that arrives after the line moved on", async () => {
			const pending: ((v: LineHistoryEntry[]) => void)[] = [];
			gitLineHistory.mockImplementation(
				() =>
					new Promise<LineHistoryEntry[]>((resolve) => {
						pending.push(resolve);
					}),
			);
			const { rerender } = mount({ line: 10 });
			await settle();
			await rerender({
				worktreePath: "/repo",
				relPath: "src/a.ts",
				line: 20,
				onClose: vi.fn(),
			});
			await settle();
			expect(pending).toHaveLength(2);

			pending[1]([entry("newer")]);
			await settle();
			pending[0]([entry("older")]);
			await settle();
			expect(hashes()).toEqual(["newer"]);
		});

		it("looks the history up again when the line changes", async () => {
			const { rerender } = mount({ line: 10 });
			await settle();
			expect(gitLineHistory).toHaveBeenLastCalledWith("/repo", "src/a.ts", 10);

			await rerender({
				worktreePath: "/repo",
				relPath: "src/a.ts",
				line: 20,
				onClose: vi.fn(),
			});
			await settle();
			expect(gitLineHistory).toHaveBeenLastCalledWith("/repo", "src/a.ts", 20);
		});
	});

	describe("the commits", () => {
		beforeEach(() => {
			gitLineHistory.mockResolvedValue([
				entry("aaa1111", { subject: "fix the parser" }),
				entry("bbb2222", { subject: "add a button" }),
			]);
		});

		it("lists every commit that touched the line", async () => {
			mount();
			await settle();
			expect(entries()).toHaveLength(2);
			expect(hashes()).toEqual(["aaa1111", "bbb2222"]);
		});

		it("shows the subject, the author and the date of each", async () => {
			mount();
			await settle();
			const first = entries()[0];
			expect(first.querySelector(".lh-subject")?.textContent).toBe(
				"fix the parser",
			);
			expect(first.querySelector(".lh-author")?.textContent).toBe("Alice");
			expect(first.querySelector(".lh-date")?.textContent).toBeTruthy();
		});

		/** The full hash is what one copies, even though the short one is shown. */
		it("offers the full hash to copy, not the short one", async () => {
			mount();
			await settle();
			expect(
				entries()[0].querySelector(".copy-btn, button[aria-label]"),
			).not.toBeNull();
		});

		it("shows no date for a commit without a timestamp", async () => {
			gitLineHistory.mockResolvedValue([entry("aaa", { timestamp: 0 })]);
			mount();
			await settle();
			expect(entries()[0].querySelector(".lh-date")?.textContent).toBe("");
		});

		it("names the line the panel is about", () => {
			mount({ relPath: "src/deep/file.ts", line: 7 });
			expect(document.querySelector(".lh-loc")?.textContent).toBe(
				"src/deep/file.ts:7",
			);
		});
	});

	describe("the changed lines of a commit", () => {
		const withChanges = (n: number) =>
			entry("aaa", {
				changes: Array.from({ length: n }, (_, i) => ({
					type: i % 2 === 0 ? "+" : "-",
					content: `line ${i}`,
				})) as LineHistoryEntry["changes"],
			});

		it("shows the lines a commit added and removed", async () => {
			gitLineHistory.mockResolvedValue([withChanges(2)]);
			mount();
			await settle();
			expect(changes()).toHaveLength(2);
			expect(changes()[0].className).toContain("lh-change-add");
			expect(changes()[1].className).toContain("lh-change-del");
		});

		it("shows the content of each changed line", async () => {
			gitLineHistory.mockResolvedValue([withChanges(1)]);
			mount();
			await settle();
			expect(changes()[0].querySelector(".lh-code")?.textContent).toBe(
				"line 0",
			);
		});

		/**
		 * A commit that rewrote a whole block drags its entire hunk in; only the
		 * lines around the tracked one are worth showing, and the rest is counted.
		 */
		it("caps a very large hunk and counts what it left out", async () => {
			gitLineHistory.mockResolvedValue([withChanges(MAX_CHANGES + 8)]);
			mount();
			await settle();
			expect(changes()).toHaveLength(MAX_CHANGES);
			expect(more()).toMatch(/8/);
		});

		it("shows no count when nothing was left out", async () => {
			gitLineHistory.mockResolvedValue([withChanges(MAX_CHANGES)]);
			mount();
			await settle();
			expect(changes()).toHaveLength(MAX_CHANGES);
			expect(more()).toBeUndefined();
		});

		it("shows no change block for a commit with none", async () => {
			gitLineHistory.mockResolvedValue([entry("aaa", { changes: [] })]);
			mount();
			await settle();
			expect(changes()).toHaveLength(0);
		});
	});

	describe("closing", () => {
		it("closes on request", async () => {
			const { onClose } = mount();
			await settle();
			await userEvent.click(document.querySelector(".lh-close") as HTMLElement);
			expect(onClose).toHaveBeenCalled();
		});

		/** The panel floats over the editor, so a click away from it dismisses it. */
		it("closes on a click outside", async () => {
			const { onClose } = mount();
			await settle();
			await userEvent.click(document.body);
			expect(onClose).toHaveBeenCalled();
		});

		it("stays open on a click inside", async () => {
			const { onClose } = mount();
			await settle();
			await userEvent.click(document.querySelector(".lh-title") as HTMLElement);
			expect(onClose).not.toHaveBeenCalled();
		});
	});
});
