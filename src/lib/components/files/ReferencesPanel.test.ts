// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { LspLocation } from "$lib/services/lsp-service";
import ReferencesPanel, {
	type ReferencesResult,
} from "./ReferencesPanel.svelte";

function location(
	path: string,
	line: number,
	overrides: Partial<LspLocation> = {},
): LspLocation {
	return {
		path,
		line,
		character: 6,
		endLine: line,
		endCharacter: 11,
		text: "const value = 1;",
		...overrides,
	};
}

function result(overrides: Partial<ReferencesResult> = {}): ReferencesResult {
	return {
		symbol: "value",
		definitions: [],
		implementations: [],
		references: [],
		...overrides,
	};
}

function mount(props: Record<string, unknown> = {}) {
	const onOpen = vi.fn();
	const onClose = vi.fn();
	const rendered = render(ReferencesPanel, {
		hidden: false,
		loading: false,
		error: "",
		result: null,
		worktreePath: "/repo",
		onOpen,
		onClose,
		...props,
	});
	return { ...rendered, onOpen, onClose };
}

const sections = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".refs-section"));
const sectionTitles = () =>
	sections().map((s) =>
		s.querySelector(".refs-section-title")?.textContent?.trim(),
	);
const sectionCounts = () =>
	sections().map((s) => s.querySelector(".refs-section-count")?.textContent);
const files = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".refs-file"));
const fileNames = () =>
	files().map((f) => f.querySelector(".refs-filename")?.textContent);
const hits = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".refs-hit"));
const lineNumbers = () =>
	hits().map((h) => h.querySelector(".refs-lineno")?.textContent);
const code = () => document.querySelector(".refs-code");
const note = () => document.querySelector(".refs-note")?.textContent;

describe("ReferencesPanel", () => {
	describe("what it shows", () => {
		it("names the symbol it is about", () => {
			mount({ result: result() });
			expect(document.querySelector(".refs-symbol")?.textContent).toBe("value");
		});

		it("shows a placeholder while it loads, not a word", () => {
			mount({ loading: true });
			expect(document.querySelector(".refs-skeleton")).not.toBeNull();
			expect(document.body.textContent?.toLowerCase()).not.toContain("loading");
		});

		it("reports a failed lookup", () => {
			mount({ error: "no language server" });
			expect(document.querySelector(".refs-note.error")?.textContent).toContain(
				"no language server",
			);
		});

		it("says so when the symbol has no result at all", () => {
			mount({ result: result() });
			expect(note()).toBeTruthy();
			expect(sections()).toHaveLength(0);
		});

		it("says nothing yet before a symbol has been looked up", () => {
			mount({ result: null });
			expect(hits()).toHaveLength(0);
		});

		it("closes on request", async () => {
			const { onClose } = mount();
			await userEvent.click(
				document.querySelector(".refs-icon-btn") as HTMLElement,
			);
			expect(onClose).toHaveBeenCalled();
		});
	});

	describe("the three kinds of result", () => {
		const full = result({
			definitions: [location("/repo/src/a.ts", 0)],
			implementations: [location("/repo/src/b.ts", 1)],
			references: [
				location("/repo/src/c.ts", 2),
				location("/repo/src/c.ts", 5),
			],
		});

		it("shows definitions, implementations and usages, in that order", () => {
			mount({ result: full });
			expect(sections()).toHaveLength(3);
			expect(sectionTitles()[0]?.toLowerCase()).toMatch(/defin|défin/);
		});

		it("counts each kind", () => {
			mount({ result: full });
			expect(sectionCounts()).toEqual(["1", "1", "2"]);
		});

		/** A kind with no result is not shown as an empty heading. */
		it("shows only the kinds that have something", () => {
			mount({
				result: result({ references: [location("/repo/a.ts", 0)] }),
			});
			expect(sections()).toHaveLength(1);
		});
	});

	describe("grouping by file", () => {
		it("groups the hits of one file together", () => {
			mount({
				result: result({
					references: [
						location("/repo/src/a.ts", 0),
						location("/repo/src/a.ts", 9),
						location("/repo/src/b.ts", 3),
					],
				}),
			});
			expect(fileNames()).toEqual(["a.ts", "b.ts"]);
			expect(files()[0].querySelector(".refs-count")?.textContent).toBe("2");
		});

		/** Paths are shown relative to the worktree, not as absolute ones. */
		it("shows each file relative to the worktree", () => {
			mount({
				result: result({ references: [location("/repo/src/lib/a.ts", 0)] }),
			});
			expect(files()[0].querySelector(".refs-dir")?.textContent).toBe(
				"src/lib",
			);
		});

		it("orders the hits of a file by line", () => {
			mount({
				result: result({
					references: [
						location("/repo/a.ts", 20),
						location("/repo/a.ts", 4),
						location("/repo/a.ts", 12),
					],
				}),
			});
			expect(lineNumbers()).toEqual(["5", "13", "21"]);
		});

		it("folds a file away and back", async () => {
			mount({
				result: result({
					references: [location("/repo/a.ts", 0), location("/repo/a.ts", 1)],
				}),
			});
			expect(hits()).toHaveLength(2);
			await userEvent.click(files()[0]);
			expect(hits()).toHaveLength(0);
			await userEvent.click(files()[0]);
			expect(hits()).toHaveLength(2);
		});

		/** Folding one file leaves the others open. */
		it("folds one file without folding the rest", async () => {
			mount({
				result: result({
					references: [location("/repo/a.ts", 0), location("/repo/b.ts", 0)],
				}),
			});
			await userEvent.click(files()[0]);
			expect(hits()).toHaveLength(1);
		});

		/** The same file in two sections folds independently. */
		it("keeps the same file folded per section", async () => {
			mount({
				result: result({
					definitions: [location("/repo/a.ts", 0)],
					references: [location("/repo/a.ts", 5)],
				}),
			});
			await userEvent.click(files()[0]);
			expect(hits()).toHaveLength(1);
		});
	});

	describe("opening a hit", () => {
		it("opens the file at the position, counted from one", async () => {
			const { onOpen } = mount({
				result: result({ references: [location("/repo/src/a.ts", 41)] }),
			});
			await userEvent.click(hits()[0]);
			expect(onOpen).toHaveBeenCalledWith("src/a.ts", 42, 7);
		});
	});

	describe("the excerpt of each hit", () => {
		const parts = () => [
			code()?.childNodes[0]?.textContent,
			code()?.querySelector("mark")?.textContent,
			code()?.childNodes[2]?.textContent,
		];

		it("marks the symbol inside its own line", () => {
			mount({
				result: result({
					references: [
						location("/repo/a.ts", 0, {
							text: "const value = 1;",
							character: 6,
							endCharacter: 11,
						}),
					],
				}),
			});
			expect(parts()).toEqual(["const ", "value", " = 1;"]);
		});

		/** The backend trimmed the line, so the columns move with it. */
		it("keeps the mark aligned once the indentation is trimmed", () => {
			mount({
				result: result({
					references: [
						location("/repo/a.ts", 0, {
							text: "      const value = 1;",
							character: 12,
							endCharacter: 17,
						}),
					],
				}),
			});
			expect(parts()).toEqual(["const ", "value", " = 1;"]);
		});

		/** A long line is cut around the symbol rather than shown whole. */
		it("elides a long line on both sides of the symbol", () => {
			const filler = "x".repeat(200);
			mount({
				result: result({
					references: [
						location("/repo/a.ts", 0, {
							text: `${filler} value ${filler}`,
							character: 201,
							endCharacter: 206,
						}),
					],
				}),
			});
			const [before, mark, after] = parts();
			expect(before).toContain("...");
			expect(after).toContain("...");
			expect(mark).toBe("value");
			expect((code()?.textContent ?? "").length).toBeLessThan(200);
		});

		/** A hit spanning several lines marks to the end of the first one. */
		it("marks to the end of the line for a multi-line hit", () => {
			mount({
				result: result({
					references: [
						location("/repo/a.ts", 0, {
							text: "const value = {",
							character: 6,
							endLine: 3,
							endCharacter: 1,
						}),
					],
				}),
			});
			expect(parts()[2]).toBe("");
			expect(parts()[1]).toBe("value = {");
		});

		/** Without the line's text there is nothing to excerpt, so the column shows. */
		it("falls back to the column when the line is unavailable", () => {
			mount({
				result: result({
					references: [location("/repo/a.ts", 0, { text: null })],
				}),
			});
			expect(code()).toBeNull();
			expect(document.querySelector(".refs-col")?.textContent).toBe(":7");
		});
	});

	describe("folding a whole section", () => {
		const many = result({
			references: [location("/repo/a.ts", 0), location("/repo/b.ts", 0)],
		});

		it("folds every file of the section at once", async () => {
			mount({ result: many });
			expect(hits()).toHaveLength(2);
			await userEvent.click(
				document.querySelector(".refs-fold-all") as HTMLElement,
			);
			expect(hits()).toHaveLength(0);
		});

		it("unfolds them all again", async () => {
			mount({ result: many });
			const foldAll = () =>
				document.querySelector(".refs-fold-all") as HTMLElement;
			await userEvent.click(foldAll());
			await userEvent.click(foldAll());
			expect(hits()).toHaveLength(2);
		});
	});
});
