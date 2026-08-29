import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GitDiffHunk } from "$lib/services/git-service";

const highlightLineToHtml = vi.fn();
vi.mock("$lib/utils/git/diff-syntax-highlight", () => ({
	highlightLineToHtml: (...a: unknown[]) => highlightLineToHtml(...a),
}));

const { default: GitDiff } = await import("$lib/components/git/GitDiff.svelte");

const PAGE = 300;

function hunk(
	header: string,
	lines: { kind: "add" | "remove" | "context"; content: string }[],
): GitDiffHunk {
	return { header, lines } as GitDiffHunk;
}

/** A hunk of n context lines, starting at the given old/new line. */
function bigHunk(n: number, start = 1): GitDiffHunk {
	return hunk(
		`@@ -${start},${n} +${start},${n} @@`,
		Array.from({ length: n }, (_, i) => ({
			kind: "context" as const,
			content: `line ${i}`,
		})),
	);
}

const rows = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".diff-row"));
const separators = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".diff-sep"));
const gutters = (row: HTMLElement) =>
	Array.from(row.querySelectorAll(".gutter")).map((g) => g.textContent);
const signOf = (row: HTMLElement) => row.querySelector(".sign")?.textContent;
const contentOf = (row: HTMLElement) =>
	row.querySelector(".content")?.innerHTML;
const moreButton = () =>
	document.querySelector(".diff-more") as HTMLElement | null;

beforeEach(() => {
	highlightLineToHtml.mockReset();
	// Never resolves by default: the fallback is what most tests read.
	highlightLineToHtml.mockReturnValue(new Promise(() => {}));
});

describe("GitDiff", () => {
	describe("the rows", () => {
		it("shows one row per line of the hunk", () => {
			render(GitDiff, {
				hunks: [
					hunk("@@ -1,3 +1,3 @@", [
						{ kind: "context", content: "a" },
						{ kind: "remove", content: "b" },
						{ kind: "add", content: "c" },
					]),
				],
			});
			expect(rows()).toHaveLength(3);
		});

		it("marks added and removed lines with their sign", () => {
			render(GitDiff, {
				hunks: [
					hunk("@@ -1,2 +1,2 @@", [
						{ kind: "add", content: "new" },
						{ kind: "remove", content: "old" },
						{ kind: "context", content: "same" },
					]),
				],
			});
			expect(rows().map(signOf)).toEqual(["+", "-", ""]);
			expect(rows()[0].className).toContain("diff-add");
			expect(rows()[1].className).toContain("diff-remove");
		});

		/**
		 * The two sides count separately: an added line advances only the new
		 * side, a removed one only the old, and a context line both.
		 */
		it("walks each side's line numbers on its own", () => {
			render(GitDiff, {
				hunks: [
					hunk("@@ -10,3 +20,3 @@", [
						{ kind: "context", content: "a" },
						{ kind: "remove", content: "b" },
						{ kind: "add", content: "c" },
						{ kind: "context", content: "d" },
					]),
				],
			});
			expect(rows().map(gutters)).toEqual([
				["10", "20"],
				["11", ""],
				["", "21"],
				["12", "22"],
			]);
		});

		it("starts from the line numbers the header declares", () => {
			render(GitDiff, {
				hunks: [hunk("@@ -42,1 +99,1 @@", [{ kind: "context", content: "a" }])],
			});
			expect(gutters(rows()[0])).toEqual(["42", "99"]);
		});

		/** A header that does not parse falls back to line one rather than NaN. */
		it("falls back to the first line for a header it cannot read", () => {
			render(GitDiff, {
				hunks: [hunk("not a header", [{ kind: "context", content: "a" }])],
			});
			expect(gutters(rows()[0])).toEqual(["1", "1"]);
		});

		it("separates one hunk from the next, but not before the first", () => {
			render(GitDiff, {
				hunks: [
					hunk("@@ -1,1 +1,1 @@", [{ kind: "context", content: "a" }]),
					hunk("@@ -9,1 +9,1 @@", [{ kind: "context", content: "b" }]),
				],
			});
			expect(separators()).toHaveLength(1);
			expect(separators()[0].textContent).toContain("@@ -9");
		});

		it("shows nothing for an empty diff", () => {
			render(GitDiff, { hunks: [] });
			expect(rows()).toHaveLength(0);
			expect(moreButton()).toBeNull();
		});
	});

	describe("very large diffs", () => {
		/**
		 * A 20k-line diff shows one page: building the rest only to slice it away
		 * costs megabytes per expanded file.
		 */
		it("shows only the first page of a huge diff", () => {
			render(GitDiff, { hunks: [bigHunk(2000)] });
			expect(rows()).toHaveLength(PAGE);
			expect(moreButton()).not.toBeNull();
		});

		/**
		 * The limit is checked between hunks as well as within one: with a page
		 * already full, the hunks that follow are not walked at all. A one-hunk
		 * diff cannot tell that apart from the inner check.
		 */
		it("stops before the hunks that follow a full page", () => {
			render(GitDiff, {
				hunks: [bigHunk(PAGE, 1), bigHunk(PAGE, 1000), bigHunk(PAGE, 2000)],
			});
			expect(rows()).toHaveLength(PAGE);
			expect(separators()).toHaveLength(0);
		});

		it("counts what it left out", () => {
			render(GitDiff, { hunks: [bigHunk(PAGE + 42)] });
			expect(moreButton()?.textContent).toMatch(/42/);
		});

		it("shows the next page on request", async () => {
			render(GitDiff, { hunks: [bigHunk(PAGE * 3)] });
			await userEvent.click(moreButton() as HTMLElement);
			expect(rows()).toHaveLength(PAGE * 2);
		});

		it("offers nothing more once everything is shown", () => {
			render(GitDiff, { hunks: [bigHunk(10)] });
			expect(rows()).toHaveLength(10);
			expect(moreButton()).toBeNull();
		});

		/** Opening a different file starts again from the first page. */
		it("goes back to the first page when the diff changes", async () => {
			const { rerender } = render(GitDiff, {
				hunks: [bigHunk(PAGE * 3)],
				filePath: "a.ts",
			});
			await userEvent.click(moreButton() as HTMLElement);
			expect(rows()).toHaveLength(PAGE * 2);

			await rerender({ hunks: [bigHunk(PAGE * 3, 500)], filePath: "b.ts" });
			expect(rows()).toHaveLength(PAGE);
		});

		/** The same diff redelivered is not a new one, so the page is kept. */
		it("keeps the page when the same diff is redelivered", async () => {
			const hunks = [bigHunk(PAGE * 3)];
			const { rerender } = render(GitDiff, { hunks, filePath: "a.ts" });
			await userEvent.click(moreButton() as HTMLElement);
			await rerender({ hunks: [bigHunk(PAGE * 3)], filePath: "a.ts" });
			expect(rows()).toHaveLength(PAGE * 2);
		});
	});

	describe("syntax highlighting", () => {
		it("escapes the line until its highlight lands", () => {
			render(GitDiff, {
				hunks: [
					hunk("@@ -1,1 +1,1 @@", [{ kind: "context", content: "<script>&" }]),
				],
			});
			expect(contentOf(rows()[0])).toBe("&lt;script&gt;&amp;");
		});

		it("asks for the highlight in the language of the file", () => {
			render(GitDiff, {
				hunks: [
					hunk("@@ -1,1 +1,1 @@", [{ kind: "context", content: "const x" }]),
				],
				filePath: "src/a.ts",
			});
			expect(highlightLineToHtml).toHaveBeenCalledWith(
				"const x",
				"ts",
				expect.anything(),
			);
		});

		/**
		 * The highlight arrives after the row was drawn. `highlightedLine` takes a
		 * tick it never reads, so bumping it re-evaluates every call in the each
		 * block - without it the highlighted line would never replace the escaped
		 * one. This is the deliberate answer to Svelte not tracking what a
		 * function body reads.
		 */
		it("replaces the escaped line once the highlight lands", async () => {
			let land: (html: string) => void = () => {};
			highlightLineToHtml.mockReturnValue(
				new Promise<string>((resolve) => {
					land = resolve;
				}),
			);
			render(GitDiff, {
				hunks: [
					hunk("@@ -1,1 +1,1 @@", [{ kind: "context", content: "const x" }]),
				],
				filePath: "a.ts",
			});
			expect(contentOf(rows()[0])).toBe("const x");

			land('<span class="tok">const</span> x');
			await tick();
			await tick();
			expect(contentOf(rows()[0])).toContain("tok");
		});

		/** One highlight per distinct line: the cache spares the repeats. */
		it("highlights a repeated line only once", () => {
			render(GitDiff, {
				hunks: [
					hunk("@@ -1,3 +1,3 @@", [
						{ kind: "context", content: "same" },
						{ kind: "context", content: "same" },
						{ kind: "context", content: "other" },
					]),
				],
				filePath: "a.ts",
			});
			expect(highlightLineToHtml).toHaveBeenCalledTimes(2);
		});

		/** An empty line has nothing to highlight. */
		it("asks for no highlight on a blank line", () => {
			render(GitDiff, {
				hunks: [hunk("@@ -1,1 +1,1 @@", [{ kind: "context", content: "" }])],
			});
			expect(highlightLineToHtml).not.toHaveBeenCalled();
		});
	});
});
