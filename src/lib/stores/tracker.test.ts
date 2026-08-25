import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Ticket } from "$lib/types/integrations";
import {
	clearTicket,
	setTicket,
	ticketStateFor,
	tickets,
	transitionTicket,
} from "./tracker";

const trackerTransition = vi.hoisted(() => vi.fn());
const trackerListTransitions = vi.hoisted(() => vi.fn());

vi.mock("$lib/services/integration-service", () => ({
	trackerTransition,
	trackerListTransitions,
	trackerGetTicket: vi.fn(),
	trackerListTickets: vi.fn(),
	trackerResolveUrl: vi.fn(),
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
