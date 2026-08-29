import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GitChangedFile } from "$lib/services/git-service";
import type { InstanceMergeRequestState } from "$lib/stores/merge-request";
import type { Discussion, MergeRequest } from "$lib/types/integrations";

vi.mock("$lib/components/review/DiffEditor.svelte", async () => ({
	default: (await import("./stubs/DiffEditorStub.svelte")).default,
}));

const openUrl = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("@tauri-apps/plugin-opener", () => ({
	openUrl: (...a: unknown[]) => openUrl(...a),
}));

const commitExists = vi.fn<(...a: unknown[]) => unknown>();
const gitFetch = vi.fn<(...a: unknown[]) => unknown>();
const getDiffFileBetween = vi.fn<(...a: unknown[]) => unknown>();
const getDiffFilesBetween = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/services/git-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	commitExists: (...a: unknown[]) => commitExists(...a),
	fetch: (...a: unknown[]) => gitFetch(...a),
	getDiffFileBetween: (...a: unknown[]) => getDiffFileBetween(...a),
	getDiffFilesBetween: (...a: unknown[]) => getDiffFilesBetween(...a),
}));

const mrState = writable<Record<string, InstanceMergeRequestState>>({});
const loadMergeRequest = vi.fn<(...a: unknown[]) => unknown>();
const loadDiscussions = vi.fn<(...a: unknown[]) => unknown>();
const approveMergeRequest = vi.fn<(...a: unknown[]) => unknown>();
const replyToDiscussion = vi.fn<(...a: unknown[]) => unknown>();
const selectDiscussion = vi.fn<(...a: unknown[]) => unknown>();
const setDiscussionResolved = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/stores/merge-request", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	mergeRequests: { subscribe: mrState.subscribe },
	loadMergeRequest: (...a: unknown[]) => loadMergeRequest(...a),
	loadDiscussions: (...a: unknown[]) => loadDiscussions(...a),
	approveMergeRequest: (...a: unknown[]) => approveMergeRequest(...a),
	replyToDiscussion: (...a: unknown[]) => replyToDiscussion(...a),
	selectDiscussion: (...a: unknown[]) => selectDiscussion(...a),
	setDiscussionResolved: (...a: unknown[]) => setDiscussionResolved(...a),
}));

const hasForge = writable(true);
vi.mock("$lib/stores/integrations", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	hasForge: { subscribe: hasForge.subscribe },
}));

const reviewStates = writable<Record<string, unknown>>({});
const openReview = vi.fn<(...a: unknown[]) => unknown>();
const loadReview = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/stores/review", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	reviewStates: { subscribe: reviewStates.subscribe },
	openReview: (...a: unknown[]) => openReview(...a),
	loadReview: (...a: unknown[]) => loadReview(...a),
	// The view reads the panel flag back out of the store, so the stub has to
	// write it there rather than only recording the call.
	setSelectedPath: (...a: unknown[]) => setSelectedPath(...a),
	setDiscussionFilter: (...a: unknown[]) => setDiscussionFilter(...a),
	setDiscussionsOpen: (_scope: unknown, isOpen: boolean) =>
		reviewStates.update((m) => ({
			...m,
			"p1:i1": {
				...(m["p1:i1"] as Record<string, unknown>),
				isDiscussionsOpen: isOpen,
			},
		})),
}));

const setSelectedPath = vi.fn<(...a: unknown[]) => unknown>();
const setDiscussionFilter = vi.fn<(...a: unknown[]) => unknown>();
const fileMtimes = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/services/file-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	fileMtimes: (...a: unknown[]) => fileMtimes(...a),
}));

const activeInstance = writable<unknown>(null);
vi.mock("$lib/stores/instance", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	activeInstance: { subscribe: activeInstance.subscribe },
}));

const { activeStep } = await import("$lib/stores/ui");
const { default: ReviewView } = await import(
	"$lib/components/review/ReviewView.svelte"
);

const actor = { login: "alice", displayName: "Alice", avatarUrl: null };

function mergeRequest(overrides: Partial<MergeRequest> = {}): MergeRequest {
	return {
		id: "mr1",
		number: "!12",
		title: "Add login",
		description: "",
		state: "open",
		isDraft: false,
		sourceBranch: "feature",
		targetBranch: "main",
		author: actor,
		reviewers: [],
		assignees: [],
		labels: [],
		approvals: { approved: 0, required: null, approvedByMe: false },
		mergeable: "yes",
		hasConflicts: false,
		headSha: "sha-head",
		pipelineStatus: null,
		url: "https://forge/mr/12",
		createdAt: "2026-01-01T00:00:00Z",
		updatedAt: "2026-01-01T00:00:00Z",
		...overrides,
	} as MergeRequest;
}

function discussion(overrides: Partial<Discussion> = {}): Discussion {
	return {
		id: "d1",
		resolved: false,
		resolvable: true,
		anchor: null,
		comments: [
			{
				id: "c1",
				author: actor,
				body: "please rename this",
				createdAt: "2026-01-01T00:00:00Z",
				isSystem: false,
			},
		],
		...overrides,
	};
}

function changedFile(overrides: Partial<GitChangedFile> = {}): GitChangedFile {
	return {
		filePath: "src/a.ts",
		status: "M",
		additions: 3,
		deletions: 1,
		...overrides,
	};
}

function state(
	overrides: Partial<InstanceMergeRequestState> = {},
): InstanceMergeRequestState {
	return {
		mergeRequest: mergeRequest(),
		discussions: [],
		selectedDiscussionId: "",
		isLoaded: true,
		isRefreshing: false,
		areDiscussionsLoaded: true,
		error: null,
		...overrides,
	};
}

function setState(overrides: Partial<InstanceMergeRequestState> = {}) {
	mrState.set({ "p1:i1": state(overrides) });
}

function mount() {
	render(ReviewView, { props: {} });
}

const fileItems = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".file-item"));
const fileNames = () =>
	fileItems().map((f) => f.querySelector(".fname")?.textContent?.trim());
const diff = () => document.querySelector("[data-diff]") as HTMLElement | null;
const markers = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".stub-marker"));
const discussionCards = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".discussion"));
/** The button of a discussion card whose label matches. */
const inCard = (card: HTMLElement, re: RegExp) =>
	Array.from(card.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
		re.test(b.textContent ?? ""),
	) as HTMLButtonElement;
const discPanel = () => document.querySelector(".disc-panel");
const discRail = () => document.querySelector(".disc-rail");
/** Threads anchored somewhere other than the file on screen. */
const elsewhereCards = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".disc-elsewhere"));
const banners = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".banner")).map(
		(b) => b.textContent ?? "",
	);
const buttonBy = (re: RegExp) =>
	Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
		re.test(b.textContent ?? ""),
	) as HTMLButtonElement;
const headerText = () =>
	document.querySelector(".review-header")?.textContent ?? "";

async function settle() {
	await tick();
	await tick();
	await tick();
	await tick();
}

beforeEach(() => {
	openUrl.mockReset().mockResolvedValue(undefined);
	commitExists.mockReset().mockResolvedValue(true);
	gitFetch.mockReset().mockResolvedValue(undefined);
	getDiffFilesBetween.mockReset().mockResolvedValue([changedFile()]);
	getDiffFileBetween
		.mockReset()
		.mockResolvedValue({ oldContent: "one\ntwo", newContent: "one\nTWO" });
	loadMergeRequest.mockReset().mockResolvedValue(undefined);
	loadDiscussions.mockReset().mockResolvedValue(undefined);
	approveMergeRequest.mockReset().mockResolvedValue(undefined);
	replyToDiscussion.mockReset().mockResolvedValue(undefined);
	selectDiscussion.mockReset();
	setDiscussionResolved.mockReset().mockResolvedValue(undefined);
	hasForge.set(true);
	activeInstance.set({
		id: "i1",
		projectId: "p1",
		branch: "feature",
		baseBranch: "develop",
		worktreePath: "/wt",
		ticket: { id: "T-1", key: "", title: "Login", url: "" },
	});
	activeStep.set("review");
	openReview.mockReset().mockResolvedValue(undefined);
	loadReview.mockReset().mockResolvedValue(undefined);
	fileMtimes.mockReset().mockResolvedValue({ "/wt/src/a.ts": 1 });
	setSelectedPath.mockReset();
	setDiscussionFilter.mockReset();
	// The diff is the mode these tests exercise; the guide has its own.
	reviewStates.set({
		"p1:i1": {
			guide: null,
			seenHunks: [],
			comments: [],
			currentChapterId: "",
			currentExcerptIndex: 0,
			isDiffMode: true,
			isDiscussionsOpen: true,
		},
	});
	setState();
});

describe("ReviewView", () => {
	describe("what it compares", () => {
		/** With a merge request, the diff is against its target branch. */
		it("compares against the merge request's target branch", async () => {
			mount();
			await settle();
			expect(getDiffFilesBetween).toHaveBeenCalledWith(
				"/wt",
				"main",
				"sha-head",
			);
		});

		/** Without one, the instance's own base branch stands in. */
		it("compares against the instance's base branch with no merge request", async () => {
			setState({ mergeRequest: null });
			mount();
			await settle();
			expect(getDiffFilesBetween).toHaveBeenCalledWith(
				"/wt",
				"develop",
				"HEAD",
			);
		});

		it("compares locally when no forge is bound", async () => {
			hasForge.set(false);
			mount();
			await settle();
			expect(getDiffFilesBetween).toHaveBeenCalledWith(
				"/wt",
				"develop",
				"HEAD",
			);
		});

		it("loads the merge request of the branch", async () => {
			setState({ isLoaded: false });
			mount();
			await settle();
			expect(loadMergeRequest).toHaveBeenCalledWith("p1", "i1", "feature");
		});

		it("loads it once", async () => {
			setState({ isLoaded: false });
			mount();
			await settle();
			activeInstance.set({
				id: "i1",
				projectId: "p1",
				branch: "feature",
				baseBranch: "develop",
				worktreePath: "/wt",
				ticket: { id: "T-1", key: "", title: "Login", url: "" },
			});
			await settle();
			expect(loadMergeRequest).toHaveBeenCalledTimes(1);
		});

		it("loads its discussions once it has one", async () => {
			setState({ areDiscussionsLoaded: false });
			mount();
			await settle();
			expect(loadDiscussions).toHaveBeenCalledWith("p1", "i1");
		});

		it("loads no discussion without a merge request", async () => {
			setState({ mergeRequest: null, areDiscussionsLoaded: false });
			mount();
			await settle();
			expect(loadDiscussions).not.toHaveBeenCalled();
		});
	});

	describe("the header", () => {
		it("names the merge request", async () => {
			mount();
			await settle();
			expect(headerText()).toContain("!12");
			expect(headerText()).toContain("Add login");
		});

		it("says it is a draft when it is one", async () => {
			setState({ mergeRequest: mergeRequest({ isDraft: true }) });
			mount();
			await settle();
			expect(document.querySelector(".pill.draft")).not.toBeNull();
		});

		it("offers to create one when the branch has none", async () => {
			setState({ mergeRequest: null });
			mount();
			await settle();
			await userEvent.click(
				document.querySelector(".btn.primary.small") as HTMLElement,
			);
			await settle();
			expect(document.querySelector(".mr-form")).not.toBeNull();
		});

		/** Without a forge there is nothing to create the request on. */
		it("offers no creation without a forge", async () => {
			hasForge.set(false);
			mount();
			await settle();
			expect(document.querySelector(".btn.primary.small")).toBeNull();
		});

		it("approves the merge request", async () => {
			mount();
			await settle();
			await userEvent.click(buttonBy(/approve|approuver/i));
			await settle();
			expect(approveMergeRequest).toHaveBeenCalledWith("p1", "i1", true);
		});

		/** The same button withdraws an approval already given. */
		it("withdraws an approval already given", async () => {
			setState({
				mergeRequest: mergeRequest({
					approvals: { approved: 1, required: null, approvedByMe: true },
				}),
			});
			mount();
			await settle();
			await userEvent.click(
				document.querySelector(".btn.small") as HTMLElement,
			);
			await settle();
			expect(approveMergeRequest).toHaveBeenCalledWith("p1", "i1", false);
		});

		it("cannot approve a request that is not open", async () => {
			setState({ mergeRequest: mergeRequest({ state: "merged" }) });
			mount();
			await settle();
			expect(
				(document.querySelector(".btn.small") as HTMLButtonElement).disabled,
			).toBe(true);
		});

		it("opens the merge request on the forge", async () => {
			mount();
			await settle();
			await userEvent.click(
				document.querySelector(".btn.ghost.small") as HTMLElement,
			);
			expect(openUrl).toHaveBeenCalledWith("https://forge/mr/12");
		});

		it("reloads on request", async () => {
			mount();
			await settle();
			getDiffFilesBetween.mockClear();
			loadMergeRequest.mockClear();
			await userEvent.click(
				document.querySelector(".btn.ghost.small.icon-only") as HTMLElement,
			);
			await settle();
			expect(loadMergeRequest).toHaveBeenCalledTimes(1);
			expect(getDiffFilesBetween).toHaveBeenCalledTimes(1);
		});
	});

	describe("the changed files", () => {
		it("lists the files the diff changed", async () => {
			getDiffFilesBetween.mockResolvedValue([
				changedFile({ filePath: "src/a.ts" }),
				changedFile({ filePath: "src/b.ts" }),
			]);
			mount();
			await settle();
			expect(fileNames()).toEqual(["src/a.ts", "src/b.ts"]);
		});

		it("opens the first file on its own", async () => {
			mount();
			await settle();
			expect(getDiffFileBetween).toHaveBeenCalledWith(
				"/wt",
				"main",
				"sha-head",
				"src/a.ts",
			);
		});

		it("opens the file that was clicked", async () => {
			getDiffFilesBetween.mockResolvedValue([
				changedFile({ filePath: "src/a.ts" }),
				changedFile({ filePath: "src/b.ts" }),
			]);
			mount();
			await settle();
			await userEvent.click(fileItems()[1]);
			await settle();
			expect(getDiffFileBetween).toHaveBeenLastCalledWith(
				"/wt",
				"main",
				"sha-head",
				"src/b.ts",
			);
		});

		it("shows the diff of the open file", async () => {
			mount();
			await settle();
			expect(diff()?.getAttribute("data-old")).toBe("one\ntwo");
			expect(diff()?.getAttribute("data-new")).toBe("one\nTWO");
		});

		it("says so when the branch changed nothing", async () => {
			getDiffFilesBetween.mockResolvedValue([]);
			mount();
			await settle();
			expect(fileItems()).toHaveLength(0);
			expect(document.querySelector(".empty-note")).not.toBeNull();
		});

		it("reports a diff that could not be read", async () => {
			getDiffFilesBetween.mockRejectedValue(new Error("bad revision"));
			mount();
			await settle();
			expect(banners().join(" ")).not.toBe("");
			expect(fileItems()).toHaveLength(0);
		});

		it("counts the open discussions of a file", async () => {
			setState({
				discussions: [
					discussion({
						id: "d1",
						anchor: {
							path: "src/a.ts",
							line: 2,
							side: "new",
							sha: "sha-head",
						},
					}),
				],
			});
			mount();
			await settle();
			expect(fileItems()[0].querySelector(".disc-count")?.textContent).toBe(
				"1",
			);
		});

		it("counts no discussion for a file with none", async () => {
			mount();
			await settle();
			expect(fileItems()[0].querySelector(".disc-count")).toBeNull();
		});
	});

	describe("a head commit the worktree does not have", () => {
		beforeEach(() => {
			commitExists.mockResolvedValue(false);
		});

		it("says the commit is missing rather than showing an error", async () => {
			mount();
			await settle();
			expect(banners().join(" ")).not.toBe("");
		});

		/**
		 * The check is asynchronous, so the first load races it; what matters is
		 * that a reload is not attempted once the commit is known to be missing.
		 */
		it("retries no diff once the commit is known missing", async () => {
			mount();
			await settle();
			getDiffFilesBetween.mockClear();
			await userEvent.click(
				document.querySelector(".btn.ghost.small.icon-only") as HTMLElement,
			);
			await settle();
			expect(getDiffFilesBetween).not.toHaveBeenCalled();
		});

		it("fetches the missing commit on request", async () => {
			mount();
			await settle();
			await userEvent.click(buttonBy(/fetch|récupérer/i));
			await settle();
			expect(gitFetch).toHaveBeenCalledWith("/wt");
		});

		it("loads the diff once the commit arrived", async () => {
			mount();
			await settle();
			commitExists.mockResolvedValue(true);
			await userEvent.click(buttonBy(/fetch|récupérer/i));
			await settle();
			expect(getDiffFilesBetween).toHaveBeenCalled();
		});

		it("reports a fetch that failed", async () => {
			gitFetch.mockRejectedValue(new Error("no remote"));
			mount();
			await settle();
			await userEvent.click(buttonBy(/fetch|récupérer/i));
			await settle();
			expect(banners().join(" ")).not.toBe("");
		});
	});

	describe("the discussions", () => {
		const anchored = discussion({
			id: "d-anchored",
			anchor: { path: "src/a.ts", line: 2, side: "new", sha: "sha-head" },
		});

		/** A general comment belongs in its own panel, not on a line. */
		it("gathers the general and the anchored comments in one panel", async () => {
			setState({ discussions: [discussion({ id: "d-general" }), anchored] });
			mount();
			await settle();
			expect(discPanel()?.querySelectorAll(".discussion")).toHaveLength(2);
		});

		it("shows only the discussions of the open file", async () => {
			getDiffFilesBetween.mockResolvedValue([
				changedFile({ filePath: "src/a.ts" }),
				changedFile({ filePath: "src/b.ts" }),
			]);
			setState({
				discussions: [
					anchored,
					discussion({
						id: "d-other",
						anchor: {
							path: "src/b.ts",
							line: 1,
							side: "new",
							sha: "sha-head",
						},
					}),
				],
			});
			mount();
			await settle();
			// Both are listed - a thread on another file is still the reviewer's
			// to answer - but only the one off-screen is marked as elsewhere.
			expect(discPanel()?.querySelectorAll(".discussion")).toHaveLength(2);
			expect(elsewhereCards()).toHaveLength(1);
		});

		it("says when a merge request has no discussion", async () => {
			mount();
			await settle();
			expect(discPanel()?.textContent).toMatch(/no|aucun/i);
		});

		it("collapses to a rail and comes back", async () => {
			setState({ discussions: [discussion({ id: "d-general" })] });
			mount();
			await settle();
			expect(discPanel()).not.toBeNull();

			await userEvent.click(
				discPanel()?.querySelector(".disc-toggle") as HTMLButtonElement,
			);
			await settle();
			expect(discPanel()).toBeNull();
			expect(discRail()).not.toBeNull();

			await userEvent.click(discRail() as HTMLButtonElement);
			await settle();
			expect(discPanel()).not.toBeNull();
		});

		/** Without a merge request there is no discussion panel at all. */
		it("shows no discussion panel for a local diff", async () => {
			setState({ mergeRequest: null });
			mount();
			await settle();
			expect(discPanel()).toBeNull();
		});

		/** Two markers on the same file: only the one clicked may be selected. */
		it("selects the discussion the clicked marker points at", async () => {
			setState({
				discussions: [
					discussion({
						id: "d-first",
						anchor: {
							path: "src/a.ts",
							line: 1,
							side: "new",
							sha: "sha-head",
						},
					}),
					anchored,
				],
			});
			mount();
			await settle();
			const second = markers().find(
				(m) => m.getAttribute("data-line") === "2",
			) as HTMLElement;
			await userEvent.click(second);
			await settle();
			expect(selectDiscussion).toHaveBeenCalledWith("p1", "i1", "d-anchored");
		});

		it("marks the diff at every anchored discussion", async () => {
			setState({ discussions: [anchored] });
			mount();
			await settle();
			expect(markers()).toHaveLength(1);
			expect(markers()[0].getAttribute("data-line")).toBe("2");
		});

		it("replies to the discussion that was answered", async () => {
			setState({ discussions: [discussion({ id: "d-general" })] });
			mount();
			await settle();
			const card = discussionCards()[0];
			await userEvent.click(card.querySelector(".reply-open") as HTMLElement);
			await settle();
			const box = card.querySelector("textarea") as HTMLTextAreaElement;
			await userEvent.type(box, "will do");
			await userEvent.click(
				card.querySelector(".btn.primary.tiny") as HTMLElement,
			);
			await settle();
			expect(replyToDiscussion).toHaveBeenCalledWith(
				"p1",
				"i1",
				"d-general",
				"will do",
			);
		});

		it("resolves the discussion that was closed", async () => {
			setState({ discussions: [discussion({ id: "d-general" })] });
			mount();
			await settle();
			await userEvent.click(inCard(discussionCards()[0], /resolve|résoudre/i));
			await settle();
			expect(setDiscussionResolved).toHaveBeenCalledWith(
				"p1",
				"i1",
				"d-general",
				true,
			);
		});
	});

	describe("what the forge refused", () => {
		it("shows the forge's own error", async () => {
			setState({
				error: { code: "forbidden", message: "" } as never,
			});
			mount();
			await settle();
			expect(document.querySelector(".banner.error")).not.toBeNull();
		});
	});

	describe("opening the file under review", () => {
		const openButton = () =>
			document.querySelector(".open-file-btn") as HTMLButtonElement | null;

		it("offers to open a file that is on disk", async () => {
			mount();
			await settle();
			expect(openButton()).not.toBeNull();
			expect(openButton()?.disabled).toBe(false);
		});

		/** A file the diff deleted has nothing to open. */
		it("refuses a file the worktree no longer has", async () => {
			fileMtimes.mockResolvedValue({});
			mount();
			await settle();
			expect(openButton()?.disabled).toBe(true);
		});

		it("checks the file inside the worktree, not the repository root", async () => {
			mount();
			await settle();
			expect(fileMtimes).toHaveBeenCalledWith(["/wt/src/a.ts"]);
		});
	});

	describe("remembering the file being read", () => {
		const twoFiles = () => {
			getDiffFilesBetween.mockResolvedValue([
				changedFile({ filePath: "src/a.ts" }),
				changedFile({ filePath: "src/b.ts" }),
			]);
		};

		it("opens the first file when nothing was remembered", async () => {
			twoFiles();
			mount();
			await settle();
			expect(fileNames()[0]).toBe("src/a.ts");
			expect(getDiffFileBetween.mock.calls[0][3]).toBe("src/a.ts");
		});

		it("reopens on the file left open last time", async () => {
			twoFiles();
			reviewStates.update((m) => ({
				...m,
				"p1:i1": {
					...(m["p1:i1"] as Record<string, unknown>),
					selectedPath: "src/b.ts",
				},
			}));
			mount();
			await settle();
			expect(getDiffFileBetween.mock.calls[0][3]).toBe("src/b.ts");
		});

		/** A file the branch no longer changes cannot be reopened. */
		it("falls back to the first file when the remembered one is gone", async () => {
			twoFiles();
			reviewStates.update((m) => ({
				...m,
				"p1:i1": {
					...(m["p1:i1"] as Record<string, unknown>),
					selectedPath: "src/vanished.ts",
				},
			}));
			mount();
			await settle();
			expect(getDiffFileBetween.mock.calls[0][3]).toBe("src/a.ts");
		});

		it("saves the file the reviewer picks", async () => {
			twoFiles();
			mount();
			await settle();
			const other = fileItems().find((f) =>
				f.textContent?.includes("src/b.ts"),
			) as HTMLElement;
			await userEvent.click(other);
			await settle();
			expect(setSelectedPath).toHaveBeenCalled();
			const last = setSelectedPath.mock.calls.at(-1);
			expect(last?.[1]).toBe("src/b.ts");
		});

		/** Restoring must not write back the value it just read. */
		it("saves nothing when it merely restored the remembered file", async () => {
			twoFiles();
			reviewStates.update((m) => ({
				...m,
				"p1:i1": {
					...(m["p1:i1"] as Record<string, unknown>),
					selectedPath: "src/b.ts",
				},
			}));
			mount();
			await settle();
			expect(setSelectedPath).not.toHaveBeenCalled();
		});
	});

	describe("filtering the discussions", () => {
		const filterTab = (re: RegExp) =>
			Array.from(
				document.querySelectorAll<HTMLButtonElement>(".disc-filter"),
			).find((b) => re.test(b.textContent ?? "")) as HTMLButtonElement;
		const cards = () => document.querySelectorAll(".discussion");

		/** What the forge records itself: never resolvable, never answerable. */
		const systemNote = (id: string) =>
			discussion({
				id,
				resolvable: false,
				comments: [
					{
						id: `${id}-c`,
						author: actor,
						body: "changed the milestone",
						createdAt: "2026-01-01T00:00:00Z",
						isSystem: true,
					},
				],
			});

		const mixed = () => {
			setState({
				discussions: [
					discussion({ id: "d-open" }),
					discussion({ id: "d-done", resolved: true }),
				],
			});
		};

		const withActivity = () => {
			setState({
				discussions: [
					discussion({ id: "d-open" }),
					discussion({ id: "d-done", resolved: true }),
					systemNote("d-log"),
				],
			});
		};

		it("lists every discussion by default", async () => {
			mixed();
			mount();
			await settle();
			expect(cards()).toHaveLength(2);
		});

		it("keeps only the open ones", async () => {
			mixed();
			mount();
			await settle();
			await userEvent.click(filterTab(/open|ouvert/i));
			await settle();
			expect(cards()).toHaveLength(1);
		});

		it("keeps only the resolved ones", async () => {
			mixed();
			mount();
			await settle();
			await userEvent.click(filterTab(/resolved|résolue/i));
			await settle();
			expect(cards()).toHaveLength(1);
		});

		/** The counts describe the whole set, not the filtered view. */
		it("counts every filter against the full set", async () => {
			mixed();
			mount();
			await settle();
			await userEvent.click(filterTab(/open|ouvert/i));
			await settle();
			expect(filterTab(/^all|toutes/i).textContent).toContain("2");
			expect(filterTab(/resolved|résolue/i).textContent).toContain("1");
		});

		/**
		 * A log the forge wrote can never be resolved, so counting it as open
		 * would show work that does not exist and never reaches zero.
		 */
		it("leaves the forge's own logs out of the open count", async () => {
			withActivity();
			mount();
			await settle();
			expect(filterTab(/^open|ouvert/i).textContent).toContain("1");
			expect(filterTab(/activity|activité/i).textContent).toContain("1");
		});

		it("keeps the logs out of the open list", async () => {
			withActivity();
			mount();
			await settle();
			await userEvent.click(filterTab(/^open|ouvert/i));
			await settle();
			expect(cards()).toHaveLength(1);
		});

		it("lists only the logs under activity", async () => {
			withActivity();
			mount();
			await settle();
			await userEvent.click(filterTab(/activity|activité/i));
			await settle();
			expect(cards()).toHaveLength(1);
			expect(discPanel()?.textContent).toContain("changed the milestone");
		});

		it("still counts everything under all", async () => {
			withActivity();
			mount();
			await settle();
			expect(filterTab(/^all|toutes/i).textContent).toContain("3");
		});

		/**
		 * The label above the diff describes the file, so it counts every thread
		 * on it whatever lens the panel is set to.
		 */
		it("keeps the file's discussion count whatever the filter", async () => {
			setState({
				discussions: [
					discussion({
						id: "d-anchored",
						anchor: {
							path: "src/a.ts",
							line: 2,
							side: "new",
							sha: "sha-head",
						},
					}),
				],
			});
			mount();
			await settle();
			const label = () =>
				document.querySelector(".anchored-count")?.textContent ?? "";
			expect(label()).toMatch(/1/);

			await userEvent.click(filterTab(/activity|activité/i));
			await settle();
			expect(label()).toMatch(/1/);

			await userEvent.click(filterTab(/resolved|résolue/i));
			await settle();
			expect(label()).toMatch(/1/);
		});

		it("saves the filter that was picked", async () => {
			mixed();
			mount();
			await settle();
			await userEvent.click(filterTab(/^open|ouvert/i));
			await settle();
			expect(setDiscussionFilter).toHaveBeenCalled();
			expect(setDiscussionFilter.mock.calls.at(-1)?.[1]).toBe("open");
		});

		/** Coming back to the step must land on the filter it was left on. */
		it("reopens on the filter it was left on", async () => {
			mixed();
			reviewStates.update((m) => ({
				...m,
				"p1:i1": {
					...(m["p1:i1"] as Record<string, unknown>),
					discussionFilter: "resolved",
				},
			}));
			mount();
			await settle();
			expect(filterTab(/resolved|résolue/i).className).toContain("active");
			expect(cards()).toHaveLength(1);
		});

		it("falls back to all for a filter it does not know", async () => {
			mixed();
			reviewStates.update((m) => ({
				...m,
				"p1:i1": {
					...(m["p1:i1"] as Record<string, unknown>),
					discussionFilter: "whatever",
				},
			}));
			mount();
			await settle();
			expect(filterTab(/^all|toutes/i).className).toContain("active");
			expect(cards()).toHaveLength(2);
		});

		/** A late-arriving stored value must not undo a choice just made. */
		it("keeps the filter the reviewer picked after restoring", async () => {
			mixed();
			mount();
			await settle();
			await userEvent.click(filterTab(/resolved|résolue/i));
			await settle();
			expect(filterTab(/resolved|résolue/i).className).toContain("active");
			expect(cards()).toHaveLength(1);
		});

		it("says which list is empty rather than claiming there is none", async () => {
			setState({ discussions: [discussion({ id: "d-open" })] });
			mount();
			await settle();
			await userEvent.click(filterTab(/resolved|résolue/i));
			await settle();
			expect(discPanel()?.textContent).toMatch(/resolved|résolue/i);
			expect(cards()).toHaveLength(0);
		});
	});

	describe("the loading placeholder", () => {
		const skeleton = () => document.querySelector(".diff-skeleton");

		/** A read that returns at once would flash the placeholder for a frame. */
		it("shows nothing for a read that returns quickly", async () => {
			mount();
			await settle();
			expect(skeleton()).toBeNull();
		});

		it("does not claim the file is empty while it is still loading", async () => {
			// A read that never settles: the pane must stay quiet, not report
			// that there is nothing to show.
			getDiffFileBetween.mockImplementation(() => new Promise(() => {}));
			mount();
			await settle();
			expect(document.body.textContent).not.toMatch(/nothing to show|rien/i);
		});

		it("shows the placeholder once the read outlives the threshold", async () => {
			getDiffFileBetween.mockImplementation(() => new Promise(() => {}));
			mount();
			await settle();
			await vi.waitFor(() => expect(skeleton()).not.toBeNull(), {
				timeout: 1000,
			});
		});
	});

	describe("following a discussion to its line", () => {
		const anchoredOn = (path: string, line: number, id = "d-anchor") =>
			discussion({
				id,
				anchor: { path, line, side: "new", sha: "sha-head" },
			});

		/**
		 * The whole card is the target, not only the small line tag on it. The
		 * jump itself lives in the editor, so what is observable here is that the
		 * thread was selected by the click on the card body.
		 */
		it("selects the thread when the card itself is clicked", async () => {
			setState({ discussions: [anchoredOn("src/a.ts", 2)] });
			mount();
			await settle();
			const card = discussionCards()[0];
			expect(card).not.toBeUndefined();
			await userEvent.click(card);
			await settle();
			expect(selectDiscussion).toHaveBeenCalledWith("p1", "i1", "d-anchor");
		});

		it("opens the file of a thread anchored elsewhere", async () => {
			getDiffFilesBetween.mockResolvedValue([
				changedFile({ filePath: "src/a.ts" }),
				changedFile({ filePath: "src/b.ts" }),
			]);
			setState({ discussions: [anchoredOn("src/b.ts", 7, "d-else")] });
			mount();
			await settle();
			const card = discussionCards()[0];
			await userEvent.click(card);
			await settle();
			// The diff moved onto the file the thread belongs to.
			expect(getDiffFileBetween.mock.calls.at(-1)?.[3]).toBe("src/b.ts");
		});
	});

	describe("carrying the panel state across a switch", () => {
		/**
		 * The stored state has to be in place before the diff resolves: a closed
		 * panel that flashes open on every instance switch is the symptom, and on
		 * a branch with no base it would never load at all.
		 */
		it("reads the stored state without waiting for a diff", async () => {
			// The state on disk says the panel was left closed.
			reviewStates.update((m) => ({
				...m,
				"p1:i1": {
					...(m["p1:i1"] as Record<string, unknown>),
					isDiscussionsOpen: false,
				},
			}));
			mount();
			await settle();
			expect(loadReview).toHaveBeenCalled();
			expect(discPanel()).toBeNull();
			expect(discRail()).not.toBeNull();
		});

		it("asks for the state of the instance it is showing", async () => {
			mount();
			await settle();
			const scope = loadReview.mock.calls[0]?.[0] as {
				projectId: string;
				instanceId: string;
			};
			expect(scope.projectId).toBe("p1");
			expect(scope.instanceId).toBe("i1");
		});
	});
});
