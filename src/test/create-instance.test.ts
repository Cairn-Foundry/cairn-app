// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Instance } from "$lib/types/instance";
import type { Ticket } from "$lib/types/integrations";

const spawnInstance = vi.fn<(...a: unknown[]) => unknown>();
const instancesStore = writable<Instance[]>([]);
vi.mock("$lib/stores/instance", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	instances: { subscribe: instancesStore.subscribe },
	spawnInstance: (...a: unknown[]) => spawnInstance(...a),
}));

const listBranchesDetailed = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/services/instance-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	listBranchesDetailed: (...a: unknown[]) => listBranchesDetailed(...a),
}));

const gitFetch = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/services/git-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	fetch: (...a: unknown[]) => gitFetch(...a),
}));

const capabilitiesOf = vi.fn<(...a: unknown[]) => unknown>();
const loadProjectIntegrations = vi.fn<(...a: unknown[]) => unknown>();
const projectBindings = writable<Record<string, unknown>>({
	tracker: null,
	autoTransition: {},
});
vi.mock("$lib/stores/integrations", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	capabilitiesOf: (...a: unknown[]) => capabilitiesOf(...a),
	loadProjectIntegrations: (...a: unknown[]) => loadProjectIntegrations(...a),
	projectBindings: { subscribe: projectBindings.subscribe },
}));

const ticketSearch = writable({
	query: { scope: "assigned", text: "", page: 1 },
	results: [] as Ticket[],
	hasMore: false,
	isSearching: false,
	error: null as { message: string } | null,
});
const searchTickets = vi.fn<(...a: unknown[]) => unknown>();
const resolveTicketInput = vi.fn<(...a: unknown[]) => unknown>();
const setTicket = vi.fn<(...a: unknown[]) => unknown>();
const transitionTicketToStatus = vi.fn<(...a: unknown[]) => unknown>();
const resetTicketSearch = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/stores/tracker", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	ticketSearch: { subscribe: ticketSearch.subscribe },
	searchTickets: (...a: unknown[]) => searchTickets(...a),
	resolveTicketInput: (...a: unknown[]) => resolveTicketInput(...a),
	setTicket: (...a: unknown[]) => setTicket(...a),
	transitionTicketToStatus: (...a: unknown[]) => transitionTicketToStatus(...a),
	resetTicketSearch: (...a: unknown[]) => resetTicketSearch(...a),
}));

const settingsState = writable<Record<string, unknown>>({});
vi.mock("$lib/stores/settings", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	settings: { subscribe: settingsState.subscribe },
}));

const { projects, activeProjectId } = await import("$lib/stores/project");
const { project, instance } = await import("./fixtures");
const { default: CreateInstance } = await import(
	"$lib/components/CreateInstance.svelte"
);

function ticket(overrides: Partial<Ticket> = {}): Ticket {
	return {
		id: "1",
		key: "CAIRN-42",
		title: "Fix the parser",
		description: "",
		status: "To do",
		statusCategory: "todo",
		kind: "bug",
		labels: [],
		assignees: [],
		url: "https://tracker/CAIRN-42",
		updatedAt: "2026-01-01T00:00:00Z",
		...overrides,
	} as Ticket;
}

function mount(props: Record<string, unknown> = {}) {
	const onCreate = vi.fn();
	const onClose = vi.fn();
	render(CreateInstance, {
		props: { initialBranch: "", ...props },
		events: {
			create: (e: CustomEvent) => onCreate(e.detail),
			close: () => onClose(),
		},
	});
	return { onCreate, onClose };
}

const primary = () =>
	document.querySelector(".modal-foot .btn.primary") as HTMLButtonElement;
const backButton = () =>
	document.querySelector(".modal-foot .btn.ghost") as HTMLButtonElement;
const field = (id: string) =>
	document.getElementById(id) as HTMLInputElement | null;
const stepLabel = () =>
	document.querySelector(".step-count")?.textContent ?? "";
const modeCards = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".mode-card"));
const branchItems = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".branch-item"));
const branchNames = () =>
	branchItems().map((b) =>
		b.querySelector(".branch-name")?.textContent?.trim(),
	);
const ticketItems = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".ticket-item"));
const tabs = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".ticket-tab"));
const fieldError = () =>
	document.querySelector(".field-error")?.textContent ?? "";
const branchSearch = () =>
	document.querySelector(".branch-search") as HTMLInputElement;

async function settle() {
	for (let i = 0; i < 8; i++) await tick();
}

async function fill(input: HTMLInputElement, value: string) {
	await userEvent.clear(input);
	await userEvent.type(input, value);
}

/** Fills the ticket step by hand and moves to the mode step. */
async function toModeStep() {
	await fill(field("ticket-id") as HTMLInputElement, "CAIRN-42");
	await fill(field("ticket-title") as HTMLInputElement, "Fix the parser");
	await userEvent.click(primary());
	await settle();
}

async function toBranchStep() {
	await toModeStep();
	await userEvent.click(primary());
	await settle();
}

beforeEach(() => {
	vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
		fn(0);
		return 0;
	});
	spawnInstance.mockReset().mockResolvedValue({ id: "new-i", projectId: "p1" });
	listBranchesDetailed
		.mockReset()
		.mockResolvedValue({ local: ["main", "develop"], remote: ["origin/main"] });
	gitFetch.mockReset().mockResolvedValue(undefined);
	capabilitiesOf.mockReset().mockReturnValue({ tracker: null });
	loadProjectIntegrations.mockReset().mockResolvedValue(undefined);
	searchTickets.mockReset().mockResolvedValue(undefined);
	resolveTicketInput.mockReset().mockResolvedValue(null);
	setTicket.mockReset();
	transitionTicketToStatus.mockReset().mockResolvedValue(undefined);
	resetTicketSearch.mockReset();
	projectBindings.set({ tracker: null, autoTransition: {} });
	ticketSearch.set({
		query: { scope: "assigned", text: "", page: 1 },
		results: [],
		hasMore: false,
		isSearching: false,
		error: null,
	});
	instancesStore.set([]);
	projects.set([project("p1", { path: "/repo" })]);
	activeProjectId.set("p1");
	settingsState.set({ branchTemplate: "feat/{{slug}}" });
});

describe("CreateInstance", () => {
	describe("the ticket step", () => {
		it("needs both an id and a title before going on", async () => {
			mount();
			await settle();
			expect(primary().disabled).toBe(true);
			await fill(field("ticket-id") as HTMLInputElement, "CAIRN-42");
			expect(primary().disabled).toBe(true);
			await fill(field("ticket-title") as HTMLInputElement, "Fix it");
			expect(primary().disabled).toBe(false);
		});

		it("refuses an id of spaces only", async () => {
			mount();
			await settle();
			await fill(field("ticket-id") as HTMLInputElement, "   ");
			await fill(field("ticket-title") as HTMLInputElement, "Fix it");
			expect(primary().disabled).toBe(true);
		});

		/** Without a tracker there is nothing to pick a ticket from. */
		it("offers no ticket picker without a tracker", async () => {
			mount();
			await settle();
			expect(tabs()).toHaveLength(0);
		});

		it("offers the picker when a tracker is bound", async () => {
			capabilitiesOf.mockReturnValue({ tracker: { kind: "jira" } });
			mount();
			await settle();
			expect(tabs()).toHaveLength(2);
			expect(searchTickets).toHaveBeenCalled();
		});
	});

	describe("picking a ticket", () => {
		beforeEach(() => {
			capabilitiesOf.mockReturnValue({ tracker: { kind: "jira" } });
			ticketSearch.update((s) => ({ ...s, results: [ticket()] }));
		});

		it("fills the ticket in from the one that was picked", async () => {
			mount();
			await settle();
			await userEvent.click(ticketItems()[0]);
			await settle();
			expect(
				document.querySelector(".selected-ticket .ticket-key")?.textContent,
			).toBe("CAIRN-42");
			expect(primary().disabled).toBe(false);
		});

		it("clears the ticket on request", async () => {
			mount();
			await settle();
			await userEvent.click(ticketItems()[0]);
			await settle();
			await userEvent.click(
				document.querySelector(".selected-ticket .btn.ghost") as HTMLElement,
			);
			await settle();
			expect(document.querySelector(".selected-ticket")).toBeNull();
			expect(primary().disabled).toBe(true);
		});

		/** A ticket already used by an instance is not offered again. */
		it("hides a ticket another instance already uses", async () => {
			instancesStore.set([
				instance("i1", "p1", {
					ticket: { id: "1", title: "Fix the parser", key: "CAIRN-42" },
				}),
			]);
			mount();
			await settle();
			expect(ticketItems()).toHaveLength(0);
		});

		it("lists the tickets already taken in their own tab", async () => {
			instancesStore.set([
				instance("i1", "p1", {
					ticket: { id: "1", title: "Fix the parser", key: "CAIRN-42" },
				}),
			]);
			mount();
			await settle();
			await userEvent.click(
				document.querySelector(".assigned-toggle") as HTMLElement,
			);
			await settle();
			expect(ticketItems()).toHaveLength(1);
		});

		/** The same ticket on two instances is still one row. */
		it("lists a repeated ticket once", async () => {
			instancesStore.set([
				instance("i1", "p1", {
					ticket: { id: "1", title: "Fix the parser", key: "CAIRN-42" },
				}),
				instance("i2", "p1", {
					ticket: { id: "1", title: "Fix the parser", key: "CAIRN-42" },
				}),
			]);
			mount();
			await settle();
			await userEvent.click(
				document.querySelector(".assigned-toggle") as HTMLElement,
			);
			await settle();
			expect(ticketItems()).toHaveLength(1);
		});

		it("searches the scope that was chosen", async () => {
			mount();
			await settle();
			searchTickets.mockClear();
			await userEvent.click(
				Array.from(document.querySelectorAll<HTMLElement>(".ticket-scope"))[2],
			);
			await settle();
			expect(searchTickets.mock.calls[0][1]).toMatchObject({ scope: "all" });
		});

		/** A pasted reference is resolved rather than searched for. */
		it("resolves a pasted ticket reference", async () => {
			resolveTicketInput.mockResolvedValue(ticket({ key: "CAIRN-9" }));
			mount();
			await settle();
			const input = branchSearch();
			input.focus();
			await userEvent.paste("CAIRN-9");
			input.dispatchEvent(new Event("change", { bubbles: true }));
			await settle();
			expect(resolveTicketInput).toHaveBeenCalledWith("p1", "CAIRN-9");
		});

		it("shows what the tracker refused", async () => {
			ticketSearch.update((s) => ({
				...s,
				results: [],
				error: { message: "token expired" },
			}));
			mount();
			await settle();
			expect(document.body.textContent).toContain("token expired");
		});

		/** Switching back to the manual tab drops the ticket that was picked. */
		it("drops the picked ticket when switching to manual", async () => {
			mount();
			await settle();
			await userEvent.click(ticketItems()[0]);
			await settle();
			await userEvent.click(tabs()[1]);
			await settle();
			expect((field("ticket-id") as HTMLInputElement).value).toBe("");
		});
	});

	describe("the branches", () => {
		it("loads the branches of the repository", async () => {
			mount();
			await settle();
			expect(listBranchesDetailed).toHaveBeenCalledWith("/repo");
		});

		it("fetches before listing them", async () => {
			mount();
			await settle();
			expect(gitFetch).toHaveBeenCalledWith("/repo");
		});

		/** A repository without git offers neither mode. */
		it("refuses to go on when the folder is not a repository", async () => {
			listBranchesDetailed.mockRejectedValue(new Error("not a repo"));
			mount();
			await settle();
			await toModeStep();
			expect(primary().disabled).toBe(true);
		});

		it("picks main as the base branch when it exists", async () => {
			mount();
			await settle();
			await toBranchStep();
			expect(
				branchItems().find((b) => b.classList.contains("active"))?.textContent,
			).toContain("main");
		});

		it("falls back to master when there is no main", async () => {
			listBranchesDetailed.mockResolvedValue({
				local: ["master", "dev"],
				remote: [],
			});
			mount();
			await settle();
			await toBranchStep();
			expect(
				branchItems().find((b) => b.classList.contains("active"))?.textContent,
			).toContain("master");
		});

		it("falls back to the first branch when there is neither", async () => {
			listBranchesDetailed.mockResolvedValue({
				local: ["trunk", "dev"],
				remote: [],
			});
			mount();
			await settle();
			await toBranchStep();
			expect(
				branchItems().find((b) => b.classList.contains("active"))?.textContent,
			).toContain("trunk");
		});

		it("keeps only the branches the search matched", async () => {
			mount();
			await settle();
			await toBranchStep();
			await userEvent.type(branchSearch(), "deve");
			await settle();
			expect(branchNames()).toEqual(["develop"]);
		});

		it("says when no branch matched", async () => {
			mount();
			await settle();
			await toBranchStep();
			await userEvent.type(branchSearch(), "zzz");
			await settle();
			expect(document.querySelector(".branch-empty")).not.toBeNull();
		});

		it("reloads the branches on request", async () => {
			mount();
			await settle();
			await toBranchStep();
			listBranchesDetailed.mockClear();
			await userEvent.click(
				document.querySelector(".branch-refresh") as HTMLElement,
			);
			await settle();
			expect(listBranchesDetailed).toHaveBeenCalledTimes(1);
		});
	});

	describe("naming the branch", () => {
		it("derives the branch name from the ticket", async () => {
			mount();
			await settle();
			await toBranchStep();
			expect((field("branch-name") as HTMLInputElement).value).toBe(
				"feat/cairn-42",
			);
		});

		it("follows the configured branch template for a picked ticket", async () => {
			capabilitiesOf.mockReturnValue({ tracker: { kind: "jira" } });
			ticketSearch.update((s) => ({ ...s, results: [ticket()] }));
			settingsState.set({ branchTemplate: "{{kind}}/{{key}}" });
			mount();
			await settle();
			await userEvent.click(ticketItems()[0]);
			await settle();
			await userEvent.click(primary());
			await settle();
			await userEvent.click(primary());
			await settle();
			expect((field("branch-name") as HTMLInputElement).value).toBe(
				"bug/cairn-42",
			);
		});

		/**
		 * A name the user typed is never overwritten, even when the ticket it
		 * was derived from changes afterwards.
		 */
		it("leaves a branch name the user typed alone", async () => {
			mount();
			await settle();
			await toBranchStep();
			await fill(field("branch-name") as HTMLInputElement, "mine");
			await userEvent.click(backButton());
			await settle();
			await userEvent.click(backButton());
			await settle();
			await fill(field("ticket-id") as HTMLInputElement, "CAIRN-99");
			await userEvent.click(primary());
			await settle();
			await userEvent.click(primary());
			await settle();
			expect((field("branch-name") as HTMLInputElement).value).toBe("mine");
		});

		/** A name still matching the template does follow the ticket. */
		it("re-derives a name the user never touched", async () => {
			mount();
			await settle();
			await toBranchStep();
			await userEvent.click(backButton());
			await settle();
			await userEvent.click(backButton());
			await settle();
			await fill(field("ticket-id") as HTMLInputElement, "CAIRN-99");
			await userEvent.click(primary());
			await settle();
			await userEvent.click(primary());
			await settle();
			expect((field("branch-name") as HTMLInputElement).value).toBe(
				"feat/cairn-99",
			);
		});

		/** Two instances cannot share a branch. */
		it("refuses a branch another instance already has", async () => {
			instancesStore.set([instance("i1", "p1", { branch: "feat/cairn-42" })]);
			mount();
			await settle();
			await toBranchStep();
			expect(primary().disabled).toBe(true);
			expect(fieldError()).not.toBe("");
		});

		it("allows a branch nothing else uses", async () => {
			instancesStore.set([instance("i1", "p1", { branch: "other" })]);
			mount();
			await settle();
			await toBranchStep();
			expect(primary().disabled).toBe(false);
		});
	});

	describe("using an existing branch", () => {
		async function toExistingStep() {
			await toModeStep();
			await userEvent.click(modeCards()[1]);
			await settle();
			await userEvent.click(primary());
			await settle();
		}

		it("refuses to go on before a branch is chosen", async () => {
			mount();
			await settle();
			await toExistingStep();
			expect(primary().disabled).toBe(true);
		});

		it("allows it once a branch is chosen", async () => {
			mount();
			await settle();
			await toExistingStep();
			await userEvent.click(branchItems()[0]);
			await settle();
			expect(primary().disabled).toBe(false);
		});

		/** A local branch already taken cannot even be picked. */
		it("refuses to offer a local branch another instance uses", async () => {
			instancesStore.set([instance("i1", "p1", { branch: "develop" })]);
			mount();
			await settle();
			await toExistingStep();
			const taken = branchItems().find(
				(b) => b.textContent?.trim() === "develop",
			) as HTMLButtonElement;
			expect(taken.disabled).toBe(true);
		});

		/**
		 * A remote branch can be picked, but it is checked out under its local
		 * name - so one already in use must still be refused.
		 */
		it("refuses a remote branch whose local name is in use", async () => {
			listBranchesDetailed.mockResolvedValue({
				local: ["main"],
				remote: ["origin/develop"],
			});
			instancesStore.set([instance("i1", "p1", { branch: "develop" })]);
			mount();
			await settle();
			await toExistingStep();
			const remote = branchItems().find(
				(b) => b.textContent?.trim() === "origin/develop",
			) as HTMLElement;
			await userEvent.click(remote);
			await settle();
			expect(primary().disabled).toBe(true);
		});

		it("allows a branch nothing else uses", async () => {
			instancesStore.set([instance("i1", "p1", { branch: "develop" })]);
			mount();
			await settle();
			await toExistingStep();
			const free = branchItems().find(
				(b) => b.textContent?.trim() === "main",
			) as HTMLElement;
			await userEvent.click(free);
			await settle();
			expect(primary().disabled).toBe(false);
		});

		/** A remote branch is checked out under its local name. */
		it("links a remote branch under its local name", async () => {
			mount();
			await settle();
			await toExistingStep();
			const remote = branchItems().find((b) =>
				b.textContent?.includes("origin/main"),
			) as HTMLElement;
			await userEvent.click(remote);
			await settle();
			await userEvent.click(primary());
			await settle();
			expect(spawnInstance.mock.calls[0][0]).toMatchObject({
				branch: "origin/main",
				linkExisting: true,
			});
		});

		/**
		 * The base of a linked branch is never the branch itself: that compares a
		 * branch with itself and every diff of the instance comes out empty.
		 */
		it("never bases a linked branch on itself", async () => {
			mount();
			await settle();
			await toExistingStep();
			const remote = branchItems().find((b) =>
				b.textContent?.includes("origin/main"),
			) as HTMLElement;
			await userEvent.click(remote);
			await settle();
			await userEvent.click(primary());
			await settle();
			const sent = spawnInstance.mock.calls[0][0] as {
				branch: string;
				baseBranch: string;
			};
			expect(sent.baseBranch).not.toBe(sent.branch);
			expect(sent.baseBranch).not.toBe("main");
		});
	});

	describe("creating", () => {
		it("spawns the instance on the chosen branches", async () => {
			const { onCreate } = mount();
			await settle();
			await toBranchStep();
			await userEvent.click(primary());
			await settle();
			expect(spawnInstance.mock.calls[0][0]).toMatchObject({
				projectId: "p1",
				projectPath: "/repo",
				branch: "feat/cairn-42",
				baseBranch: "main",
				linkExisting: false,
				ticket: { id: "CAIRN-42", title: "Fix the parser" },
			});
			expect(onCreate).toHaveBeenCalledWith({ instanceId: "new-i" });
		});

		it("reports a spawn that failed", async () => {
			spawnInstance.mockRejectedValue(new Error("worktree exists"));
			const { onCreate } = mount();
			await settle();
			await toBranchStep();
			await userEvent.click(primary());
			await settle();
			expect(document.body.textContent).toContain("worktree exists");
			expect(onCreate).not.toHaveBeenCalled();
		});

		/** A ticket-backed instance carries the tracker's own identity. */
		it("carries the tracker's ticket onto the instance", async () => {
			capabilitiesOf.mockReturnValue({ tracker: { kind: "jira" } });
			projectBindings.set({
				tracker: { connectionId: "c1" },
				autoTransition: {},
			});
			ticketSearch.update((s) => ({ ...s, results: [ticket()] }));
			mount();
			await settle();
			await userEvent.click(ticketItems()[0]);
			await settle();
			await userEvent.click(primary());
			await settle();
			await userEvent.click(primary());
			await settle();
			await userEvent.click(primary());
			await settle();
			expect(spawnInstance.mock.calls[0][0]).toMatchObject({
				ticket: {
					key: "CAIRN-42",
					url: "https://tracker/CAIRN-42",
					source: "jira",
					connectionId: "c1",
				},
			});
			expect(setTicket).toHaveBeenCalled();
		});

		/** The tracker can be told the ticket has started. */
		it("moves the ticket to the configured status", async () => {
			capabilitiesOf.mockReturnValue({ tracker: { kind: "jira" } });
			projectBindings.set({
				tracker: { connectionId: "c1" },
				autoTransition: { onCreate: "in-progress" },
			});
			ticketSearch.update((s) => ({ ...s, results: [ticket()] }));
			mount();
			await settle();
			await userEvent.click(ticketItems()[0]);
			await settle();
			await userEvent.click(primary());
			await settle();
			await userEvent.click(primary());
			await settle();
			await userEvent.click(primary());
			await settle();
			expect(transitionTicketToStatus).toHaveBeenCalledWith(
				"p1",
				"new-i",
				"in-progress",
			);
		});

		/**
		 * The instance exists even when the transition failed, so the modal says
		 * so and still hands it over rather than losing it.
		 */
		it("keeps the instance when the transition failed", async () => {
			capabilitiesOf.mockReturnValue({ tracker: { kind: "jira" } });
			projectBindings.set({
				tracker: { connectionId: "c1" },
				autoTransition: { onCreate: "in-progress" },
			});
			transitionTicketToStatus.mockRejectedValue(new Error("no permission"));
			ticketSearch.update((s) => ({ ...s, results: [ticket()] }));
			const { onCreate } = mount();
			await settle();
			await userEvent.click(ticketItems()[0]);
			await settle();
			await userEvent.click(primary());
			await settle();
			await userEvent.click(primary());
			await settle();
			await userEvent.click(primary());
			await settle();
			expect(onCreate).not.toHaveBeenCalled();
			await userEvent.click(primary());
			await settle();
			expect(onCreate).toHaveBeenCalledWith({ instanceId: "new-i" });
		});
	});

	describe("moving between the steps", () => {
		it("names each step", async () => {
			mount();
			await settle();
			const first = stepLabel();
			await toModeStep();
			expect(stepLabel()).not.toBe(first);
		});

		it("offers no way back from the first step", async () => {
			mount();
			await settle();
			expect(backButton()).toBeNull();
		});

		it("goes back to the step before", async () => {
			mount();
			await settle();
			await toModeStep();
			await userEvent.click(backButton());
			await settle();
			expect(field("ticket-id")).not.toBeNull();
		});

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
	});

	describe("opening on a branch", () => {
		/** Opening from a branch preselects it and reads its ticket reference. */
		it("preselects the branch it was opened on", async () => {
			listBranchesDetailed.mockResolvedValue({
				local: ["feat/cairn-42"],
				remote: [],
			});
			mount({ initialBranch: "feat/cairn-42" });
			await settle();
			expect((field("ticket-id") as HTMLInputElement).value).toBe("CAIRN-42");
		});

		it("ignores a branch the repository does not have", async () => {
			mount({ initialBranch: "gone" });
			await settle();
			expect((field("ticket-id") as HTMLInputElement).value).toBe("");
		});

		it("matches a remote branch by its local name", async () => {
			listBranchesDetailed.mockResolvedValue({
				local: [],
				remote: ["origin/feat/cairn-42"],
			});
			mount({ initialBranch: "feat/cairn-42" });
			await settle();
			expect((field("ticket-id") as HTMLInputElement).value).toBe("CAIRN-42");
		});
	});
});
