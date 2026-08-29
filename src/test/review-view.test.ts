import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { get, writable } from "svelte/store";
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

const activeInstance = writable<unknown>(null);
vi.mock("$lib/stores/instance", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	activeInstance: { subscribe: activeInstance.subscribe },
}));

const requestAgentDraft = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/stores/agent-draft", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	requestAgentDraft: (...a: unknown[]) => requestAgentDraft(...a),
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
const generalPanel = () => document.querySelector(".general-panel");
const anchoredPanel = () => document.querySelector(".anchored-panel");
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
	requestAgentDraft.mockReset();
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
		it("keeps the general comments apart from the anchored ones", async () => {
			setState({ discussions: [discussion({ id: "d-general" }), anchored] });
			mount();
			await settle();
			expect(generalPanel()?.querySelectorAll(".discussion")).toHaveLength(1);
			expect(anchoredPanel()?.querySelectorAll(".discussion")).toHaveLength(1);
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
			expect(anchoredPanel()?.querySelectorAll(".discussion")).toHaveLength(1);
		});

		it("says when a merge request has no discussion", async () => {
			mount();
			await settle();
			expect(generalPanel()?.textContent).toMatch(/no|aucun/i);
		});

		/** Without a merge request there is no discussion panel at all. */
		it("shows no discussion panel for a local diff", async () => {
			setState({ mergeRequest: null });
			mount();
			await settle();
			expect(generalPanel()).toBeNull();
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

	describe("handing a comment to the agent", () => {
		it("drafts a prompt with the comment and opens the agent", async () => {
			setState({ discussions: [discussion({ id: "d-general" })] });
			mount();
			await settle();
			await userEvent.click(inCard(discussionCards()[0], /agent/i));
			await settle();
			expect(requestAgentDraft).toHaveBeenCalledTimes(1);
			expect(requestAgentDraft.mock.calls[0][0]).toBe("i1");
			expect(requestAgentDraft.mock.calls[0][1]).toContain(
				"please rename this",
			);
			expect(get(activeStep)).toBe("agent");
		});

		/** An anchored comment carries the code it is about. */
		it("includes the code an anchored comment points at", async () => {
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
			await userEvent.click(inCard(discussionCards()[0], /agent/i));
			await settle();
			expect(requestAgentDraft.mock.calls[0][1]).toContain("TWO");
		});

		/** A system note is machinery, not something to answer. */
		it("leaves the system notes out of the prompt", async () => {
			setState({
				discussions: [
					discussion({
						id: "d-general",
						comments: [
							{
								id: "c0",
								author: actor,
								body: "changed the milestone",
								createdAt: "2026-01-01T00:00:00Z",
								isSystem: true,
							},
							{
								id: "c1",
								author: actor,
								body: "please rename this",
								createdAt: "2026-01-01T00:00:00Z",
								isSystem: false,
							},
						],
					}),
				],
			});
			mount();
			await settle();
			await userEvent.click(inCard(discussionCards()[0], /agent/i));
			await settle();
			expect(requestAgentDraft.mock.calls[0][1]).not.toContain(
				"changed the milestone",
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
});
