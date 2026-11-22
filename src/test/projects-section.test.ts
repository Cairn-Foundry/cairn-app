// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { writable } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectFolder } from "#lib/types/project";

const unregisterProject = vi.fn<(...a: unknown[]) => unknown>();
const duplicateProjectInStore = vi.fn<(...a: unknown[]) => unknown>();
const reorderProjects = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("#lib/stores/project", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	unregisterProject: (...a: unknown[]) => unregisterProject(...a),
	duplicateProjectInStore: (...a: unknown[]) => duplicateProjectInStore(...a),
	reorderProjects: (...a: unknown[]) => reorderProjects(...a),
}));

const foldersState = writable<ProjectFolder[]>([]);
const addProjectToFolder = vi.fn<(...a: unknown[]) => unknown>();
const removeProjectFromFolder = vi.fn<(...a: unknown[]) => unknown>();
const reorderFolders = vi.fn<(...a: unknown[]) => unknown>();
const reorderProjectsInFolder = vi.fn<(...a: unknown[]) => unknown>();
const toggleCollapse = vi.fn<(...a: unknown[]) => unknown>();
const renameFolder = vi.fn<(...a: unknown[]) => unknown>();
const removeFolder = vi.fn<(...a: unknown[]) => unknown>();
const createFolder = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("#lib/stores/project-folders", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	projectFolders: {
		subscribe: foldersState.subscribe,
		addProjectToFolder: (...a: unknown[]) => addProjectToFolder(...a),
		removeProjectFromFolder: (...a: unknown[]) => removeProjectFromFolder(...a),
		reorderFolders: (...a: unknown[]) => reorderFolders(...a),
		reorderProjectsInFolder: (...a: unknown[]) => reorderProjectsInFolder(...a),
		toggleCollapse: (...a: unknown[]) => toggleCollapse(...a),
		rename: (...a: unknown[]) => renameFolder(...a),
		remove: (...a: unknown[]) => removeFolder(...a),
		create: (...a: unknown[]) => createFolder(...a),
	},
}));

const revealInFileManager = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("#lib/services/project-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	revealInFileManager: (...a: unknown[]) => revealInFileManager(...a),
}));

const projectInbox = writable<Record<string, unknown>>({});
const loadProjectInbox = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("#lib/stores/project-inbox", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	projectInbox: { subscribe: projectInbox.subscribe },
	loadProjectInbox: (...a: unknown[]) => loadProjectInbox(...a),
}));

const attentionByProject = writable<Record<string, number>>({});
vi.mock("#lib/stores/agent-status", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	attentionByProject: { subscribe: attentionByProject.subscribe },
}));

const settingsState = writable<Record<string, unknown>>({
	homeProjectsLayout: "list",
});
const saveSettings = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("#lib/stores/settings", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	settings: {
		subscribe: settingsState.subscribe,
		save: (...a: unknown[]) => saveSettings(...a),
	},
}));

const worktreeStates = writable<Record<string, unknown>>({});
const loadProjectOverview = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("#lib/stores/project-overview", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	worktreeStates: { subscribe: worktreeStates.subscribe },
	loadProjectOverview: (...a: unknown[]) => loadProjectOverview(...a),
}));

const loadedInstances = writable<Record<string, unknown[]>>({});
vi.mock("#lib/stores/instance", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	loadedInstances: { subscribe: loadedInstances.subscribe },
}));

const { projects, activeProjectId, openTabOrder } = await import(
	"#lib/stores/project"
);
const { ungroupedCollapsed } = await import("#lib/stores/project-folders");
const { project, instance } = await import("./fixtures");
const { default: ProjectsSection } = await import(
	"#lib/components/home/ProjectsSection.svelte"
);

function folder(id: string, projectIds: string[] = []): ProjectFolder {
	return { id, name: id, projectIds, collapsed: false } as ProjectFolder;
}

function mount() {
	const onOpenProject = vi.fn();
	const onAddProject = vi.fn();
	const onEditProject = vi.fn();
	const onCloseProject = vi.fn();
	render(ProjectsSection, {
		props: {},
		events: {
			openProject: (e: CustomEvent) => onOpenProject(e.detail),
			addProject: (e: CustomEvent) => onAddProject(e.detail),
			editProject: (e: CustomEvent) => onEditProject(e.detail),
			closeProject: (e: CustomEvent) => onCloseProject(e.detail),
		},
	});
	return { onOpenProject, onAddProject, onEditProject, onCloseProject };
}

const cards = () =>
	Array.from(
		document.querySelectorAll<HTMLElement>(".project-groups .project-card"),
	);
const cardNames = () =>
	cards().map((c) => c.querySelector(".pname")?.textContent?.trim());
const folderBlocks = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".folder-block"));
const cardsIn = (block: HTMLElement) =>
	Array.from(block.querySelectorAll<HTMLElement>(".project-card"));
const searchField = () =>
	document.querySelector(".search-input") as HTMLInputElement;
const menuItem = (re: RegExp) =>
	Array.from(document.querySelectorAll<HTMLElement>("button, .menu-item")).find(
		(b) => re.test(b.textContent ?? ""),
	) as HTMLElement;

function pointer(type: string, x: number, y: number) {
	return new PointerEvent(type, {
		bubbles: true,
		cancelable: true,
		clientX: x,
		clientY: y,
		pointerId: 1,
	});
}

/** Lays the ungrouped cards out in a single column so the grid math resolves. */
function layOutCards(container = ".projects-list") {
	const grid = document.querySelector(container) as HTMLElement;
	Array.from(grid.querySelectorAll<HTMLElement>(".project-card")).forEach(
		(card, i) => {
			card.getBoundingClientRect = () =>
				({
					top: i * 100,
					bottom: i * 100 + 100,
					left: 0,
					right: 200,
					width: 200,
					height: 100,
				}) as DOMRect;
		},
	);
}

async function settle() {
	for (let i = 0; i < 6; i++) await tick();
}

/** Drags a card to (x, y) and drops it, with elementFromPoint stubbed empty. */
async function dragCard(card: HTMLElement, x: number, y: number) {
	card.dispatchEvent(pointer("pointerdown", 0, 0));
	await settle();
	layOutCards();
	card.dispatchEvent(pointer("pointermove", x, y));
	await settle();
	card.dispatchEvent(pointer("pointerup", x, y));
	await settle();
}

afterEach(() => {
	vi.restoreAllMocks();
});

beforeEach(() => {
	vi.spyOn(Math, "random").mockReturnValue(0);
	Element.prototype.setPointerCapture = vi.fn();
	Element.prototype.releasePointerCapture = vi.fn();
	document.body.classList.remove("dragging");
	document.elementFromPoint = vi.fn(() => null);
	unregisterProject.mockReset().mockResolvedValue(undefined);
	duplicateProjectInStore.mockReset().mockResolvedValue(undefined);
	reorderProjects.mockReset();
	attentionByProject.set({});
	addProjectToFolder.mockReset();
	removeProjectFromFolder.mockReset();
	reorderFolders.mockReset();
	reorderProjectsInFolder.mockReset();
	toggleCollapse.mockReset();
	revealInFileManager.mockReset().mockResolvedValue(undefined);
	loadProjectInbox.mockReset().mockResolvedValue(undefined);
	projectInbox.set({});
	foldersState.set([]);
	ungroupedCollapsed.set(false);
	activeProjectId.set(null);
	openTabOrder.set([]);
	settingsState.set({ homeProjectsLayout: "list" });
	saveSettings.mockReset().mockResolvedValue(undefined);
	worktreeStates.set({});
	loadedInstances.set({});
	loadProjectOverview.mockReset().mockResolvedValue(undefined);
	projects.set([
		project("p1", { name: "Alpha", path: "/repos/alpha" }),
		project("p2", { name: "Beta", path: "/repos/beta" }),
	]);
	Object.assign(navigator, {
		clipboard: { writeText: vi.fn(async () => {}) },
	});
});

describe("ProjectsSection", () => {
	describe("the list", () => {
		it("lists every registered project", async () => {
			mount();
			await settle();
			expect(cardNames()).toEqual(["Alpha", "Beta"]);
		});

		it("opens the project that was clicked", async () => {
			const { onOpenProject } = mount();
			await settle();
			await userEvent.click(cards()[0]);
			expect(onOpenProject).toHaveBeenCalledWith("p1");
		});

		it("shows no agent status, even for a project a conversation waits on", async () => {
			attentionByProject.set({ p1: 2 });
			mount();
			await settle();
			expect(document.querySelector(".attention-pill")).toBeNull();
		});

		it("reads the unread count of every project", async () => {
			mount();
			await settle();
			expect(loadProjectInbox).toHaveBeenCalledWith("p1");
			expect(loadProjectInbox).toHaveBeenCalledWith("p2");
		});

		it("shows the unread count of a project that has one", async () => {
			projectInbox.set({ p1: { tickets: 3, hasMore: false } });
			mount();
			await settle();
			expect(cards()[0].querySelector(".tickets")).not.toBeNull();
			expect(cards()[1].querySelector(".tickets")).toBeNull();
		});
	});

	describe("searching", () => {
		it("keeps only the projects whose name matched", async () => {
			mount();
			await settle();
			await userEvent.type(searchField(), "Beta");
			await settle();
			expect(cardNames()).toEqual(["Beta"]);
		});

		/** The path is searchable too, not only the name. */
		it("keeps the projects whose path matched", async () => {
			mount();
			await settle();
			await userEvent.type(searchField(), "repos/alpha");
			await settle();
			expect(cardNames()).toEqual(["Alpha"]);
		});

		/** A search flattens the folders: every hit shows, wherever it lives. */
		it("shows a project inside a folder when it matched", async () => {
			foldersState.set([folder("f1", ["p1"])]);
			mount();
			await settle();
			await userEvent.type(searchField(), "Alpha");
			await settle();
			expect(cardNames()).toEqual(["Alpha"]);
			expect(folderBlocks()).toHaveLength(0);
		});

		it("shows the folders again once the search is cleared", async () => {
			foldersState.set([folder("f1", ["p1"])]);
			mount();
			await settle();
			await userEvent.type(searchField(), "Alpha");
			await settle();
			await userEvent.clear(searchField());
			await settle();
			expect(folderBlocks()).toHaveLength(1);
		});
	});

	describe("the folders", () => {
		it("shows a project inside the folder it belongs to", async () => {
			foldersState.set([folder("f1", ["p1"])]);
			mount();
			await settle();
			expect(
				cardsIn(folderBlocks()[0]).map((c) =>
					c.querySelector(".pname")?.textContent?.trim(),
				),
			).toEqual(["Alpha"]);
		});

		/** A project in a folder leaves the ungrouped grid. */
		it("keeps a grouped project out of the ungrouped grid", async () => {
			foldersState.set([folder("f1", ["p1"])]);
			mount();
			await settle();
			const grids = Array.from(
				document.querySelectorAll<HTMLElement>(".projects-list"),
			);
			const ungrouped = grids[grids.length - 1];
			expect(
				cardsIn(ungrouped).map((c) =>
					c.querySelector(".pname")?.textContent?.trim(),
				),
			).toEqual(["Beta"]);
		});

		/** A folder listing an id that no longer resolves simply skips it. */
		it("skips an id the folder still lists but no project has", async () => {
			foldersState.set([folder("f1", ["p1", "gone"])]);
			mount();
			await settle();
			expect(cardsIn(folderBlocks()[0])).toHaveLength(1);
		});

		it("orders a folder's projects the way the folder lists them", async () => {
			foldersState.set([folder("f1", ["p2", "p1"])]);
			mount();
			await settle();
			expect(
				cardsIn(folderBlocks()[0]).map((c) =>
					c.querySelector(".pname")?.textContent?.trim(),
				),
			).toEqual(["Beta", "Alpha"]);
		});
	});

	describe("the card menu", () => {
		it("opens on the card's own button", async () => {
			mount();
			await settle();
			await userEvent.click(
				cards()[0].querySelector(".card-more") as HTMLElement,
			);
			await settle();
			expect(document.querySelector(".card-menu")).not.toBeNull();
		});

		/** Opening the menu must not also open the project. */
		it("does not open the project when its menu is used", async () => {
			const { onOpenProject } = mount();
			await settle();
			await userEvent.click(
				cards()[0].querySelector(".card-more") as HTMLElement,
			);
			await settle();
			expect(onOpenProject).not.toHaveBeenCalled();
		});

		it("edits the project the menu belongs to", async () => {
			const { onEditProject } = mount();
			await settle();
			await userEvent.click(
				cards()[0].querySelector(".card-more") as HTMLElement,
			);
			await settle();
			await userEvent.click(menuItem(/edit|modifier/i));
			await settle();
			expect(onEditProject).toHaveBeenCalledWith(
				expect.objectContaining({ id: "p1" }),
			);
		});

		it("opens the copy dialog for the project the menu belongs to", async () => {
			mount();
			await settle();
			await userEvent.click(
				cards()[0].querySelector(".card-more") as HTMLElement,
			);
			await settle();
			await userEvent.click(menuItem(/duplicate|dupliquer/i));
			await settle();
			expect(document.body.textContent).toMatch(
				/Duplicate project|Dupliquer le projet/,
			);
			expect(duplicateProjectInStore).not.toHaveBeenCalled();
		});

		it("copies the project path", async () => {
			mount();
			await settle();
			await userEvent.click(
				cards()[0].querySelector(".card-more") as HTMLElement,
			);
			await settle();
			await userEvent.click(menuItem(/copy path|copier/i));
			await settle();
			expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
				"/repos/alpha",
			);
		});

		it("reveals the project in the file manager", async () => {
			mount();
			await settle();
			await userEvent.click(
				cards()[0].querySelector(".card-more") as HTMLElement,
			);
			await settle();
			await userEvent.click(menuItem(/reveal|finder|afficher/i));
			await settle();
			expect(revealInFileManager).toHaveBeenCalledWith("/repos/alpha");
		});

		it("asks before removing a project", async () => {
			mount();
			await settle();
			await userEvent.click(
				cards()[0].querySelector(".card-more") as HTMLElement,
			);
			await settle();
			await userEvent.click(menuItem(/delete|remove|supprimer/i));
			await settle();
			expect(unregisterProject).not.toHaveBeenCalled();
			expect(document.querySelector(".modal-backdrop")).not.toBeNull();
		});

		it("removes it once confirmed", async () => {
			mount();
			await settle();
			await userEvent.click(
				cards()[0].querySelector(".card-more") as HTMLElement,
			);
			await settle();
			await userEvent.click(menuItem(/delete|remove|supprimer/i));
			await settle();
			await userEvent.click(
				document.querySelector(".modal .cm-confirm") as HTMLElement,
			);
			await settle();
			expect(unregisterProject).toHaveBeenCalledWith("p1");
		});

		/** Only one menu at a time: opening another closes the first. */
		it("closes the menu of another card", async () => {
			mount();
			await settle();
			await userEvent.click(
				cards()[0].querySelector(".card-more") as HTMLElement,
			);
			await settle();
			await userEvent.click(
				cards()[1].querySelector(".card-more") as HTMLElement,
			);
			await settle();
			expect(
				document.querySelectorAll(".card-menu").length,
			).toBeLessThanOrEqual(1);
		});
	});

	describe("dragging a card", () => {
		/** Below the threshold the gesture is a click, not a drag. */
		it("treats a small movement as a click", async () => {
			const { onOpenProject } = mount();
			await settle();
			const card = cards()[0];
			card.dispatchEvent(pointer("pointerdown", 0, 0));
			await settle();
			card.dispatchEvent(pointer("pointermove", 2, 2));
			await settle();
			card.dispatchEvent(pointer("pointerup", 2, 2));
			await settle();
			await userEvent.click(card);
			expect(reorderProjects).not.toHaveBeenCalled();
			expect(onOpenProject).toHaveBeenCalledWith("p1");
		});

		it("reorders the ungrouped projects", async () => {
			mount();
			await settle();
			layOutCards();
			await dragCard(cards()[0], 100, 190);
			expect(reorderProjects).toHaveBeenCalledWith(["p2", "p1"]);
		});

		/**
		 * Moving a card forward into the middle: the insert index counts the
		 * slot before the card is lifted out, so it has to shift by one.
		 * Dropping onto the end hides the bug, since both indexes append.
		 */
		it("lands a card moved forward at the right slot", async () => {
			projects.set([
				project("p1", { name: "A", path: "/a" }),
				project("p2", { name: "B", path: "/b" }),
				project("p3", { name: "C", path: "/c" }),
				project("p4", { name: "D", path: "/d" }),
			]);
			mount();
			await settle();
			layOutCards();
			await dragCard(cards()[0], 10, 240);
			expect(reorderProjects).toHaveBeenCalledWith(["p2", "p1", "p3", "p4"]);
		});

		it("lands a card moved backward at the right slot", async () => {
			projects.set([
				project("p1", { name: "Alpha", path: "/a" }),
				project("p2", { name: "Beta", path: "/b" }),
				project("p3", { name: "Gamma", path: "/c" }),
			]);
			mount();
			await settle();
			layOutCards();
			await dragCard(cards()[2], 10, -5);
			expect(reorderProjects).toHaveBeenCalledWith(["p3", "p1", "p2"]);
		});

		/** A drop back where the card started rewrites nothing. */
		it("rewrites nothing when dropped on itself", async () => {
			mount();
			await settle();
			layOutCards();
			await dragCard(cards()[0], 10, 10);
			expect(reorderProjects).not.toHaveBeenCalled();
		});

		/** The click that ends a drag must not open the project. */
		it("does not open the project on the click that ends a drag", async () => {
			const { onOpenProject } = mount();
			await settle();
			layOutCards();
			const card = cards()[0];
			await dragCard(card, 100, 190);
			card.dispatchEvent(new MouseEvent("click", { bubbles: true }));
			await settle();
			expect(onOpenProject).not.toHaveBeenCalled();
		});

		it("clears the dragging cursor once dropped", async () => {
			mount();
			await settle();
			layOutCards();
			await dragCard(cards()[0], 100, 190);
			expect(document.body.classList.contains("dragging")).toBe(false);
		});

		/** Dropping a card on a folder moves it into that folder. */
		it("moves a card dropped on a folder into it", async () => {
			foldersState.set([folder("f1", [])]);
			mount();
			await settle();
			const block = folderBlocks()[0];
			document.elementFromPoint = vi.fn(() => block);
			await dragCard(cards()[0], 300, 300);
			expect(addProjectToFolder).toHaveBeenCalledWith("p1", "f1");
			expect(reorderProjects).not.toHaveBeenCalled();
		});

		/**
		 * A card dropped on the folder it is already in changes nothing. The
		 * pointermove pass already refuses to mark the source folder as a drop
		 * target, so the `alreadyInFolder` check on drop is a second line of
		 * defence rather than the one that fires.
		 */
		it("leaves a card dropped on its own folder alone", async () => {
			foldersState.set([folder("f1", ["p1"])]);
			mount();
			await settle();
			const block = folderBlocks()[0];
			document.elementFromPoint = vi.fn(() => block);
			const card = cardsIn(block)[0];
			card.dispatchEvent(pointer("pointerdown", 0, 0));
			await settle();
			card.dispatchEvent(pointer("pointermove", 300, 300));
			await settle();
			card.dispatchEvent(pointer("pointerup", 300, 300));
			await settle();
			expect(addProjectToFolder).not.toHaveBeenCalled();
		});

		/** Dragging a grouped card onto the ungrouped area takes it out. */
		it("takes a card dropped on the ungrouped area out of its folder", async () => {
			foldersState.set([folder("f1", ["p1"])]);
			mount();
			await settle();
			const zone = document.querySelector(
				"[data-drop-ungrouped]",
			) as HTMLElement;
			document.elementFromPoint = vi.fn(() => zone);
			const card = cardsIn(folderBlocks()[0])[0];
			card.dispatchEvent(pointer("pointerdown", 0, 0));
			await settle();
			card.dispatchEvent(pointer("pointermove", 300, 300));
			await settle();
			card.dispatchEvent(pointer("pointerup", 300, 300));
			await settle();
			expect(removeProjectFromFolder).toHaveBeenCalledWith("p1");
		});

		/**
		 * An ungrouped card dropped on the ungrouped area is a plain reorder.
		 * The pointermove pass only ever marks that zone for a card coming out
		 * of a folder, so the `ctx.type === 'folder'` check on drop is a second
		 * line of defence rather than the one that fires.
		 */
		it("reorders rather than un-groups a card that was never grouped", async () => {
			mount();
			await settle();
			const zone = document.querySelector("[data-drop-ungrouped]");
			document.elementFromPoint = vi.fn(() => zone);
			layOutCards();
			await dragCard(cards()[0], 100, 190);
			expect(removeProjectFromFolder).not.toHaveBeenCalled();
			expect(reorderProjects).toHaveBeenCalledWith(["p2", "p1"]);
		});
	});

	describe("the quick actions", () => {
		const clickActions = async () => {
			const actions = Array.from(
				document.querySelectorAll<HTMLElement>(".home-action"),
			);
			for (const action of actions) await userEvent.click(action);
		};

		it("asks for a project of the kind that was chosen", async () => {
			const { onAddProject } = mount();
			await settle();
			await clickActions();
			expect(onAddProject.mock.calls.map((c) => c[0])).toEqual([
				"new",
				"open",
				"clone",
			]);
		});

		it("keeps the same choices while there is no project", async () => {
			projects.set([]);
			const { onAddProject } = mount();
			await settle();
			await clickActions();
			expect(onAddProject.mock.calls.map((c) => c[0])).toEqual([
				"new",
				"open",
				"clone",
			]);
		});

		it("draws the empty state when there is no project", async () => {
			projects.set([]);
			mount();
			await settle();
			expect(document.querySelector(".projects-empty h2")?.textContent).toBe(
				"No projects yet",
			);
		});

		it("draws the no-match state and clears the search from it", async () => {
			mount();
			await settle();
			const input = document.querySelector<HTMLInputElement>(".search-input");
			if (!input) throw new Error("no search input");
			await userEvent.type(input, "zzz");
			await settle();
			expect(
				document.querySelector(".search-empty p")?.textContent,
			).toContain('"zzz"');
			await userEvent.click(
				document.querySelector(".search-empty .btn") as HTMLElement,
			);
			await settle();
			expect(input.value).toBe("");
			expect(cards()).toHaveLength(2);
		});

		it("hides the choices during a search", async () => {
			mount();
			await settle();
			const input = document.querySelector<HTMLInputElement>(".search-input");
			if (!input) throw new Error("no search input");
			await userEvent.type(input, "cairn");
			await settle();
			expect(document.querySelector(".home-actions")).toBeNull();
		});
	});

	describe("the layout", () => {
		it("draws the projects as rows by default", async () => {
			mount();
			await settle();
			expect(document.querySelector(".projects-list")).not.toBeNull();
			expect(document.querySelector(".projects-compact")).toBeNull();
		});

		it("draws the projects as cards once the setting asks for it", async () => {
			settingsState.set({ homeProjectsLayout: "grid" });
			mount();
			await settle();
			expect(document.querySelector(".projects-compact")).not.toBeNull();
			expect(document.querySelector(".projects-list")).toBeNull();
		});

		it("saves the layout that was picked", async () => {
			mount();
			await settle();
			await userEvent.click(
				document.querySelector(
					".mode-toggle [aria-pressed='false']",
				) as HTMLElement,
			);
			expect(saveSettings).toHaveBeenCalledWith({ homeProjectsLayout: "grid" });
		});
	});

	describe("what a project shows", () => {
		function worktree(overrides: Record<string, unknown> = {}) {
			return {
				isGitRepo: true,
				branch: "main",
				added: 0,
				removed: 0,
				...overrides,
			};
		}

		const worktreeTexts = (card: HTMLElement) =>
			Array.from(card.querySelectorAll<HTMLElement>(".worktree")).map((w) =>
				w.textContent?.replace(/\s+/g, " ").trim(),
			);

		it("reads the overview of every project", async () => {
			mount();
			await settle();
			expect(
				loadProjectOverview.mock.calls.map((c) => (c[0] as { id: string }).id),
			).toEqual(["p1", "p2"]);
		});

		it("shows the repository branch with the lines added and removed", async () => {
			worktreeStates.set({
				"p1:__base__": worktree({ added: 120, removed: 4 }),
			});
			mount();
			await settle();
			expect(worktreeTexts(cards()[0])).toEqual(["main +120 -4"]);
			expect(worktreeTexts(cards()[1])).toEqual([]);
		});

		it("stays quiet about a clean repository in step with its upstream", async () => {
			worktreeStates.set({ "p1:__base__": worktree() });
			mount();
			await settle();
			expect(worktreeTexts(cards()[0])).toEqual(["main"]);
		});

		it("lays out the repository and the first instances, counting the ones never read", async () => {
			worktreeStates.set({
				"p1:__base__": worktree(),
				"p1:i1": worktree({ branch: "feat/a", added: 2, removed: 1 }),
			});
			loadedInstances.set({
				p1: [
					instance("i1", "p1", { branch: "feat/a" }),
					instance("i2", "p1", { branch: "feat/b" }),
					instance("i3", "p1", { branch: "feat/c" }),
					instance("i4", "p1", { branch: "feat/d" }),
					instance("i5", "p1", { branch: "feat/e" }),
					instance("i6", "p1", { branch: "feat/f", status: "done" }),
				],
			});
			mount();
			await settle();
			expect(worktreeTexts(cards()[0])).toEqual([
				"main",
				"feat/a +2 -1",
				"feat/b",
				"feat/c",
				"feat/d",
			]);
			const others = cards()[0].querySelector(".others") as HTMLElement;
			expect(others.getAttribute("title")?.split("\n")).toContain("feat/e");
		});

		it("says when a folder is not a git repository", async () => {
			worktreeStates.set({
				"p1:__base__": worktree({ isGitRepo: false, branch: "" }),
			});
			mount();
			await settle();
			expect(cards()[0].querySelector(".no-git")).not.toBeNull();
			expect(worktreeTexts(cards()[0])).toEqual([]);
			expect(cards()[1].querySelector(".no-git")).toBeNull();
		});

		it("draws no ticket tag for a count of zero", async () => {
			projectInbox.set({
				p1: { tickets: 0, hasMore: false },
				p2: { tickets: 2, hasMore: false },
			});
			mount();
			await settle();
			expect(cards()[0].querySelector(".tickets")).toBeNull();
			expect(cards()[1].querySelector(".tickets")?.textContent).toBe("2");
		});

		it.each(["list", "grid"] as const)(
			"shows no Open tag in the %s view",
			async (layout) => {
				settingsState.set({ homeProjectsLayout: layout });
				openTabOrder.set(["p2"]);
				mount();
				await settle();
				expect(cards()[1].querySelector(".open-tag")).toBeNull();
			},
		);

		it("does not open the project when Enter lands on one of its buttons", async () => {
			const { onOpenProject } = mount();
			await settle();
			const more = cards()[0].querySelector(".card-more") as HTMLElement;
			more.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			);
			await settle();
			expect(onOpenProject).not.toHaveBeenCalled();
			cards()[0].dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			);
			expect(onOpenProject).toHaveBeenCalledWith("p1");
		});
	});

	describe("the row actions", () => {
		it("edits the project from its own button", async () => {
			const { onEditProject, onOpenProject } = mount();
			await settle();
			await userEvent.click(
				cards()[1].querySelector('[aria-label="Edit"]') as HTMLElement,
			);
			expect(onEditProject).toHaveBeenCalledWith(
				expect.objectContaining({ id: "p2" }),
			);
			expect(onOpenProject).not.toHaveBeenCalled();
		});

		it("reveals the project from its own button", async () => {
			const { onOpenProject } = mount();
			await settle();
			await userEvent.click(
				cards()[0].querySelector('[aria-label="Reveal"]') as HTMLElement,
			);
			expect(revealInFileManager).toHaveBeenCalledWith("/repos/alpha");
			expect(onOpenProject).not.toHaveBeenCalled();
		});

		it("draws edit and reveal before the menu in the cards view too", async () => {
			settingsState.set({ homeProjectsLayout: "grid" });
			mount();
			await settle();
			const labels = Array.from(
				cards()[0].querySelectorAll<HTMLElement>(".end button"),
			).map((b) => b.getAttribute("aria-label"));
			expect(labels.slice(0, 2)).toEqual(["Edit", "Reveal"]);
			expect(
				cards()[0].querySelector(".end button:last-child")?.className,
			).toContain("card-more");
		});
	});

	describe("the projects outside any folder", () => {
		it("fold under their title like a folder does", async () => {
			foldersState.set([folder("f1", ["p1"])]);
			mount();
			await settle();
			const toggle = document.querySelector(
				".group-title .chevron-btn",
			) as HTMLElement;
			await userEvent.click(toggle);
			expect(cardNames()).toEqual(["Alpha"]);
			expect(toggle.getAttribute("aria-expanded")).toBe("false");
			await userEvent.click(toggle);
			expect(cardNames()).toEqual(["Alpha", "Beta"]);
		});

		it("fold from a click anywhere on their title", async () => {
			foldersState.set([folder("f1", ["p1"])]);
			mount();
			await settle();
			const name = document.querySelector(
				".group-title.is-toggle .group-name",
			) as HTMLElement;
			await userEvent.click(name);
			expect(cardNames()).toEqual(["Alpha"]);
			await userEvent.click(name);
			expect(cardNames()).toEqual(["Alpha", "Beta"]);
		});
	});

	describe("the open projects", () => {
		const openNames = () =>
			Array.from(
				document.querySelectorAll<HTMLElement>(".open-projects .pname"),
			).map((n) => n.textContent);

		it("lists every open project, in tab order, above the projects", async () => {
			openTabOrder.set(["p2", "p1"]);
			mount();
			await settle();
			expect(openNames()).toEqual(["Beta", "Alpha"]);
		});

		it("is left out when no project is open", async () => {
			mount();
			await settle();
			expect(document.querySelector(".open-projects")).toBeNull();
		});

		it("shows in the cards view too", async () => {
			settingsState.set({ homeProjectsLayout: "grid" });
			openTabOrder.set(["p1"]);
			mount();
			await settle();
			expect(openNames()).toEqual(["Alpha"]);
		});

		it("steps aside while searching", async () => {
			openTabOrder.set(["p1"]);
			mount();
			await settle();
			await userEvent.type(searchField(), "Al");
			await settle();
			expect(document.querySelector(".open-projects")).toBeNull();
		});

		it("opens the project that was clicked", async () => {
			openTabOrder.set(["p2"]);
			const { onOpenProject } = mount();
			await settle();
			await userEvent.click(
				document.querySelector(".open-projects .project-card") as HTMLElement,
			);
			expect(onOpenProject).toHaveBeenCalledWith("p2");
		});

		it("closes a project from its own button", async () => {
			openTabOrder.set(["p2"]);
			const { onCloseProject, onOpenProject } = mount();
			await settle();
			await userEvent.click(
				document.querySelector(
					'.open-projects [aria-label="Close the project"]',
				) as HTMLElement,
			);
			expect(onCloseProject).toHaveBeenCalledWith("p2");
			expect(onOpenProject).not.toHaveBeenCalled();
		});

		it("opens one menu only, beside the card it was asked from", async () => {
			openTabOrder.set(["p1"]);
			mount();
			await settle();
			await userEvent.click(
				document.querySelector(".open-projects .card-more") as HTMLElement,
			);
			await settle();
			expect(document.querySelectorAll(".card-menu").length).toBe(1);
			expect(
				document.querySelector(".open-projects .card-menu"),
			).not.toBeNull();
		});
	});
});
