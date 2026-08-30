import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

const trackerListTickets = vi.hoisted(() => vi.fn());
const loadProjectIntegrations = vi.hoisted(() => vi.fn());

vi.mock("$lib/services/integration-service", () => ({ trackerListTickets }));
vi.mock("$lib/stores/integrations", async () => {
	const { writable } = await import("svelte/store");
	return {
		loadProjectIntegrations,
		bindingsByProject: writable({
			a: { tracker: { connectionId: "c", projectKey: "a" } },
			b: { tracker: { connectionId: "c", projectKey: "b" } },
			c: { tracker: null },
		}),
	};
});
vi.mock("$lib/stores/project", async () => {
	const { writable } = await import("svelte/store");
	return {
		projects: writable([
			{ id: "a", name: "A", path: "/a", color: "#000", activeInstanceId: null },
			{ id: "b", name: "B", path: "/b", color: "#000", activeInstanceId: null },
			{ id: "c", name: "C", path: "/c", color: "#000", activeInstanceId: null },
		]),
	};
});
vi.mock("$lib/stores/project-teardown", () => ({ onProjectRemoved: () => {} }));

type Store = typeof import("./tickets-overview");

// The TTL and in-flight maps are module state; each test gets a fresh module so
// one test's cache never answers the next one's call.
let forgetProject: Store["forgetProject"];
let loadTicketsOverview: Store["loadTicketsOverview"];
let ticketsByProject: Store["ticketsByProject"];
let ticketsLoading: Store["ticketsLoading"];

const ticket = (key: string) => ({
	id: key,
	key,
	title: key,
	description: "",
	status: "open",
	statusCategory: "todo" as const,
	kind: null,
	labels: [],
	assignees: [],
	url: "",
	updatedAt: "",
});

beforeEach(async () => {
	trackerListTickets.mockReset();
	loadProjectIntegrations.mockReset();
	loadProjectIntegrations.mockResolvedValue(undefined);
	vi.resetModules();
	({ forgetProject, loadTicketsOverview, ticketsByProject, ticketsLoading } =
		await import("./tickets-overview"));
});

describe("loadTicketsOverview", () => {
	it("skips a project with no tracker bound rather than listing it empty", async () => {
		trackerListTickets.mockResolvedValue({
			items: [ticket("1")],
			hasMore: false,
		});
		await loadTicketsOverview("assigned");

		const map = get(ticketsByProject);
		expect(Object.keys(map).sort()).toEqual(["a", "b"]);
		expect(trackerListTickets).toHaveBeenCalledTimes(2);
	});

	it("keeps the other projects when one tracker fails", async () => {
		trackerListTickets
			.mockResolvedValueOnce({ items: [ticket("1")], hasMore: true })
			.mockRejectedValueOnce(new Error("401"));
		await loadTicketsOverview("assigned");

		const map = get(ticketsByProject);
		expect(map.a.tickets).toHaveLength(1);
		expect(map.a.hasMore).toBe(true);
		expect(map.b.error).toBeTruthy();
		expect(map.b.tickets).toEqual([]);
	});

	it("passes the requested scope through and clears the loading flag", async () => {
		trackerListTickets.mockResolvedValue({ items: [], hasMore: false });
		await loadTicketsOverview("all");

		expect(trackerListTickets).toHaveBeenCalledWith("a", {
			scope: "all",
			text: "",
			state: "open",
			page: 1,
		});
		expect(get(ticketsLoading)).toBe(false);
	});

	it("serves the cache within the TTL instead of calling again", async () => {
		trackerListTickets.mockResolvedValue({
			items: [ticket("1")],
			hasMore: false,
		});
		await loadTicketsOverview("assigned");
		expect(trackerListTickets).toHaveBeenCalledTimes(2);

		await loadTicketsOverview("assigned");
		expect(trackerListTickets).toHaveBeenCalledTimes(2);
		expect(get(ticketsByProject).a.tickets).toHaveLength(1);
	});

	it("refetches once the TTL has expired", async () => {
		vi.useFakeTimers();
		try {
			trackerListTickets.mockResolvedValue({ items: [], hasMore: false });
			await loadTicketsOverview("assigned");
			vi.advanceTimersByTime(5 * 60 * 1000 + 1);
			await loadTicketsOverview("assigned");
			expect(trackerListTickets).toHaveBeenCalledTimes(4);
		} finally {
			vi.useRealTimers();
		}
	});

	it("does not serve one scope from the other scope's cache", async () => {
		trackerListTickets.mockResolvedValue({ items: [], hasMore: false });
		await loadTicketsOverview("assigned");
		await loadTicketsOverview("all");

		expect(trackerListTickets).toHaveBeenCalledTimes(4);
		expect(trackerListTickets).toHaveBeenLastCalledWith(
			"b",
			expect.objectContaining({ scope: "all" }),
		);
	});

	it("refetches when a scope is reselected, so the switch never shows stale tickets", async () => {
		trackerListTickets.mockResolvedValue({ items: [], hasMore: false });
		await loadTicketsOverview("assigned");
		// Switching away and back is what the scope toggle does; both are forced.
		await loadTicketsOverview("all", true);
		await loadTicketsOverview("assigned", true);

		expect(trackerListTickets).toHaveBeenCalledTimes(6);
	});

	it("refetches when the refresh forces past the cache", async () => {
		trackerListTickets.mockResolvedValue({ items: [], hasMore: false });
		await loadTicketsOverview("assigned");
		await loadTicketsOverview("assigned", true);

		expect(trackerListTickets).toHaveBeenCalledTimes(4);
	});

	it("does not cache a failure, so the next open retries", async () => {
		trackerListTickets.mockRejectedValue(new Error("401"));
		await loadTicketsOverview("assigned");
		expect(trackerListTickets).toHaveBeenCalledTimes(2);

		trackerListTickets.mockResolvedValue({
			items: [ticket("1")],
			hasMore: false,
		});
		await loadTicketsOverview("assigned");
		expect(trackerListTickets).toHaveBeenCalledTimes(4);
		expect(get(ticketsByProject).a.error).toBeNull();
	});

	it("shares one request between two overlapping loads", async () => {
		trackerListTickets.mockResolvedValue({ items: [], hasMore: false });
		await Promise.all([
			loadTicketsOverview("assigned"),
			loadTicketsOverview("assigned"),
		]);

		expect(trackerListTickets).toHaveBeenCalledTimes(2);
	});

	it("drops a removed project from the map", async () => {
		trackerListTickets.mockResolvedValue({
			items: [ticket("1")],
			hasMore: false,
		});
		await loadTicketsOverview("assigned");
		forgetProject("a");

		expect(Object.keys(get(ticketsByProject))).toEqual(["b"]);
	});
});
