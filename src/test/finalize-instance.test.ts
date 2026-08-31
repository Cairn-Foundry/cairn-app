// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Instance } from "$lib/types/instance";

const openUrl = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("@tauri-apps/plugin-opener", () => ({
	openUrl: (...a: unknown[]) => openUrl(...a),
}));

const gitState = writable<Record<string, unknown>>({});
const fileCounts = writable({ total: 0, staged: 0, unstaged: 0 });
const clearGitError = vi.fn<(...a: unknown[]) => unknown>();
const fetchRemote = vi.fn<(...a: unknown[]) => unknown>();
const refreshStatus = vi.fn<(...a: unknown[]) => unknown>();
const rebaseOnto = vi.fn<(...a: unknown[]) => unknown>();
const pushBranch = vi.fn<(...a: unknown[]) => unknown>();
const getRemoteUrl = vi.fn<(...a: unknown[]) => unknown>();
const getBranchDivergence = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/stores/git", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	git: { subscribe: gitState.subscribe },
	loadBranches: vi.fn(async (..._a: unknown[]) => {}),
	gitFileCounts: { subscribe: fileCounts.subscribe },
	clearGitError: (...a: unknown[]) => clearGitError(...a),
	fetchRemote: (...a: unknown[]) => fetchRemote(...a),
	refreshStatus: (...a: unknown[]) => refreshStatus(...a),
	rebaseOnto: (...a: unknown[]) => rebaseOnto(...a),
	pushBranch: (...a: unknown[]) => pushBranch(...a),
	getRemoteUrl: (...a: unknown[]) => getRemoteUrl(...a),
	getBranchDivergence: (...a: unknown[]) => getBranchDivergence(...a),
}));

const removeInstance = vi.fn<(...a: unknown[]) => unknown>();
const setInstanceStatus = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/stores/instance", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	removeInstance: (...a: unknown[]) => removeInstance(...a),
	setInstanceStatus: (...a: unknown[]) => setInstanceStatus(...a),
}));

const hasForge = writable(false);
const hasTracker = writable(false);
const projectBindings = writable<Record<string, unknown>>({
	autoTransition: {},
});
vi.mock("$lib/stores/integrations", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	hasForge: { subscribe: hasForge.subscribe },
	hasTracker: { subscribe: hasTracker.subscribe },
	projectBindings: { subscribe: projectBindings.subscribe },
}));

const mergeRequests = writable<Record<string, unknown>>({});
const loadMergeRequest = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/stores/merge-request", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	mergeRequests: { subscribe: mergeRequests.subscribe },
	loadMergeRequest: (...a: unknown[]) => loadMergeRequest(...a),
}));

const ticketsStore = writable<Record<string, unknown>>({});
const loadTicket = vi.fn<(...a: unknown[]) => unknown>();
const transitionTicketToStatus = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/stores/tracker", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	tickets: { subscribe: ticketsStore.subscribe },
	loadTicket: (...a: unknown[]) => loadTicket(...a),
	transitionTicketToStatus: (...a: unknown[]) => transitionTicketToStatus(...a),
}));

const { instance } = await import("./fixtures");
const { default: FinalizeInstance } = await import(
	"$lib/components/FinalizeInstance.svelte"
);

/** The git state the checklist reads: everything done unless said otherwise. */
function setGit(overrides: Record<string, unknown> = {}) {
	gitState.set({
		branches: ["main"],
		remoteBranches: [],
		status: {},
		changedPaths: { staged: [], unstaged: [] },
		operationState: null,
		remoteStatus: { hasUpstream: true, ahead: 0, behind: 0 },
		error: null,
		...overrides,
	});
}

function mount(overrides: Partial<Instance> = {}) {
	const onClose = vi.fn();
	const onOpenGit = vi.fn();
	render(FinalizeInstance, {
		props: {
			instance: instance("i1", "p1", {
				branch: "feature/login",
				baseBranch: "main",
				ticket: { id: "T-1", title: "Login" },
				...overrides,
			}),
		},
		events: { close: () => onClose(), openGit: () => onOpenGit() },
	});
	return { onClose, onOpenGit };
}

const steps = () =>
	Array.from(document.querySelectorAll<HTMLElement>("li.fin-step"));
const stepAt = (i: number) => steps()[i];
const isDone = (i: number) =>
	stepAt(i).querySelector(".fin-mark")?.classList.contains("ok") ?? false;
const isMuted = (i: number) => stepAt(i).classList.contains("muted");
const buttonIn = (el: HTMLElement) =>
	el.querySelector(".step-btn") as HTMLButtonElement;
const banners = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".git-error-banner")).map(
		(b) => b.textContent ?? "",
	);

const COMMIT = 0;
const SYNC = 1;
const PUSH = 2;
const HANDOFF = 3;
const CLOSE = 4;

async function settle() {
	for (let i = 0; i < 8; i++) await tick();
}

beforeEach(() => {
	openUrl.mockReset().mockResolvedValue(undefined);
	clearGitError.mockReset();
	fetchRemote.mockReset().mockResolvedValue(undefined);
	refreshStatus.mockReset().mockResolvedValue(undefined);
	rebaseOnto.mockReset().mockResolvedValue(undefined);
	pushBranch.mockReset().mockResolvedValue(undefined);
	getRemoteUrl.mockReset().mockResolvedValue("git@host:team/repo.git");
	getBranchDivergence
		.mockReset()
		.mockResolvedValue({ baseRef: "origin/main", ahead: 0, behind: 0 });
	removeInstance.mockReset().mockResolvedValue(undefined);
	setInstanceStatus.mockReset().mockResolvedValue(undefined);
	loadMergeRequest.mockReset().mockResolvedValue(undefined);
	loadTicket.mockReset().mockResolvedValue(undefined);
	transitionTicketToStatus.mockReset().mockResolvedValue(undefined);
	hasForge.set(false);
	hasTracker.set(false);
	projectBindings.set({ autoTransition: {} });
	mergeRequests.set({});
	ticketsStore.set({});
	fileCounts.set({ total: 0, staged: 0, unstaged: 0 });
	setGit();
});

describe("FinalizeInstance", () => {
	describe("reading the real git state", () => {
		it("fetches before judging the branch", async () => {
			mount();
			await settle();
			expect(fetchRemote).toHaveBeenCalled();
			expect(refreshStatus).toHaveBeenCalledWith(true);
		});

		/** An unreachable remote must not stop the local checks. */
		it("still checks when the remote is unreachable", async () => {
			fetchRemote.mockRejectedValue(new Error("offline"));
			mount();
			await settle();
			expect(steps().length).toBeGreaterThan(0);
			expect(refreshStatus).toHaveBeenCalled();
		});

		it("measures the branch against its base", async () => {
			mount();
			await settle();
			expect(getBranchDivergence).toHaveBeenCalledWith("main");
		});

		it("checks again on request", async () => {
			mount();
			await settle();
			refreshStatus.mockClear();
			await userEvent.click(
				document.querySelector(".modal-foot .step-btn") as HTMLElement,
			);
			await settle();
			expect(refreshStatus).toHaveBeenCalledTimes(1);
		});

		/** The merge request only matters when a forge is bound. */
		it("loads the merge request when a forge is bound", async () => {
			hasForge.set(true);
			mount();
			await settle();
			expect(loadMergeRequest).toHaveBeenCalledWith(
				"p1",
				"i1",
				"feature/login",
			);
		});

		it("loads none without a forge", async () => {
			mount();
			await settle();
			expect(loadMergeRequest).not.toHaveBeenCalled();
		});
	});

	describe("which steps are done", () => {
		it("marks everything done on a clean, pushed branch", async () => {
			mount();
			await settle();
			expect([isDone(COMMIT), isDone(SYNC), isDone(PUSH)]).toEqual([
				true,
				true,
				true,
			]);
		});

		it("holds the commit step open while files are changed", async () => {
			fileCounts.set({ total: 2, staged: 1, unstaged: 1 });
			mount();
			await settle();
			expect(isDone(COMMIT)).toBe(false);
		});

		/** Nothing downstream can be judged before the work is committed. */
		it("locks every later step while the work is uncommitted", async () => {
			fileCounts.set({ total: 2, staged: 1, unstaged: 1 });
			mount();
			await settle();
			expect([isMuted(SYNC), isMuted(PUSH), isMuted(HANDOFF)]).toEqual([
				true,
				true,
				true,
			]);
		});

		it("holds the sync step open while the branch is behind its base", async () => {
			getBranchDivergence.mockResolvedValue({
				baseRef: "origin/main",
				ahead: 0,
				behind: 3,
			});
			mount();
			await settle();
			expect(isDone(SYNC)).toBe(false);
			expect(isMuted(PUSH)).toBe(true);
		});

		/** A rebase left half-done is not a synced branch. */
		it("holds the sync step open during a git operation", async () => {
			setGit({
				operationState: { kind: "rebase", conflictedFiles: ["a.ts"] },
			});
			mount();
			await settle();
			expect(isDone(SYNC)).toBe(false);
		});

		it("holds the push step open with no upstream", async () => {
			setGit({ remoteStatus: { hasUpstream: false, ahead: 0, behind: 0 } });
			mount();
			await settle();
			expect(isDone(PUSH)).toBe(false);
		});

		it("holds the push step open with commits still local", async () => {
			setGit({ remoteStatus: { hasUpstream: true, ahead: 2, behind: 0 } });
			mount();
			await settle();
			expect(isDone(PUSH)).toBe(false);
		});

		it("marks the close step done on an archived instance", async () => {
			mount({ status: "done" });
			await settle();
			expect(isDone(CLOSE)).toBe(true);
		});

		/** An archived instance can still be reopened, so its step stays live. */
		it("keeps the close step usable on an archived instance", async () => {
			mount({ status: "done" });
			await settle();
			expect(isMuted(CLOSE)).toBe(false);
		});
	});

	describe("the steps that act", () => {
		it("sends the user to git to commit", async () => {
			fileCounts.set({ total: 1, staged: 0, unstaged: 1 });
			const { onOpenGit, onClose } = mount();
			await settle();
			await userEvent.click(buttonIn(stepAt(COMMIT)));
			expect(onOpenGit).toHaveBeenCalled();
			expect(onClose).toHaveBeenCalled();
		});

		it("rebases onto the base ref it measured", async () => {
			getBranchDivergence.mockResolvedValue({
				baseRef: "origin/main",
				ahead: 0,
				behind: 3,
			});
			mount();
			await settle();
			await userEvent.click(buttonIn(stepAt(SYNC)));
			await settle();
			expect(rebaseOnto).toHaveBeenCalledWith("origin/main");
		});

		it("re-reads the state after a rebase", async () => {
			getBranchDivergence.mockResolvedValue({
				baseRef: "origin/main",
				ahead: 0,
				behind: 3,
			});
			mount();
			await settle();
			refreshStatus.mockClear();
			await userEvent.click(buttonIn(stepAt(SYNC)));
			await settle();
			expect(refreshStatus).toHaveBeenCalled();
		});

		/** A conflicted operation is resolved in the git view, not here. */
		it("sends the user to git during a conflicted operation", async () => {
			setGit({
				operationState: { kind: "rebase", conflictedFiles: ["a.ts"] },
			});
			const { onOpenGit } = mount();
			await settle();
			await userEvent.click(buttonIn(stepAt(SYNC)));
			expect(onOpenGit).toHaveBeenCalled();
			expect(rebaseOnto).not.toHaveBeenCalled();
		});

		it("pushes the branch", async () => {
			setGit({ remoteStatus: { hasUpstream: true, ahead: 2, behind: 0 } });
			mount();
			await settle();
			await userEvent.click(buttonIn(stepAt(PUSH)));
			await settle();
			expect(pushBranch).toHaveBeenCalledWith(false, false);
		});

		/** A branch that diverged both ways needs a force push. */
		it("forces the push on a branch that diverged", async () => {
			setGit({ remoteStatus: { hasUpstream: true, ahead: 2, behind: 1 } });
			mount();
			await settle();
			await userEvent.click(buttonIn(stepAt(PUSH)));
			await settle();
			expect(pushBranch).toHaveBeenCalledWith(false, true);
		});

		it("does not force a push that is only ahead", async () => {
			setGit({ remoteStatus: { hasUpstream: true, ahead: 2, behind: 0 } });
			mount();
			await settle();
			await userEvent.click(buttonIn(stepAt(PUSH)));
			await settle();
			expect(pushBranch).toHaveBeenCalledWith(false, false);
		});

		it("archives the instance on the last step", async () => {
			mount();
			await settle();
			await userEvent.click(buttonIn(stepAt(CLOSE)));
			await settle();
			expect(setInstanceStatus).toHaveBeenCalledWith("i1", "p1", "done");
		});

		it("reopens an archived instance from the same step", async () => {
			mount({ status: "done" });
			await settle();
			await userEvent.click(buttonIn(stepAt(CLOSE)));
			await settle();
			expect(setInstanceStatus).toHaveBeenCalledWith("i1", "p1", "idle");
		});

		/** One step at a time: a second click while busy must not double-run. */
		it("runs one step at a time", async () => {
			let release = () => {};
			pushBranch.mockImplementation(
				() => new Promise<void>((r) => (release = () => r())),
			);
			setGit({ remoteStatus: { hasUpstream: true, ahead: 2, behind: 0 } });
			mount();
			await settle();
			const button = buttonIn(stepAt(PUSH));
			await userEvent.click(button);
			await settle();
			button.disabled = false;
			await userEvent.click(button);
			await settle();
			expect(pushBranch).toHaveBeenCalledTimes(1);
			release();
		});

		it("reports what git refused", async () => {
			setGit({
				remoteStatus: { hasUpstream: true, ahead: 2, behind: 0 },
				error: { kind: "rejected", message: "non fast-forward" },
			});
			mount();
			await settle();
			expect(banners().join(" ")).not.toBe("");
		});
	});

	describe("the handoff", () => {
		it("opens the forge's compare page when there is no merge request", async () => {
			mount();
			await settle();
			await userEvent.click(buttonIn(stepAt(HANDOFF)));
			await settle();
			expect(openUrl).toHaveBeenCalledTimes(1);
			expect(openUrl.mock.calls[0][0]).toContain(
				encodeURIComponent("feature/login"),
			);
		});

		it("counts the handoff as done once it was opened", async () => {
			mount();
			await settle();
			expect(isDone(HANDOFF)).toBe(false);
			await userEvent.click(buttonIn(stepAt(HANDOFF)));
			await settle();
			expect(isDone(HANDOFF)).toBe(true);
		});

		/** An existing merge request is opened rather than created again. */
		it("opens the merge request the branch already has", async () => {
			hasForge.set(true);
			mergeRequests.set({
				"p1:i1": {
					mergeRequest: { id: "mr1", url: "https://forge/mr/1" },
					discussions: [],
					selectedDiscussionId: "",
					isLoaded: true,
					isRefreshing: false,
					areDiscussionsLoaded: true,
					error: null,
				},
			});
			mount();
			await settle();
			expect(isDone(HANDOFF)).toBe(true);
			await userEvent.click(buttonIn(stepAt(HANDOFF)));
			await settle();
			expect(openUrl).toHaveBeenCalledWith("https://forge/mr/1");
		});

		/** With a forge bound the request is created in place, not in a browser. */
		it("offers to create the merge request in place", async () => {
			hasForge.set(true);
			mergeRequests.set({
				"p1:i1": {
					mergeRequest: null,
					discussions: [],
					selectedDiscussionId: "",
					isLoaded: true,
					isRefreshing: false,
					areDiscussionsLoaded: true,
					error: null,
				},
			});
			mount();
			await settle();
			await userEvent.click(buttonIn(stepAt(HANDOFF)));
			await settle();
			expect(document.querySelector(".mr-form")).not.toBeNull();
			expect(openUrl).not.toHaveBeenCalled();
		});

		/**
		 * With no remote there is no compare page, so the button is not offered
		 * at all. `doHandoff`'s own `!mrUrl` guard is therefore unreachable
		 * through the UI - a second line of defence, not a tested branch.
		 */
		it("offers no handoff without a remote to compare on", async () => {
			getRemoteUrl.mockResolvedValue("");
			mount();
			await settle();
			expect(buttonIn(stepAt(HANDOFF))).toBeNull();
			expect(openUrl).not.toHaveBeenCalled();
		});
	});

	describe("the ticket transition", () => {
		beforeEach(() => {
			hasTracker.set(true);
			projectBindings.set({ autoTransition: { onFinalize: "done" } });
		});

		it("moves the ticket when the instance is archived", async () => {
			mount({ ticket: { id: "T-1", title: "Login", key: "CAIRN-42" } });
			await settle();
			await userEvent.click(buttonIn(stepAt(CLOSE)));
			await settle();
			expect(transitionTicketToStatus).toHaveBeenCalledWith("p1", "i1", "done");
		});

		it("moves nothing for an instance with no ticket", async () => {
			mount();
			await settle();
			await userEvent.click(buttonIn(stepAt(CLOSE)));
			await settle();
			expect(transitionTicketToStatus).not.toHaveBeenCalled();
			expect(loadTicket).not.toHaveBeenCalled();
		});

		/** Without a tracker bound there is nothing to transition on. */
		it("moves nothing when no tracker is bound", async () => {
			hasTracker.set(false);
			mount({ ticket: { id: "T-1", title: "Login", key: "CAIRN-42" } });
			await settle();
			await userEvent.click(buttonIn(stepAt(CLOSE)));
			await settle();
			expect(transitionTicketToStatus).not.toHaveBeenCalled();
			expect(loadTicket).not.toHaveBeenCalled();
		});

		it("moves nothing when no transition is configured", async () => {
			projectBindings.set({ autoTransition: {} });
			mount({ ticket: { id: "T-1", title: "Login", key: "CAIRN-42" } });
			await settle();
			await userEvent.click(buttonIn(stepAt(CLOSE)));
			await settle();
			expect(transitionTicketToStatus).not.toHaveBeenCalled();
		});

		/** The transition is a courtesy: its failure is shown, never blocking. */
		it("archives the instance even when the transition failed", async () => {
			transitionTicketToStatus.mockRejectedValue(new Error("forbidden"));
			mount({ ticket: { id: "T-1", title: "Login", key: "CAIRN-42" } });
			await settle();
			await userEvent.click(buttonIn(stepAt(CLOSE)));
			await settle();
			expect(setInstanceStatus).toHaveBeenCalledWith("i1", "p1", "done");
			expect(banners().join(" ")).not.toBe("");
		});

		it("loads the ticket it has not seen before transitioning it", async () => {
			mount({ ticket: { id: "T-1", title: "Login", key: "CAIRN-42" } });
			await settle();
			await userEvent.click(buttonIn(stepAt(CLOSE)));
			await settle();
			expect(loadTicket).toHaveBeenCalledWith("p1", "i1", "CAIRN-42");
		});
	});

	describe("cleaning up", () => {
		it("offers to delete only once the instance is archived", async () => {
			mount();
			await settle();
			expect(document.querySelector(".fin-cleanup")).toBeNull();
		});

		it("asks before deleting", async () => {
			mount({ status: "done" });
			await settle();
			await userEvent.click(
				document.querySelector(".fin-cleanup .step-btn") as HTMLElement,
			);
			await settle();
			expect(removeInstance).not.toHaveBeenCalled();
			expect(document.querySelectorAll(".modal-backdrop").length).toBe(2);
		});

		it("deletes the instance once confirmed", async () => {
			const { onClose } = mount({ status: "done" });
			await settle();
			await userEvent.click(
				document.querySelector(".fin-cleanup .step-btn") as HTMLElement,
			);
			await settle();
			await userEvent.click(
				document.querySelector(".btn.danger") as HTMLElement,
			);
			await settle();
			expect(removeInstance).toHaveBeenCalledWith("i1", "p1");
			expect(onClose).toHaveBeenCalled();
		});
	});

	describe("closing", () => {
		it("closes on the close button", async () => {
			const { onClose } = mount();
			await settle();
			await userEvent.click(
				document.querySelector(".icon-btn.close") as HTMLElement,
			);
			expect(onClose).toHaveBeenCalled();
		});

		it("closes on a click outside", async () => {
			const { onClose } = mount();
			await settle();
			await userEvent.click(
				document.querySelector(".modal-backdrop") as HTMLElement,
			);
			expect(onClose).toHaveBeenCalled();
		});

		it("stays open on a click inside", async () => {
			const { onClose } = mount();
			await settle();
			await userEvent.click(document.querySelector(".modal") as HTMLElement);
			expect(onClose).not.toHaveBeenCalled();
		});
	});
});
