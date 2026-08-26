import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const trackerListTickets = vi.hoisted(() => vi.fn());
vi.mock("$lib/services/integration-service", () => ({ trackerListTickets }));

const loadProjectIntegrations = vi.hoisted(() => vi.fn());
// vi.mock is hoisted above the imports, so the stand-in store is built inside
// the factory rather than referencing a module-level `writable`.
const bindingsByProject = await vi.hoisted(async () => {
	const { writable } = await import("svelte/store");
	return writable<Record<string, { tracker?: unknown }>>({});
});
vi.mock("./integrations", () => ({
	loadProjectIntegrations,
	bindingsByProject,
}));

import {
	forgetProjectInbox,
	inboxLabel,
	loadProjectInbox,
	projectInbox,
} from "./project-inbox";

let nextProject = 0;
/** A project id no earlier test cached. */
const freshProject = () => `p${nextProject++}`;

/** A tracker page as the integration would answer. */
const page = (count: number, hasMore = false) => ({
	items: Array.from({ length: count }, (_, i) => ({ id: `t${i}` })),
	hasMore,
});

beforeEach(() => {
	vi.useFakeTimers();
	trackerListTickets.mockReset();
	loadProjectIntegrations.mockReset();
	loadProjectIntegrations.mockResolvedValue(undefined);
	trackerListTickets.mockResolvedValue(page(0));
	bindingsByProject.set({});
	projectInbox.set({});
});

afterEach(() => {
	vi.useRealTimers();
});

/** Wires a project to a tracker so its inbox is actually fetched. */
function withTracker(id: string) {
	bindingsByProject.update((current) => ({
		...current,
		[id]: { tracker: { connectionId: "c1" } },
	}));
}

describe("inboxLabel", () => {
	it("shows the exact count when the page held everything", () => {
		expect(inboxLabel({ tickets: 3, hasMore: false })).toBe("3");
	});

	it("marks a truncated count so the user knows there are more", () => {
		expect(inboxLabel({ tickets: 20, hasMore: true })).toBe("20+");
	});

	it("shows a zero rather than nothing", () => {
		expect(inboxLabel({ tickets: 0, hasMore: false })).toBe("0");
	});
});

describe("loadProjectInbox", () => {
	it("counts the tickets assigned to the user", async () => {
		const id = freshProject();
		withTracker(id);
		trackerListTickets.mockResolvedValue(page(4));
		await loadProjectInbox(id);
		expect(get(projectInbox)[id]).toEqual({ tickets: 4, hasMore: false });
	});

	it("asks only for the open tickets assigned to the user", async () => {
		const id = freshProject();
		withTracker(id);
		await loadProjectInbox(id);
		expect(trackerListTickets).toHaveBeenCalledWith(id, {
			scope: "assigned",
			text: "",
			state: "open",
			page: 1,
		});
	});

	it("carries the truncation flag through", async () => {
		const id = freshProject();
		withTracker(id);
		trackerListTickets.mockResolvedValue(page(20, true));
		await loadProjectInbox(id);
		expect(get(projectInbox)[id]).toEqual({ tickets: 20, hasMore: true });
	});

	it("leaves a project with no tracker without a count", async () => {
		const id = freshProject();
		await loadProjectInbox(id);
		expect(get(projectInbox)).not.toHaveProperty(id);
		expect(trackerListTickets).not.toHaveBeenCalled();
	});

	it("leaves the project without a count when the tracker fails", async () => {
		const id = freshProject();
		withTracker(id);
		trackerListTickets.mockRejectedValue(new Error("401"));
		await expect(loadProjectInbox(id)).resolves.toBeUndefined();
		expect(get(projectInbox)).not.toHaveProperty(id);
	});

	it("serves the cache rather than asking again within the window", async () => {
		const id = freshProject();
		withTracker(id);
		await loadProjectInbox(id);
		await loadProjectInbox(id);
		expect(trackerListTickets).toHaveBeenCalledTimes(1);
	});

	it("asks again once the cache went stale", async () => {
		const id = freshProject();
		withTracker(id);
		await loadProjectInbox(id);
		vi.advanceTimersByTime(5 * 60 * 1000 + 1);
		await loadProjectInbox(id);
		expect(trackerListTickets).toHaveBeenCalledTimes(2);
	});

	it("caches a failure too, so a broken tracker is not hammered", async () => {
		const id = freshProject();
		withTracker(id);
		trackerListTickets.mockRejectedValue(new Error("401"));
		await loadProjectInbox(id);
		await loadProjectInbox(id);
		expect(trackerListTickets).toHaveBeenCalledTimes(1);
	});

	it("shares one fetch between concurrent callers", async () => {
		const id = freshProject();
		withTracker(id);
		await Promise.all([loadProjectInbox(id), loadProjectInbox(id)]);
		expect(trackerListTickets).toHaveBeenCalledTimes(1);
	});

	it("keeps projects independent", async () => {
		const a = freshProject();
		const b = freshProject();
		withTracker(a);
		withTracker(b);
		trackerListTickets.mockResolvedValueOnce(page(1));
		trackerListTickets.mockResolvedValueOnce(page(2));
		await loadProjectInbox(a);
		await loadProjectInbox(b);
		expect(get(projectInbox)[a].tickets).toBe(1);
		expect(get(projectInbox)[b].tickets).toBe(2);
	});

	it("clears a stale count when the tracker is unbound", async () => {
		const id = freshProject();
		withTracker(id);
		trackerListTickets.mockResolvedValue(page(3));
		await loadProjectInbox(id);
		bindingsByProject.set({});
		vi.advanceTimersByTime(5 * 60 * 1000 + 1);
		await loadProjectInbox(id);
		expect(get(projectInbox)).not.toHaveProperty(id);
	});
});

describe("forgetProjectInbox", () => {
	it("drops the count", async () => {
		const id = freshProject();
		withTracker(id);
		trackerListTickets.mockResolvedValue(page(2));
		await loadProjectInbox(id);
		forgetProjectInbox(id);
		expect(get(projectInbox)).not.toHaveProperty(id);
	});

	it("clears the cache, so the next read asks again", async () => {
		const id = freshProject();
		withTracker(id);
		await loadProjectInbox(id);
		forgetProjectInbox(id);
		await loadProjectInbox(id);
		expect(trackerListTickets).toHaveBeenCalledTimes(2);
	});

	it("leaves the other projects alone", async () => {
		const a = freshProject();
		const b = freshProject();
		withTracker(a);
		withTracker(b);
		trackerListTickets.mockResolvedValue(page(1));
		await loadProjectInbox(a);
		await loadProjectInbox(b);
		forgetProjectInbox(a);
		expect(get(projectInbox)).toHaveProperty(b);
	});

	it("does nothing for a project with no count", () => {
		expect(() => forgetProjectInbox("never-loaded")).not.toThrow();
	});
});
