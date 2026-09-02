// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { writable } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeStep } from "$lib/stores/ui";
import type { ReviewHunk, ReviewState } from "$lib/types/review";
import { emptyReviewState } from "$lib/types/review";

vi.mock("$lib/components/review/DiffEditor.svelte", async () => ({
	default: (await import("./stubs/DiffEditorStub.svelte")).default,
}));

const getDiffFileBetween = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/services/git-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	getDiffFileBetween: (...a: unknown[]) => getDiffFileBetween(...a),
}));

const setCurrentPosition = vi.fn<(...a: unknown[]) => unknown>();
const dismissRemark = vi.fn<(...a: unknown[]) => unknown>();
const markChapterSeen = vi.fn<(...a: unknown[]) => unknown>();
const draftCommentFor = vi.fn<(...a: unknown[]) => unknown>();
const cancelCommentDraft = vi.fn<(...a: unknown[]) => unknown>();
const guideGenerating = writable<Record<string, string>>({});
const reviewErrors = writable<Record<string, string>>({});
vi.mock("$lib/stores/review", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	guideGenerating: { subscribe: guideGenerating.subscribe },
	reviewErrors: { subscribe: reviewErrors.subscribe },
	setCurrentPosition: (...a: unknown[]) => setCurrentPosition(...a),
	dismissRemark: (...a: unknown[]) => dismissRemark(...a),
	markChapterSeen: (...a: unknown[]) => markChapterSeen(...a),
	generateGuide: vi.fn().mockResolvedValue(undefined),
	cancelGuide: vi.fn().mockResolvedValue(undefined),
	draftCommentFor: (...a: unknown[]) => draftCommentFor(...a),
	cancelCommentDraft: (...a: unknown[]) => cancelCommentDraft(...a),
	addComment: vi.fn(),
	editComment: vi.fn(),
	deleteComment: vi.fn(),
}));

const { default: ReviewGuide } = await import(
	"$lib/components/review/ReviewGuide.svelte"
);

const scope = { projectId: "p1", instanceId: "i1", worktreePath: "/wt" };

const HUNKS: ReviewHunk[] = [
	{
		path: "src/a.ts",
		oldStart: 1,
		oldLines: 4,
		newStart: 1,
		newLines: 5,
		hunkHash: "h1",
	},
	{
		path: "src/b.ts",
		oldStart: 1,
		oldLines: 2,
		newStart: 1,
		newLines: 3,
		hunkHash: "h2",
	},
];

function remark(
	id: string,
	kind: "issue" | "question" | "refactor" | "note",
	line = 2,
) {
	return {
		id,
		kind,
		path: "src/a.ts",
		side: "new" as const,
		line,
		title: `${kind} title`,
		body: `${kind} body with \`code\``,
		status: "open" as const,
	};
}

function guideState(overrides: Partial<ReviewState> = {}): ReviewState {
	return {
		...emptyReviewState(),
		guide: {
			headSha: "head1",
			baseSha: "base1",
			generatedAt: "2026-08-30T10:00:00Z",
			overview:
				"Adds `GET /users/search`, returning a **paginated** list.\n\n- one\n- two",
			chapters: [
				{
					id: "c1",
					title: "The search endpoint",
					summary: "It adds the `search` route.",
					excerpts: [
						{
							path: "src/a.ts",
							side: "new",
							from: 1,
							to: 4,
							hunkHash: "h1",
						},
					],
					remarks: [
						remark("c1r1", "issue"),
						remark("c1r2", "question", 3),
						remark("c1r3", "note", 4),
					],
					isSeen: false,
				},
				{
					id: "c2",
					title: "The response DTO",
					summary: "It shapes the answer.",
					excerpts: [
						{
							path: "src/b.ts",
							side: "new",
							from: 1,
							to: 2,
							hunkHash: "h2",
						},
					],
					remarks: [],
					isSeen: false,
				},
			],
		},
		...overrides,
	};
}

/** The same guide with every chapter marked as read. */
function allSeen(overrides: Partial<ReviewState> = {}): ReviewState {
	const base = guideState(overrides);
	const guide = base.guide;
	if (!guide) throw new Error("the fixture must carry a guide");
	return {
		...base,
		seenHunks: ["h1", "h2"],
		guide: {
			...guide,
			chapters: guide.chapters.map((c) => ({ ...c, isSeen: true })),
		},
	};
}

/** Records the `openInDiff` requests the guide made during a test. */
let openedInDiff: unknown[] = [];

/** Teardown a single test registered, run after it whatever the outcome. */
const afterEachRestore: (() => void)[] = [];
afterEach(() => {
	while (afterEachRestore.length) afterEachRestore.pop()?.();
});

function mount(
	state: ReviewState = guideState(),
	extra: Record<string, unknown> = {},
) {
	return render(ReviewGuide, {
		props: {
			scope,
			base: "main",
			head: "head1",
			state,
			hunks: HUNKS,
			...extra,
		},
		events: {
			openInDiff: (e: CustomEvent) => openedInDiff.push(e.detail),
		},
	});
}

async function settle() {
	await tick();
	await tick();
	await tick();
}

const opening = () => document.querySelector(".opening");
const remarkCards = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".remark"));
const kindTab = (re: RegExp) =>
	Array.from(document.querySelectorAll<HTMLButtonElement>(".kind-filter")).find(
		(b) => re.test(b.textContent ?? ""),
	) as HTMLButtonElement;

beforeEach(() => {
	activeStep.set("review");
	vi.clearAllMocks();
	guideGenerating.set({});
	openedInDiff = [];
	draftCommentFor.mockReset().mockResolvedValue("a drafted comment");
	cancelCommentDraft.mockReset().mockResolvedValue(undefined);
	reviewErrors.set({});
	getDiffFileBetween.mockResolvedValue({
		oldContent: "one\ntwo\nthree\nfour",
		newContent: "one\ntwo\nthree\nfour\nfive",
	});
});

describe("ReviewGuide", () => {
	/**
	 * The regression: generation read `base...head` through git without honouring
	 * the check the diff already made, so asking for a guide on a worktree that
	 * is missing one end failed with git's own "ambiguous argument".
	 */
	describe("a revision the worktree does not have", () => {
		it("generates no guide", async () => {
			const { generateGuide } = await import("$lib/stores/review");
			mount({ ...guideState(), guide: null }, { isHeadMissing: true });
			await settle();
			const button = Array.from(
				document.querySelectorAll<HTMLButtonElement>("button"),
			).find((b) => b.classList.contains("primary")) as HTMLButtonElement;
			expect(button.disabled).toBe(true);
			button.click();
			await settle();
			expect(generateGuide).not.toHaveBeenCalled();
		});
	});

	describe("the opening page", () => {
		/** The branch has to be explained before its code means anything. */
		it("opens on the overview rather than the first extract", async () => {
			mount();
			await settle();
			expect(opening()).not.toBeNull();
			expect(opening()?.textContent).toContain("GET /users/search");
		});

		it("says how much there is to read", async () => {
			mount();
			await settle();
			const text = opening()?.textContent ?? "";
			expect(text).toContain("2");
			expect(text).toMatch(/chapters|chapitres/i);
			expect(text).toMatch(/remarks|remarques/i);
		});

		it("enters the first chapter when the reading starts", async () => {
			mount();
			await settle();
			const start = Array.from(
				document.querySelectorAll<HTMLButtonElement>(".opening button"),
			)[0];
			await userEvent.click(start);
			expect(setCurrentPosition).toHaveBeenCalledWith(scope, "c1", 0);
		});

		it("shows the chapter once one is current", async () => {
			mount(guideState({ currentChapterId: "c1" }));
			await settle();
			expect(opening()).toBeNull();
			expect(document.body.textContent).toContain("The search endpoint");
		});

		it("offers a way back to the overview", async () => {
			mount(guideState({ currentChapterId: "c1" }));
			await settle();
			const back = document.querySelector(
				".overview-link",
			) as HTMLButtonElement;
			expect(back).not.toBeNull();
			await userEvent.click(back);
			expect(setCurrentPosition).toHaveBeenCalledWith(scope, "", 0);
		});
	});

	describe("the chapter header", () => {
		it("says which chapter of how many", async () => {
			mount(guideState({ currentChapterId: "c2" }));
			await settle();
			expect(document.querySelector(".chapter-step")?.textContent).toMatch(
				/2.*2/s,
			);
		});

		it("shows the reading progress beside the code", async () => {
			mount(guideState({ currentChapterId: "c1", seenHunks: ["h1"] }));
			await settle();
			const bar = document.querySelector(".chapter-progress .fill");
			expect(bar).not.toBeNull();
			expect((bar as HTMLElement).style.width).toBe("50%");
		});
	});

	describe("the remarks", () => {
		it("lists the remarks of the current extract", async () => {
			mount(guideState({ currentChapterId: "c1" }));
			await settle();
			expect(remarkCards()).toHaveLength(3);
		});

		it("filters them by kind", async () => {
			mount(guideState({ currentChapterId: "c1" }));
			await settle();
			await userEvent.click(kindTab(/issue|problème/i));
			await settle();
			expect(remarkCards()).toHaveLength(1);
		});

		/** The counts describe the extract, not the filtered view. */
		it("counts every kind against the whole extract", async () => {
			mount(guideState({ currentChapterId: "c1" }));
			await settle();
			await userEvent.click(kindTab(/issue|problème/i));
			await settle();
			expect(kindTab(/all|toutes/i).textContent).toContain("3");
		});

		it("offers no tab for a kind the extract does not have", async () => {
			mount(guideState({ currentChapterId: "c1" }));
			await settle();
			expect(kindTab(/refactor|simplification/i)).toBeUndefined();
		});

		it("shows no remarks at all on the opening page", async () => {
			mount();
			await settle();
			expect(remarkCards()).toHaveLength(0);
		});
	});

	describe("keyboard actions", () => {
		it("enters the reading from the overview", async () => {
			const { component } = mount();
			await settle();
			component.executeAction("reviewNextExcerpt");
			expect(setCurrentPosition).toHaveBeenCalledWith(scope, "c1", 0);
		});

		it("does not act on a chapter the reader cannot see", async () => {
			const { component } = mount();
			await settle();
			component.executeAction("reviewMarkSeen");
			expect(markChapterSeen).not.toHaveBeenCalled();
		});

		it("walks back to the overview off the first extract", async () => {
			const { component } = mount(guideState({ currentChapterId: "c1" }));
			await settle();
			component.executeAction("reviewPrevExcerpt");
			expect(setCurrentPosition).toHaveBeenCalledWith(scope, "", 0);
		});

		it("dismisses the first remark of the extract", async () => {
			const { component } = mount(guideState({ currentChapterId: "c1" }));
			await settle();
			component.executeAction("reviewDismiss");
			expect(dismissRemark).toHaveBeenCalledWith(scope, "c1r1");
		});
	});

	describe("the text the model wrote", () => {
		/**
		 * The model is asked for markdown and writes it: a path in backticks has
		 * to read as code, not as a line with stray backticks in it.
		 */
		it("renders the overview as markdown", async () => {
			mount();
			await settle();
			const code = opening()?.querySelectorAll("code") ?? [];
			expect(code.length).toBeGreaterThan(0);
			expect(code[0].textContent).toBe("GET /users/search");
			expect(opening()?.querySelector("strong")?.textContent).toBe("paginated");
			expect(opening()?.querySelectorAll("li")).toHaveLength(2);
			expect(opening()?.textContent).not.toContain("`");
		});

		it("renders a chapter summary as markdown", async () => {
			mount(guideState({ currentChapterId: "c1" }));
			await settle();
			expect(document.querySelector(".summary code")?.textContent).toBe(
				"search",
			);
		});

		it("renders a remark body as markdown", async () => {
			mount(guideState({ currentChapterId: "c1" }));
			await settle();
			expect(
				remarkCards()[0].querySelector(".remark-body code")?.textContent,
			).toBe("code");
		});

		/** The text comes from a model, so it goes through the sanitiser. */
		it("strips anything dangerous the text may carry", async () => {
			mount(
				guideState({
					currentChapterId: "c1",
					guide: {
						...(guideState().guide as NonNullable<ReviewState["guide"]>),
						chapters: [
							{
								...(guideState().guide as NonNullable<ReviewState["guide"]>)
									.chapters[0],
								summary:
									'<img src=x onerror="alert(1)"> and <script>bad()</script>',
							},
						],
					},
				}),
			);
			await settle();
			const summary = document.querySelector(".summary");
			expect(summary?.querySelector("script")).toBeNull();
			expect(summary?.querySelector("img")?.getAttribute("onerror")).toBeNull();
		});
	});

	describe("the link between a remark and its line", () => {
		const markers = () =>
			Array.from(document.querySelectorAll<HTMLElement>(".stub-marker"));
		const focused = () => document.querySelector(".remark.focused");

		it("marks every remark of the extract in the gutter", async () => {
			mount(guideState({ currentChapterId: "c1" }));
			await settle();
			expect(markers()).toHaveLength(3);
		});

		/** The filter narrows the list, not the annotations on the code. */
		it("keeps the markers of a kind the filter hides", async () => {
			mount(guideState({ currentChapterId: "c1" }));
			await settle();
			await userEvent.click(kindTab(/issue|problème/i));
			await settle();
			expect(remarkCards()).toHaveLength(1);
			expect(markers()).toHaveLength(3);
		});

		it("brings a remark forward when its marker is clicked", async () => {
			mount(guideState({ currentChapterId: "c1" }));
			await settle();
			expect(focused()).toBeNull();
			const marker = markers().find((m) => m.dataset.line === "3");
			await userEvent.click(marker as HTMLElement);
			await settle();
			expect(focused()?.textContent).toContain("question title");
		});

		/** A marker for a hidden remark has to reveal it, not select nothing. */
		it("clears the filter to reveal the remark a marker points at", async () => {
			mount(guideState({ currentChapterId: "c1" }));
			await settle();
			await userEvent.click(kindTab(/issue|problème/i));
			await settle();
			const marker = markers().find((m) => m.dataset.line === "4");
			await userEvent.click(marker as HTMLElement);
			await settle();
			expect(focused()?.textContent).toContain("note title");
		});

		it("marks the card the reader picked", async () => {
			mount(guideState({ currentChapterId: "c1" }));
			await settle();
			await userEvent.click(remarkCards()[1]);
			await settle();
			expect(focused()?.textContent).toContain("question title");
		});

		it("leaves the card actions working on their own", async () => {
			mount(guideState({ currentChapterId: "c1" }));
			await settle();
			const dismiss = remarkCards()[0].querySelector(
				"button",
			) as HTMLButtonElement;
			await userEvent.click(dismiss);
			expect(dismissRemark).toHaveBeenCalledWith(scope, "c1r1");
		});
	});

	describe("the sidebar", () => {
		/** Nothing is being read yet, so no chapter is the current one. */
		it("highlights no chapter while the overview is open", async () => {
			mount();
			await settle();
			expect(
				document.querySelector(".chapter.active:not(.overview-link)"),
			).toBeNull();
			expect(document.querySelector(".overview-link.active")).not.toBeNull();
		});

		it("highlights the chapter being read", async () => {
			mount(guideState({ currentChapterId: "c2" }));
			await settle();
			const active = document.querySelector(
				".chapter.active:not(.overview-link)",
			);
			expect(active?.textContent).toContain("The response DTO");
		});
	});

	describe("submitting the review", () => {
		const sidebarSubmit = () =>
			document.querySelector(".submit-review") as HTMLButtonElement | null;
		const panelSubmit = () =>
			document.querySelector(".comments-foot .btn") as HTMLButtonElement | null;

		it("offers the same action in the sidebar as in the panel", async () => {
			mount(allSeen({ currentChapterId: "c1" }));
			await settle();
			expect(sidebarSubmit()?.textContent?.trim()).toBe(
				panelSubmit()?.textContent?.trim(),
			);
			expect(sidebarSubmit()?.className).toContain("primary");
		});

		/** Submitting halfway sends an opinion on code nobody looked at. */
		it("refuses until every chapter has been read", async () => {
			mount(guideState({ currentChapterId: "c1" }));
			await settle();
			expect(sidebarSubmit()?.disabled).toBe(true);
			expect(panelSubmit()?.disabled).toBe(true);
		});

		it("says how far off the reading is", async () => {
			mount(guideState({ currentChapterId: "c1" }));
			await settle();
			expect(sidebarSubmit()?.title).toMatch(/0.*2|2/);
		});

		it("allows it once the guide has been read through", async () => {
			mount(allSeen({ currentChapterId: "c1" }));
			await settle();
			expect(sidebarSubmit()?.disabled).toBe(false);
			expect(panelSubmit()?.disabled).toBe(false);
			expect(sidebarSubmit()?.title).toBe("");
		});

		it("opens the summary from the sidebar", async () => {
			mount(allSeen({ currentChapterId: "c1" }));
			await settle();
			await userEvent.click(sidebarSubmit() as HTMLButtonElement);
			await settle();
			expect(document.querySelector(".summary-modal")).not.toBeNull();
		});
	});

	describe("drafting a comment with the AI", () => {
		/** Opens the composer on the first remark of the extract. */
		async function openComposer() {
			mount(guideState({ currentChapterId: "c1" }));
			await settle();
			const comment = Array.from(
				remarkCards()[0].querySelectorAll<HTMLButtonElement>("button"),
			).find((b) => /comment|commenter/i.test(b.textContent ?? ""));
			await userEvent.click(comment as HTMLButtonElement);
			await settle();
		}

		const draftButton = () =>
			document.querySelector(".composer .ai-btn") as HTMLButtonElement | null;

		it("wears the same pending treatment as the other AI assists", async () => {
			await openComposer();
			expect(document.querySelector(".composer .ai-field")).not.toBeNull();
			expect(draftButton()?.className).toContain("ai-btn");
		});

		it("marks the field as working while the model answers", async () => {
			let release: (v: string) => void = () => {};
			draftCommentFor.mockImplementation(
				() => new Promise<string>((r) => (release = r)),
			);
			await openComposer();
			await userEvent.click(draftButton() as HTMLButtonElement);
			await settle();

			const field = document.querySelector(".composer .ai-field");
			if (!field) throw new Error("the composer should have an AI field");
			expect(field.className).toContain("is-generating");
			expect(field.querySelector(".ai-sweep")).not.toBeNull();
			expect(
				(field.querySelector("textarea") as HTMLTextAreaElement).disabled,
			).toBe(true);

			release("done");
			await settle();
			expect(
				document.querySelector(".composer .ai-field")?.className,
			).not.toContain("is-generating");
		});

		/** The assist has to be stoppable, like the merge request one. */
		it("turns the button into a way to stop the run", async () => {
			draftCommentFor.mockImplementation(() => new Promise<string>(() => {}));
			await openComposer();
			await userEvent.click(draftButton() as HTMLButtonElement);
			await settle();
			expect(draftButton()?.textContent).toMatch(/cancel|annuler/i);
			await userEvent.click(draftButton() as HTMLButtonElement);
			expect(cancelCommentDraft).toHaveBeenCalledWith(scope);
		});

		it("drops what the model wrote into the box", async () => {
			await openComposer();
			await userEvent.click(draftButton() as HTMLButtonElement);
			await settle();
			const box = document.querySelector(
				".composer textarea",
			) as HTMLTextAreaElement;
			expect(box.value).toBe("a drafted comment");
		});
	});

	describe("keeping the reader with the comment", () => {
		const composer = () => document.querySelector("#guide-composer");
		const commentCards = () =>
			Array.from(document.querySelectorAll<HTMLElement>(".comment"));

		function withComment(path: string, line: number, remarkId?: string) {
			return allSeen({
				currentChapterId: "c1",
				comments: [
					{
						id: "cm1",
						path,
						side: "new" as const,
						line,
						body: "please rename this",
						createdAt: "2026-08-30T10:00:00Z",
						...(remarkId ? { remarkId } : {}),
					},
				],
			});
		}

		/** The composer opens in a column the reader may have scrolled away from. */
		it("brings the composer into view when one is opened", async () => {
			// jsdom has no scrollIntoView; the spy is restored below so it does
			// not leak into the rest of the suite.
			const original = Element.prototype.scrollIntoView;
			const into = vi.fn();
			Element.prototype.scrollIntoView = into;
			afterEachRestore.push(() => {
				Element.prototype.scrollIntoView = original;
			});
			mount(guideState({ currentChapterId: "c1" }));
			await settle();
			const comment = Array.from(
				remarkCards()[0].querySelectorAll<HTMLButtonElement>("button"),
			).find((b) => /comment|commenter/i.test(b.textContent ?? ""));
			await userEvent.click(comment as HTMLButtonElement);
			await settle();
			await new Promise((r) => requestAnimationFrame(() => r(null)));
			expect(composer()).not.toBeNull();
			expect(into).toHaveBeenCalled();
		});

		it("marks the remark the composer was opened from", async () => {
			mount(guideState({ currentChapterId: "c1" }));
			await settle();
			const comment = Array.from(
				remarkCards()[0].querySelectorAll<HTMLButtonElement>("button"),
			).find((b) => /comment|commenter/i.test(b.textContent ?? ""));
			await userEvent.click(comment as HTMLButtonElement);
			await settle();
			expect(document.querySelector(".remark.focused")?.textContent).toContain(
				"issue title",
			);
		});

		it("moves to the chapter a comment belongs to", async () => {
			// The comment sits on the second chapter's extract.
			mount(withComment("src/b.ts", 2));
			await settle();
			await userEvent.click(commentCards()[0]);
			await settle();
			expect(setCurrentPosition).toHaveBeenCalledWith(scope, "c2", 0);
		});

		/** A comment outside every extract can only be shown in the raw diff. */
		it("falls back to the diff for a line no chapter covers", async () => {
			mount(withComment("src/elsewhere.ts", 9));
			await settle();
			await userEvent.click(commentCards()[0]);
			await settle();
			expect(openedInDiff).toContainEqual({
				path: "src/elsewhere.ts",
				line: 9,
				side: "new",
			});
		});

		it("brings forward the remark a comment came from", async () => {
			mount(withComment("src/a.ts", 2, "c1r1"));
			await settle();
			await userEvent.click(commentCards()[0]);
			await settle();
			expect(document.querySelector(".remark.focused")?.textContent).toContain(
				"issue title",
			);
		});

		it("leaves the card actions working on their own", async () => {
			mount(withComment("src/b.ts", 2));
			await settle();
			const del = Array.from(
				commentCards()[0].querySelectorAll<HTMLButtonElement>("button"),
			).find((b) => /delete|supprimer/i.test(b.textContent ?? ""));
			await userEvent.click(del as HTMLButtonElement);
			expect(setCurrentPosition).not.toHaveBeenCalled();
		});
	});
});
