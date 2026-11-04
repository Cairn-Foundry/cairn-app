// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Ticket, TicketQuery } from "#lib/types/integrations";
import { runProjectTeardowns } from "./project-teardown";
import {
	clearTicket,
	DEFAULT_TICKET_QUERY,
	forgetProject,
	loadTicket,
	loadTransitions,
	resetTicketSearch,
	resolveTicketInput,
	searchTickets,
	setTicket,
	ticketSearch,
	ticketStateFor,
	tickets,
	transitionTicket,
	transitionTicketToStatus,
} from "./tracker";

const trackerTransition = vi.hoisted(() => vi.fn());
const trackerListTransitions = vi.hoisted(() => vi.fn());
const trackerGetTicket = vi.hoisted(() => vi.fn());
const trackerListTickets = vi.hoisted(() => vi.fn());
const trackerResolveUrl = vi.hoisted(() => vi.fn());

vi.mock("#lib/services/integration-service", () => ({
	trackerTransition,
	trackerListTransitions,
	trackerGetTicket,
	trackerListTickets,
	trackerResolveUrl,
	toIntegrationError: (e: unknown) => ({ message: String(e) }),
}));

function ticket(overrides: Partial<Ticket> = {}): Ticket {
	return {
		id: "1",
		key: "CAIRN-42",
		title: "A ticket",
		description: "",
		status: "To Do",
		statusCategory: "todo",
		kind: null,
		labels: [],
		assignees: [],
		url: "https://tracker/CAIRN-42",
		updatedAt: "2026-01-01",
		...overrides,
	};
}

describe("ticket status across projects", () => {
	beforeEach(() => {
		for (const key of Object.keys(get(tickets))) {
			const [projectId, instanceId] = key.split(":");
			clearTicket(projectId, instanceId);
		}
		trackerListTransitions.mockResolvedValue([]);
	});

	it("propagates a transition to the same ticket linked in another project", async () => {
		setTicket("p1", "i1", ticket());
		setTicket("p2", "i2", ticket());
		trackerTransition.mockResolvedValue(
			ticket({ status: "Done", statusCategory: "done" }),
		);

		await transitionTicket("p1", "i1", "t-done");

		expect(ticketStateFor(get(tickets), "p2", "i2").ticket?.status).toBe(
			"Done",
		);
	});

	it("leaves a different ticket untouched", async () => {
		setTicket("p1", "i1", ticket());
		setTicket(
			"p2",
			"i2",
			ticket({ key: "OTHER-1", url: "https://tracker/OTHER-1" }),
		);
		trackerTransition.mockResolvedValue(
			ticket({ status: "Done", statusCategory: "done" }),
		);

		await transitionTicket("p1", "i1", "t-done");

		expect(ticketStateFor(get(tickets), "p2", "i2").ticket?.status).toBe(
			"To Do",
		);
	});
});

function resetState() {
	for (const key of Object.keys(get(tickets))) {
		const [projectId, instanceId] = key.split(":");
		clearTicket(projectId, instanceId);
	}
	resetTicketSearch();
	vi.clearAllMocks();
	trackerListTransitions.mockResolvedValue([]);
}

const stateOf = (projectId: string, instanceId: string) =>
	ticketStateFor(get(tickets), projectId, instanceId);

describe("searchTickets", () => {
	beforeEach(resetState);

	const query = (overrides: Partial<TicketQuery> = {}): TicketQuery => ({
		...DEFAULT_TICKET_QUERY,
		text: "bug",
		...overrides,
	});

	it("marks the search running, then stores the first page", async () => {
		let release!: (v: unknown) => void;
		trackerListTickets.mockImplementationOnce(
			() =>
				new Promise((r) => {
					release = r;
				}),
		);
		const running = searchTickets("p1", query());
		expect(get(ticketSearch)).toMatchObject({
			query: query(),
			isSearching: true,
			error: null,
		});
		release({ items: [ticket()], hasMore: true });
		await running;
		expect(trackerListTickets).toHaveBeenCalledWith("p1", query());
		expect(get(ticketSearch)).toMatchObject({
			results: [ticket()],
			hasMore: true,
			isSearching: false,
			error: null,
		});
	});

	it("replaces the results on page one and appends on later pages", async () => {
		trackerListTickets.mockResolvedValueOnce({
			items: [ticket({ key: "A-1" })],
			hasMore: true,
		});
		await searchTickets("p1", query());
		trackerListTickets.mockResolvedValueOnce({
			items: [ticket({ key: "A-2" })],
			hasMore: false,
		});
		await searchTickets("p1", query({ page: 2 }));
		expect(get(ticketSearch).results.map((t) => t.key)).toEqual(["A-1", "A-2"]);
		trackerListTickets.mockResolvedValueOnce({
			items: [ticket({ key: "A-3" })],
			hasMore: false,
		});
		await searchTickets("p1", query({ page: 1 }));
		expect(get(ticketSearch).results.map((t) => t.key)).toEqual(["A-3"]);
	});

	it("records a failure and stops searching", async () => {
		trackerListTickets.mockRejectedValue(new Error("401"));
		await expect(searchTickets("p1", query())).resolves.toBeUndefined();
		expect(get(ticketSearch)).toMatchObject({
			isSearching: false,
			error: { message: "Error: 401" },
			results: [],
		});
	});

	it("drops a slow answer that a newer search replaced", async () => {
		let releaseFirst!: (v: unknown) => void;
		trackerListTickets.mockImplementationOnce(
			() =>
				new Promise((r) => {
					releaseFirst = r;
				}),
		);
		const slow = searchTickets("p1", query({ text: "old" }));
		trackerListTickets.mockResolvedValueOnce({
			items: [ticket({ key: "NEW-1" })],
			hasMore: false,
		});
		await searchTickets("p1", query({ text: "new" }));
		releaseFirst({ items: [ticket({ key: "OLD-1" })], hasMore: true });
		await slow;
		expect(get(ticketSearch).results.map((t) => t.key)).toEqual(["NEW-1"]);
		expect(get(ticketSearch).hasMore).toBe(false);
	});

	it("drops a failure that a newer search replaced", async () => {
		let rejectFirst!: (e: unknown) => void;
		trackerListTickets.mockImplementationOnce(
			() =>
				new Promise((_, reject) => {
					rejectFirst = reject;
				}),
		);
		const slow = searchTickets("p1", query({ text: "old" }));
		trackerListTickets.mockResolvedValueOnce({ items: [], hasMore: false });
		await searchTickets("p1", query({ text: "new" }));
		rejectFirst(new Error("500"));
		await slow;
		expect(get(ticketSearch).error).toBeNull();
	});
});

describe("resetTicketSearch", () => {
	beforeEach(resetState);

	it("restores the default query and empties the results", async () => {
		trackerListTickets.mockResolvedValue({ items: [ticket()], hasMore: true });
		await searchTickets("p1", { ...DEFAULT_TICKET_QUERY, text: "x" });
		resetTicketSearch();
		expect(get(ticketSearch)).toEqual({
			query: DEFAULT_TICKET_QUERY,
			results: [],
			hasMore: false,
			isSearching: false,
			error: null,
		});
	});

	it("discards an answer still on its way", async () => {
		let release!: (v: unknown) => void;
		trackerListTickets.mockImplementationOnce(
			() =>
				new Promise((r) => {
					release = r;
				}),
		);
		const running = searchTickets("p1", DEFAULT_TICKET_QUERY);
		resetTicketSearch();
		release({ items: [ticket()], hasMore: true });
		await running;
		expect(get(ticketSearch).results).toEqual([]);
		expect(get(ticketSearch).isSearching).toBe(false);
	});
});

describe("resolveTicketInput", () => {
	beforeEach(resetState);

	it("answers null for blank input without asking the tracker", async () => {
		await expect(resolveTicketInput("p1", "   ")).resolves.toBeNull();
		expect(trackerResolveUrl).not.toHaveBeenCalled();
		expect(trackerGetTicket).not.toHaveBeenCalled();
	});

	it("resolves a pasted URL through the tracker, trimmed", async () => {
		trackerResolveUrl.mockResolvedValue(ticket());
		await expect(
			resolveTicketInput("p1", "  HTTPS://tracker/CAIRN-42 "),
		).resolves.toEqual(ticket());
		expect(trackerResolveUrl).toHaveBeenCalledWith(
			"p1",
			"HTTPS://tracker/CAIRN-42",
		);
		expect(trackerGetTicket).not.toHaveBeenCalled();
	});

	it("answers null when the URL is not a ticket of the tracker", async () => {
		trackerResolveUrl.mockResolvedValue(null);
		await expect(resolveTicketInput("p1", "http://x/y")).resolves.toBeNull();
	});

	it("reads anything else as a ticket key", async () => {
		trackerGetTicket.mockResolvedValue(ticket());
		await expect(resolveTicketInput("p1", " CAIRN-42 ")).resolves.toEqual(
			ticket(),
		);
		expect(trackerGetTicket).toHaveBeenCalledWith("p1", "CAIRN-42");
		expect(trackerResolveUrl).not.toHaveBeenCalled();
	});
});

describe("loadTicket", () => {
	beforeEach(resetState);

	it("stores the ticket, marks it loaded and copies it to the same ticket elsewhere", async () => {
		setTicket("p2", "i2", ticket({ status: "To Do" }));
		trackerGetTicket.mockResolvedValue(ticket({ status: "Done" }));
		await loadTicket("p1", "i1", "CAIRN-42");
		expect(trackerGetTicket).toHaveBeenCalledWith("p1", "CAIRN-42");
		expect(stateOf("p1", "i1")).toMatchObject({
			ticket: ticket({ status: "Done" }),
			isLoaded: true,
			isRefreshing: false,
			error: null,
		});
		expect(stateOf("p2", "i2").ticket?.status).toBe("Done");
	});

	it("records a failure instead of throwing, keeping a known ticket", async () => {
		setTicket("p1", "i1", ticket());
		trackerGetTicket.mockRejectedValue(new Error("404"));
		await expect(loadTicket("p1", "i1", "CAIRN-42")).resolves.toBeUndefined();
		expect(stateOf("p1", "i1")).toMatchObject({
			ticket: ticket(),
			isLoaded: true,
			isRefreshing: false,
			error: { message: "Error: 404" },
		});
	});
});

describe("loadTransitions", () => {
	beforeEach(resetState);

	const transitions = [{ id: "t1", name: "Start", toStatus: "Doing" }];

	it("stores the transitions of the linked ticket", async () => {
		setTicket("p1", "i1", ticket());
		trackerListTransitions.mockResolvedValue(transitions);
		await loadTransitions("p1", "i1");
		expect(trackerListTransitions).toHaveBeenCalledWith("p1", "CAIRN-42");
		expect(stateOf("p1", "i1").transitions).toEqual(transitions);
	});

	it("asks nothing when no ticket is linked", async () => {
		await loadTransitions("p1", "i1");
		expect(trackerListTransitions).not.toHaveBeenCalled();
	});

	it("records a failure instead of throwing", async () => {
		setTicket("p1", "i1", ticket());
		trackerListTransitions.mockRejectedValue(new Error("500"));
		await expect(loadTransitions("p1", "i1")).resolves.toBeUndefined();
		expect(stateOf("p1", "i1").error).toEqual({ message: "Error: 500" });
		expect(stateOf("p1", "i1").transitions).toEqual([]);
	});
});

describe("transitionTicket", () => {
	beforeEach(resetState);

	it("does nothing when no ticket is linked", async () => {
		await transitionTicket("p1", "i1", "t1");
		expect(trackerTransition).not.toHaveBeenCalled();
	});

	it("sends the transition for the linked ticket and reloads the transitions", async () => {
		setTicket("p1", "i1", ticket());
		trackerTransition.mockResolvedValue(ticket({ status: "Doing" }));
		trackerListTransitions.mockResolvedValue([
			{ id: "t2", name: "Finish", toStatus: "Done" },
		]);
		await transitionTicket("p1", "i1", "t1");
		expect(trackerTransition).toHaveBeenCalledWith("p1", "CAIRN-42", "t1");
		expect(stateOf("p1", "i1")).toMatchObject({
			ticket: ticket({ status: "Doing" }),
			transitions: [{ id: "t2", name: "Finish", toStatus: "Done" }],
			error: null,
		});
	});

	it("publishes the failure and rethrows", async () => {
		setTicket("p1", "i1", ticket());
		const failure = new Error("403");
		trackerTransition.mockRejectedValue(failure);
		await expect(transitionTicket("p1", "i1", "t1")).rejects.toBe(failure);
		expect(stateOf("p1", "i1")).toMatchObject({
			ticket: ticket(),
			error: { message: "Error: 403" },
		});
	});
});

describe("transitionTicketToStatus", () => {
	const available = [
		{ id: "t1", name: "Begin work", toStatus: "In Progress" },
		{ id: "t2", name: "Ship", toStatus: "Done" },
	];

	beforeEach(() => {
		resetState();
		setTicket("p1", "i1", ticket());
		trackerListTransitions.mockResolvedValue(available);
		trackerTransition.mockResolvedValue(ticket({ status: "In Progress" }));
	});

	it("runs the transition whose target status matches, ignoring case", async () => {
		await expect(
			transitionTicketToStatus("p1", "i1", "in progress"),
		).resolves.toBe(true);
		expect(trackerTransition).toHaveBeenCalledWith("p1", "CAIRN-42", "t1");
	});

	it("runs the transition whose name matches, ignoring case", async () => {
		await expect(transitionTicketToStatus("p1", "i1", "SHIP")).resolves.toBe(
			true,
		);
		expect(trackerTransition).toHaveBeenCalledWith("p1", "CAIRN-42", "t2");
	});

	it("answers false and changes nothing when no transition matches", async () => {
		await expect(
			transitionTicketToStatus("p1", "i1", "Archived"),
		).resolves.toBe(false);
		expect(trackerTransition).not.toHaveBeenCalled();
	});

	it("answers false without asking when the status name is empty", async () => {
		await expect(transitionTicketToStatus("p1", "i1", "")).resolves.toBe(false);
		expect(trackerListTransitions).not.toHaveBeenCalled();
	});

	it("answers false without asking when no ticket is linked", async () => {
		await expect(transitionTicketToStatus("p1", "i9", "Done")).resolves.toBe(
			false,
		);
		expect(trackerListTransitions).not.toHaveBeenCalled();
	});
});

describe("setTicket", () => {
	beforeEach(resetState);

	it("stores the ticket, drops stale transitions and marks it loaded", () => {
		setTicket("p1", "i1", ticket());
		expect(stateOf("p1", "i1")).toMatchObject({
			ticket: ticket(),
			transitions: [],
			isLoaded: true,
			error: null,
		});
	});

	it("does not copy a ticket without a url onto another entry", () => {
		setTicket("p2", "i2", ticket({ url: "", status: "To Do" }));
		setTicket("p1", "i1", ticket({ url: "", status: "Done" }));
		expect(stateOf("p2", "i2").ticket?.status).toBe("To Do");
	});

	it("keeps no ticket and propagates nothing when given null", () => {
		setTicket("p2", "i2", ticket());
		setTicket("p1", "i1", null);
		expect(stateOf("p1", "i1").ticket).toBeNull();
		expect(stateOf("p2", "i2").ticket).toEqual(ticket());
	});
});

describe("forgetProject", () => {
	beforeEach(resetState);

	it("drops the tickets of every instance of the project only", () => {
		setTicket("p1", "i1", ticket());
		setTicket("p1", "i2", ticket());
		setTicket("p2", "i3", ticket());
		forgetProject("p1");
		expect(Object.keys(get(tickets))).toEqual(["p2:i3"]);
	});
});

describe("tickets in flight and in transit", () => {
	beforeEach(resetState);

	it("marks a ticket as refreshing while it is read", async () => {
		let release!: (value: Ticket) => void;
		trackerGetTicket.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					release = resolve;
				}),
		);
		const running = loadTicket("p1", "i1", "CAIRN-42");
		expect(stateOf("p1", "i1").isRefreshing).toBe(true);
		release(ticket());
		await running;
		expect(stateOf("p1", "i1").isRefreshing).toBe(false);
	});

	it("leaves the state alone when transitions are asked for an unlinked instance", async () => {
		await loadTransitions("p1", "i1");
		expect(stateOf("p1", "i1").error).toBeNull();
		expect(Object.keys(get(tickets))).toEqual([]);
	});

	it("copies a newly linked ticket to the same ticket elsewhere", () => {
		setTicket("p2", "i2", ticket({ status: "To Do" }));
		setTicket("p1", "i1", ticket({ status: "Done" }));
		expect(stateOf("p2", "i2").ticket?.status).toBe("Done");
	});

	it("forgets the tickets of a project when it is removed", async () => {
		setTicket("p1", "i1", ticket());
		setTicket("p2", "i2", ticket());
		await runProjectTeardowns("p1");
		expect(Object.keys(get(tickets))).toEqual(["p2:i2"]);
	});
});
