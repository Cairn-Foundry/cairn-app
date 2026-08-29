import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface GitState {
	currentBranch: string;
	branches: string[];
	remoteBranches: string[];
}

const gitState = writable<GitState>({
	currentBranch: "main",
	branches: ["main"],
	remoteBranches: [],
});

const checkoutBranch = vi.fn();
const clearGitError = vi.fn();
const loadBranches = vi.fn();
const pushStash = vi.fn();
vi.mock("$lib/stores/git", () => ({
	git: { subscribe: gitState.subscribe },
	checkoutBranch: (...a: unknown[]) => checkoutBranch(...a),
	clearGitError: (...a: unknown[]) => clearGitError(...a),
	loadBranches: (...a: unknown[]) => loadBranches(...a),
	pushStash: (...a: unknown[]) => pushStash(...a),
}));

const instancesStore = writable<unknown[]>([]);
vi.mock("$lib/stores/instance", () => ({
	instances: { subscribe: instancesStore.subscribe },
}));

const activateInstance = vi.fn();
vi.mock("$lib/stores/project", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	activateInstance: (...a: unknown[]) => activateInstance(...a),
}));

const { projects, activeProjectId } = await import("$lib/stores/project");
const { project, instance } = await import("./fixtures");
const { default: BranchSwitcher } = await import(
	"$lib/components/git/BranchSwitcher.svelte"
);

/** A git failure shaped the way the store raises one. */
const gitFailure = (raw: string) => Object.assign(new Error(raw), { raw });

const trigger = () =>
	document.querySelector(".branch-trigger") as HTMLButtonElement;
const menu = () => document.querySelector(".branch-menu");
const items = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".branch-menu-item"));
const names = () =>
	items().map((i) => i.querySelector(".branch-name")?.textContent);
const search = () =>
	document.querySelector(".branch-menu-search input") as HTMLInputElement;
const inUseModal = () => document.querySelector(".modal");
const empty = () => document.querySelector(".branch-menu-empty");

async function settle() {
	await tick();
	await tick();
}

beforeEach(() => {
	checkoutBranch.mockReset().mockResolvedValue(undefined);
	clearGitError.mockReset();
	loadBranches.mockReset().mockResolvedValue(undefined);
	pushStash.mockReset().mockResolvedValue(undefined);
	activateInstance.mockReset();
	gitState.set({
		currentBranch: "main",
		branches: ["main", "feature/login", "develop"],
		remoteBranches: ["origin/main", "origin/release"],
	});
	instancesStore.set([]);
	projects.set([project("p1")]);
	activeProjectId.set("p1");
});

describe("BranchSwitcher", () => {
	describe("the menu", () => {
		it("names the branch that is checked out", () => {
			render(BranchSwitcher, {});
			expect(trigger().textContent).toContain("main");
		});

		it("shows nothing at all outside a repository", () => {
			gitState.set({ currentBranch: "", branches: [], remoteBranches: [] });
			render(BranchSwitcher, {});
			expect(trigger()).toBeNull();
		});

		it("opens on the trigger and closes again", async () => {
			render(BranchSwitcher, {});
			await userEvent.click(trigger());
			expect(menu()).not.toBeNull();
			await userEvent.click(trigger());
			expect(menu()).toBeNull();
		});

		/** The lists come from a fetch, slow enough to be seen. */
		it("re-reads the branches when it opens", async () => {
			render(BranchSwitcher, {});
			await userEvent.click(trigger());
			expect(loadBranches).toHaveBeenCalledWith("/repos/p1");
		});

		it("lists the local branches and marks the current one", async () => {
			render(BranchSwitcher, {});
			await userEvent.click(trigger());
			expect(names()).toContain("main");
			expect(names()).toContain("feature/login");
			const active = items().filter((i) => i.classList.contains("active"));
			expect(active).toHaveLength(1);
		});

		/**
		 * A remote branch that already has a local counterpart is not offered
		 * twice: checking out `origin/main` is checking out `main`.
		 */
		it("hides a remote branch that already exists locally", async () => {
			render(BranchSwitcher, {});
			await userEvent.click(trigger());
			expect(names()).not.toContain("origin/main");
			expect(names()).toContain("origin/release");
		});

		it("narrows both lists to what was searched", async () => {
			render(BranchSwitcher, {});
			await userEvent.click(trigger());
			await userEvent.type(search(), "release");
			expect(names()).toEqual(["origin/release"]);
		});

		it("says so when nothing matches", async () => {
			render(BranchSwitcher, {});
			await userEvent.click(trigger());
			await userEvent.type(search(), "zzz");
			expect(items()).toHaveLength(0);
			expect(empty()).not.toBeNull();
		});

		/** Reopening starts from a clean search rather than the last one. */
		it("forgets the previous search when reopened", async () => {
			render(BranchSwitcher, {});
			await userEvent.click(trigger());
			await userEvent.type(search(), "release");
			await userEvent.click(trigger());
			await userEvent.click(trigger());
			expect(search().value).toBe("");
		});

		it("closes on Escape from the search field", async () => {
			render(BranchSwitcher, {});
			await userEvent.click(trigger());
			await userEvent.type(search(), "{Escape}");
			expect(menu()).toBeNull();
		});
	});

	describe("switching branch", () => {
		it("checks out the branch that was picked", async () => {
			render(BranchSwitcher, {});
			await userEvent.click(trigger());
			const item = items().find((i) =>
				i.textContent?.includes("develop"),
			) as HTMLElement;
			await userEvent.click(item);
			expect(checkoutBranch).toHaveBeenCalledWith("develop");
		});

		/** `origin/feat/x` checks out as `feat/x`; git makes the tracking branch. */
		it("checks out a remote branch under its local name", async () => {
			render(BranchSwitcher, {});
			await userEvent.click(trigger());
			const item = items().find((i) =>
				i.textContent?.includes("origin/release"),
			) as HTMLElement;
			await userEvent.click(item);
			expect(checkoutBranch).toHaveBeenCalledWith("release");
		});

		it("does nothing when the branch is already checked out", async () => {
			render(BranchSwitcher, {});
			await userEvent.click(trigger());
			const item = items().find((i) =>
				i.classList.contains("active"),
			) as HTMLElement;
			await userEvent.click(item);
			expect(checkoutBranch).not.toHaveBeenCalled();
		});

		it("closes the menu once a branch is picked", async () => {
			render(BranchSwitcher, {});
			await userEvent.click(trigger());
			await userEvent.click(items()[1]);
			expect(menu()).toBeNull();
		});

		it("shows an animation rather than a word while it switches", async () => {
			let hold: () => void = () => {};
			checkoutBranch.mockReturnValue(
				new Promise<void>((resolve) => {
					hold = resolve;
				}),
			);
			render(BranchSwitcher, {});
			await userEvent.click(trigger());
			await userEvent.click(items()[1]);
			await tick();
			expect(trigger().querySelector(".spinner")).not.toBeNull();
			expect(trigger().disabled).toBe(true);
			hold();
		});
	});

	describe("when the checkout is refused", () => {
		/**
		 * A branch held by another worktree is an instance to open, and
		 * uncommitted changes are a choice to make, so both drop the store's
		 * banner in favour of a modal. Anything else stays in the banner.
		 */
		it("offers to open the instance holding the branch", async () => {
			instancesStore.set([
				instance("other", "p1", { worktreePath: "/worktrees/p1/other" }),
			]);
			checkoutBranch.mockRejectedValue(
				gitFailure(
					"fatal: 'develop' is already checked out at '/worktrees/p1/other'",
				),
			);
			render(BranchSwitcher, {});
			await userEvent.click(trigger());
			await userEvent.click(
				items().find((i) => i.textContent?.includes("develop")) as HTMLElement,
			);
			await settle();
			expect(clearGitError).toHaveBeenCalled();
			// The instance owning that worktree is matched on the path git
			// printed, and offered by name rather than as a raw path.
			expect(inUseModal()?.textContent).toContain("develop");
			expect(
				document.querySelectorAll(".modal-foot .btn").length,
			).toBeGreaterThan(1);
		});

		/** An unknown worktree has no instance to open, so none is offered. */
		it("offers no instance when no known worktree holds the branch", async () => {
			instancesStore.set([]);
			checkoutBranch.mockRejectedValue(
				gitFailure(
					"fatal: 'develop' is already checked out at '/somewhere/else'",
				),
			);
			render(BranchSwitcher, {});
			await userEvent.click(trigger());
			await userEvent.click(
				items().find((i) => i.textContent?.includes("develop")) as HTMLElement,
			);
			await settle();
			expect(inUseModal()).not.toBeNull();
			expect(document.querySelectorAll(".modal-foot .btn")).toHaveLength(1);
		});

		it("offers to stash when the worktree is dirty", async () => {
			checkoutBranch.mockRejectedValue(
				Object.assign(new Error("dirty"), {
					raw: "error: Your local changes would be overwritten",
					code: "dirty_worktree",
				}),
			);
			render(BranchSwitcher, {});
			await userEvent.click(trigger());
			await userEvent.click(items()[1]);
			await settle();
			expect(clearGitError).toHaveBeenCalled();
			expect(inUseModal()).not.toBeNull();
		});

		/** Anything else is left in the banner the store already raised. */
		it("leaves an unknown failure in the banner", async () => {
			checkoutBranch.mockRejectedValue(gitFailure("something else entirely"));
			render(BranchSwitcher, {});
			await userEvent.click(trigger());
			await userEvent.click(items()[1]);
			await settle();
			expect(clearGitError).not.toHaveBeenCalled();
			expect(inUseModal()).toBeNull();
		});

		it("becomes usable again after a failure", async () => {
			checkoutBranch.mockRejectedValue(gitFailure("nope"));
			render(BranchSwitcher, {});
			await userEvent.click(trigger());
			await userEvent.click(items()[1]);
			await settle();
			expect(trigger().disabled).toBe(false);
		});
	});

	describe("stashing to unblock the checkout", () => {
		async function reachDirtyModal() {
			checkoutBranch.mockRejectedValueOnce(
				Object.assign(new Error("dirty"), {
					raw: "error: Your local changes would be overwritten",
					code: "dirty_worktree",
				}),
			);
			render(BranchSwitcher, {});
			await userEvent.click(trigger());
			await userEvent.click(items()[1]);
			await settle();
		}

		it("stashes, then retries the checkout", async () => {
			await reachDirtyModal();
			checkoutBranch.mockResolvedValue(undefined);
			const stash = Array.from(
				document.querySelectorAll<HTMLElement>(".modal-foot .btn"),
			).pop() as HTMLElement;
			await userEvent.click(stash);
			await settle();
			expect(pushStash).toHaveBeenCalled();
			expect(checkoutBranch).toHaveBeenCalledTimes(2);
		});

		it("closes the modal once the retry succeeded", async () => {
			await reachDirtyModal();
			checkoutBranch.mockResolvedValue(undefined);
			const stash = Array.from(
				document.querySelectorAll<HTMLElement>(".modal-foot .btn"),
			).pop() as HTMLElement;
			await userEvent.click(stash);
			await settle();
			expect(inUseModal()).toBeNull();
		});

		it("stashes nothing when the modal is dismissed", async () => {
			await reachDirtyModal();
			const cancel = document.querySelector(
				".modal-foot .btn.ghost",
			) as HTMLElement;
			await userEvent.click(cancel);
			await settle();
			expect(pushStash).not.toHaveBeenCalled();
		});
	});
});
