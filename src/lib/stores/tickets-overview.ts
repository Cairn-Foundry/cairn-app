/**
 * Every open ticket of every project that has a tracker bound, in one place, so
 * the home screen can show what is left to do across the whole workspace.
 *
 * A project without a tracker is absent from the map rather than present and
 * empty: "no tracker" and "nothing left to do" are not the same answer.
 */
import { get, writable } from "svelte/store";
import { trackerListTickets } from "$lib/services/integration-service";
import {
	bindingsByProject,
	loadProjectIntegrations,
} from "$lib/stores/integrations";
import { projects } from "$lib/stores/project";
import { onProjectRemoved } from "$lib/stores/project-teardown";
import type { IntegrationError, Ticket } from "$lib/types/integrations";
import { purgeProjectEntries } from "$lib/utils/project-scope";

export interface ProjectTickets {
	tickets: Ticket[];
	/** The tracker has more than the first page; the counts are a floor. */
	hasMore: boolean;
	error: IntegrationError | null;
}

export type TicketScope = "assigned" | "all";

const CACHE_TTL_MS = 5 * 60 * 1000;

export const ticketsByProject = writable<Record<string, ProjectTickets>>({});
export const ticketsLoading = writable(false);
export const ticketsScope = writable<TicketScope>("assigned");

/**
 * Keyed by project *and* scope: the two scopes are two different answers, so
 * "assigned" being fresh says nothing about "all".
 */
const fetchedAt = new Map<string, number>();
const inFlight = new Map<string, Promise<ProjectTickets | null>>();

function cacheKey(projectId: string, scope: TicketScope): string {
	return `${projectId}:${scope}`;
}

/**
 * One call per project: a project already fetched within the TTL keeps its
 * entry, and two overlapping loads share the same request rather than issuing
 * a second one. `force` is the explicit refresh, which ignores both.
 */
async function fetchProject(
	projectId: string,
	scope: TicketScope,
	force: boolean,
): Promise<ProjectTickets | null> {
	const key = cacheKey(projectId, scope);
	if (!force) {
		const last = fetchedAt.get(key);
		const cached = get(ticketsByProject)[projectId];
		if (last !== undefined && Date.now() - last < CACHE_TTL_MS && cached) {
			return cached;
		}
		const pending = inFlight.get(key);
		if (pending) return pending;
	}

	const task = (async (): Promise<ProjectTickets | null> => {
		try {
			await loadProjectIntegrations(projectId);
		} catch {}
		if (!get(bindingsByProject)[projectId]?.tracker) return null;
		try {
			const page = await trackerListTickets(projectId, {
				scope,
				text: "",
				state: "open",
				page: 1,
			});
			fetchedAt.set(key, Date.now());
			return { tickets: page.items, hasMore: page.hasMore, error: null };
		} catch (e) {
			// A failure is not cached: the next open retries rather than showing
			// a stale error for five minutes.
			return { tickets: [], hasMore: false, error: e as IntegrationError };
		}
	})().finally(() => inFlight.delete(key));

	inFlight.set(key, task);
	return task;
}

/**
 * Reloads every project in sequence rather than in parallel: three trackers
 * behind the same connection share one rate limit, and the overview is opened
 * far less often than it is read.
 */
export async function loadTicketsOverview(
	scope: TicketScope,
	force = false,
): Promise<void> {
	ticketsLoading.set(true);
	const next: Record<string, ProjectTickets> = {};
	try {
		for (const project of get(projects)) {
			const result = await fetchProject(project.id, scope, force);
			if (result) next[project.id] = result;
		}
		ticketsByProject.set(next);
	} finally {
		ticketsLoading.set(false);
	}
}

export function forgetProject(projectId: string): void {
	purgeProjectEntries(fetchedAt, projectId);
	purgeProjectEntries(inFlight, projectId);
	ticketsByProject.update((m) => {
		if (!(projectId in m)) return m;
		const next = { ...m };
		delete next[projectId];
		return next;
	});
}

onProjectRemoved(forgetProject);
