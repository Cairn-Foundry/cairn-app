import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Ticket } from "$lib/types/integrations";

const tickets = writable<Record<string, unknown>>({});
const loadTicket = vi.fn();
const transitionTicket = vi.fn();
const resolveTicketInput = vi.fn();
vi.mock("$lib/stores/tracker", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	tickets: { subscribe: tickets.subscribe },
	loadTicket: (...a: unknown[]) => loadTicket(...a),
	transitionTicket: (...a: unknown[]) => transitionTicket(...a),
	resolveTicketInput: (...a: unknown[]) => resolveTicketInput(...a),
}));

const requestAgentDraft = vi.fn();
vi.mock("$lib/stores/agent-draft", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	requestAgentDraft: (...a: unknown[]) => requestAgentDraft(...a),
}));

const setInstanceTicket = vi.fn();
vi.mock("$lib/stores/instance", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	setInstanceTicket: (...a: unknown[]) => setInstanceTicket(...a),
}));

const hasTracker = writable(true);
vi.mock("$lib/stores/integrations", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	hasTracker: { subscribe: hasTracker.subscribe },
}));

const showTool = vi.fn();
const activeStepSet = vi.fn();
vi.mock("$lib/stores/ui", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return {
		...actual,
		showTool: (...a: unknown[]) => showTool(...a),
		activeStep: {
			...(actual.activeStep as object),
			set: (...a: unknown[]) => activeStepSet(...a),
		},
	};
});

const openUrl = vi.fn();
vi.mock("@tauri-apps/plugin-opener", () => ({
	openUrl: (...a: unknown[]) => openUrl(...a),
}));

const { instance } = await import("./fixtures");
const { default: TicketPanel } = await import(
	"$lib/components/layout/TicketPanel.svelte"
);

function ticket(overrides: Partial<Ticket> = {}): Ticket {
	return {
		id: "1",
		key: "PROJ-1",
		title: "Fix the parser",
		description: "It breaks on empty input.",
		status: "Open",
		statusCategory: "todo",
		kind: "bug",
		labels: [],
		assignees: [],
		url: "https://tracker.example.com/PROJ-1",
		updatedAt: "2026-01-01T00:00:00Z",
		...overrides,
	} as Ticket;
}

/** The instance whose ticket the panel shows. */
function linked() {
	return instance("i1", "p1", {
		ticket: { id: "PROJ-1", title: "Fix the parser", key: "PROJ-1" },
	} as never);
}

function unlinked() {
	return instance("i1", "p1", {
		ticket: { id: "PROJ-1", title: "Fix the parser" },
	} as never);
}

/** Seeds the tracker store for the instance the panel is showing. */
function seedTicket(state: Record<string, unknown>) {
	tickets.set({
		"p1:i1": {
			ticket: null,
			transitions: [],
			isLoaded: true,
			isRefreshing: false,
			error: null,
			...state,
		},
	});
}

function mount(inst = linked()) {
	render(TicketPanel, { instance: inst });
}

const toggle = () =>
	document.querySelector(".ticket-toggle") as HTMLButtonElement;
const panel = () => document.querySelector(".ticket-panel");
const emptyNote = () => document.querySelector(".ticket-empty");
const errorNote = () => document.querySelector(".ticket-error");
const skeleton = () => document.querySelector(".ticket-skeleton");
const buttonNamed = (pattern: RegExp) =>
	Array.from(
		document.querySelectorAll<HTMLElement>(".ticket-panel button"),
	).find((b) => pattern.test((b.textContent ?? "").trim())) as HTMLElement;

async function open() {
	await userEvent.click(toggle());
	await tick();
}

beforeEach(() => {
	loadTicket.mockReset().mockResolvedValue(undefined);
	transitionTicket.mockReset().mockResolvedValue(undefined);
	resolveTicketInput.mockReset();
	requestAgentDraft.mockReset();
	setInstanceTicket.mockReset().mockResolvedValue(undefined);
	showTool.mockReset();
	activeStepSet.mockReset();
	openUrl.mockReset().mockResolvedValue(undefined);
	hasTracker.set(true);
	seedTicket({});
});

describe("TicketPanel", () => {
	describe("opening", () => {
		it("stays closed until it is opened", () => {
			mount();
			expect(panel()).toBeNull();
		});

		it("opens and closes on the toggle", async () => {
			mount();
			await open();
			expect(panel()).not.toBeNull();
			await userEvent.click(toggle());
			await tick();
			expect(panel()).toBeNull();
		});

		/** The ticket is fetched when the panel is opened, not before. */
		it("fetches the ticket only once it is opened", async () => {
			mount();
			expect(loadTicket).not.toHaveBeenCalled();
			await open();
			// The key is passed so the tracker is asked by what it knows the
			// ticket as, falling back to the raw id when nothing is linked yet.
			expect(loadTicket).toHaveBeenCalledWith("p1", "i1", "PROJ-1");
		});

		it("fetches nothing for an instance with no linked ticket", async () => {
			mount(unlinked());
			await open();
			expect(loadTicket).not.toHaveBeenCalled();
		});

		it("closes on a click outside", async () => {
			mount();
			await open();
			await userEvent.click(document.body);
			await tick();
			expect(panel()).toBeNull();
		});
	});

	describe("what it shows", () => {
		it("shows a placeholder while the ticket loads, not a word", async () => {
			seedTicket({ isLoaded: false });
			mount();
			await open();
			expect(skeleton()).not.toBeNull();
			expect(document.body.textContent?.toLowerCase()).not.toContain("loading");
		});

		it("shows the ticket once it is there", async () => {
			seedTicket({ ticket: ticket() });
			mount();
			await open();
			expect(document.body.textContent).toContain("Fix the parser");
		});

		it("reports a failed fetch", async () => {
			seedTicket({ error: { code: "unauthorized", message: "bad token" } });
			mount();
			await open();
			expect(errorNote()?.textContent).toContain("bad token");
		});

		/** An instance with no linked ticket says so rather than showing nothing. */
		it("says so when nothing is linked", async () => {
			mount(unlinked());
			await open();
			expect(emptyNote()).not.toBeNull();
		});
	});

	describe("linking a ticket", () => {
		it("offers to link only where a tracker is configured", async () => {
			hasTracker.set(false);
			mount(unlinked());
			await open();
			expect(buttonNamed(/link|lier/i)).toBeUndefined();
		});

		it("links the ticket the instance names", async () => {
			resolveTicketInput.mockResolvedValue({
				key: "PROJ-1",
				url: "https://tracker.example.com/PROJ-1",
			});
			mount(unlinked());
			await open();
			await userEvent.click(buttonNamed(/link|lier/i));
			await tick();
			await tick();
			expect(resolveTicketInput).toHaveBeenCalledWith("p1", "PROJ-1");
			expect(setInstanceTicket).toHaveBeenCalled();
			expect(setInstanceTicket.mock.calls[0][2]).toMatchObject({
				key: "PROJ-1",
			});
		});

		/**
		 * A ticket the tracker does not know is reported in the panel's own
		 * words, not linked - and not surfaced as a raw runtime error, which is
		 * what the guard buys over letting the null reach the code below.
		 */
		it("reports a ticket the tracker cannot find", async () => {
			resolveTicketInput.mockResolvedValue(null);
			mount(unlinked());
			await open();
			await userEvent.click(buttonNamed(/link|lier/i));
			await tick();
			await tick();
			expect(setInstanceTicket).not.toHaveBeenCalled();
			expect(errorNote()).not.toBeNull();
			expect(errorNote()?.textContent).not.toMatch(
				/undefined|null|TypeError|Cannot read/i,
			);
		});

		it("reports a failure to reach the tracker", async () => {
			resolveTicketInput.mockRejectedValue(new Error("offline"));
			mount(unlinked());
			await open();
			await userEvent.click(buttonNamed(/link|lier/i));
			await tick();
			await tick();
			expect(errorNote()?.textContent).toContain("offline");
		});
	});

	describe("acting on the ticket", () => {
		beforeEach(() => {
			seedTicket({
				ticket: ticket(),
				transitions: [{ id: "t1", name: "In progress" }],
			});
		});

		/** The transitions hide behind the status, which opens them. */
		it("moves the ticket to the status that was picked", async () => {
			mount();
			await open();
			expect(document.querySelectorAll(".ticket-transition")).toHaveLength(0);

			const status = buttonNamed(/open/i);
			await userEvent.click(status);
			await tick();

			const transition = document.querySelector(
				".ticket-transition",
			) as HTMLElement;
			expect(transition).toBeTruthy();
			await userEvent.click(transition);
			await tick();
			expect(transitionTicket).toHaveBeenCalledWith("p1", "i1", "t1");
		});

		/**
		 * Starting from the ticket hands the agent a prompt and shows the agent
		 * step - and closes any tool that would sit over it.
		 */
		it("hands the ticket to the agent and shows the agent step", async () => {
			mount();
			await open();
			await userEvent.click(buttonNamed(/start|démarrer|commencer/i));
			await tick();
			expect(requestAgentDraft).toHaveBeenCalled();
			expect(requestAgentDraft.mock.calls[0][0]).toBe("i1");
			expect(activeStepSet).toHaveBeenCalledWith("agent");
			expect(showTool).toHaveBeenCalledWith(null);
			expect(panel()).toBeNull();
		});

		it("opens the ticket on the tracker", async () => {
			mount();
			await open();
			// The label carries the tracker's own name, so the button is found
			// by the action it sits in rather than by its text.
			const openOnTracker = Array.from(
				document.querySelectorAll<HTMLElement>(".ticket-actions .btn"),
			).find((b) => !b.classList.contains("primary")) as HTMLElement;
			await userEvent.click(openOnTracker);
			expect(openUrl).toHaveBeenCalledWith(
				"https://tracker.example.com/PROJ-1",
			);
		});
	});
});
