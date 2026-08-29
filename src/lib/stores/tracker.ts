/** Tickets: the one linked to each instance, the search of the create-instance modal, transitions. */
import { get, writable } from "svelte/store";
import {
	toIntegrationError,
	trackerGetTicket,
	trackerListTickets,
	trackerListTransitions,
	trackerResolveUrl,
	trackerTransition,
} from "$lib/services/integration-service";
import { onProjectRemoved } from "$lib/stores/project-teardown";
import type {
	IntegrationError,
	Ticket,
	TicketQuery,
	TicketTransition,
} from "$lib/types/integrations";
import { integrationKey } from "$lib/utils/integrations/instance-key";
import { dropProjectKeys } from "$lib/utils/project-scope";

export interface InstanceTicketState {
	ticket: Ticket | null;
	transitions: TicketTransition[];
	isLoaded: boolean;
	isRefreshing: boolean;
	error: IntegrationError | null;
}

const EMPTY: InstanceTicketState = {
	ticket: null,
	transitions: [],
	isLoaded: false,
	isRefreshing: false,
	error: null,
};

const _tickets = writable<Record<string, InstanceTicketState>>({});

/** Read-only outside this module; every mutation goes through the actions below. */
export const tickets = { subscribe: _tickets.subscribe };

export function ticketStateFor(
	state: Record<string, InstanceTicketState>,
	projectId: string,
	instanceId: string,
): InstanceTicketState {
	return state[integrationKey(projectId, instanceId)] ?? EMPTY;
}

function patch(key: string, changes: Partial<InstanceTicketState>): void {
	_tickets.update((current) => ({
		...current,
		[key]: { ...(current[key] ?? EMPTY), ...changes },
	}));
}

/**
 * The same ticket can be linked to an instance in several projects, each under
 * its own key. A status read here is the status everywhere, so the fresh ticket
 * is written to every entry pointing at the same one. Matched on `url`, the only
 * identity that holds across two projects served by different trackers. Their
 * transitions are left stale on purpose: those depend on the project's tracker
 * config, and each view reloads them when it needs them.
 */
function propagateTicket(sourceKey: string, ticket: Ticket): void {
	if (!ticket.url) return;
	_tickets.update((current) => {
		const next = { ...current };
		for (const [key, state] of Object.entries(current)) {
			if (key === sourceKey || state.ticket?.url !== ticket.url) continue;
			next[key] = { ...state, ticket };
		}
		return next;
	});
}

interface TicketSearchState {
	query: TicketQuery;
	results: Ticket[];
	hasMore: boolean;
	isSearching: boolean;
	error: IntegrationError | null;
}

export const DEFAULT_TICKET_QUERY: TicketQuery = {
	scope: "assigned",
	text: "",
	state: "open",
	page: 1,
};

/** One search at a time: the create-instance modal is the only place that searches. */
export const ticketSearch = writable<TicketSearchState>({
	query: DEFAULT_TICKET_QUERY,
	results: [],
	hasMore: false,
	isSearching: false,
	error: null,
});

let searchSerial = 0;

export async function searchTickets(
	projectId: string,
	query: TicketQuery,
): Promise<void> {
	const serial = ++searchSerial;
	ticketSearch.update((s) => ({ ...s, query, isSearching: true, error: null }));
	try {
		const page = await trackerListTickets(projectId, query);
		if (serial !== searchSerial) return;
		ticketSearch.update((s) => ({
			...s,
			results: query.page > 1 ? [...s.results, ...page.items] : page.items,
			hasMore: page.hasMore,
			isSearching: false,
		}));
	} catch (error) {
		if (serial !== searchSerial) return;
		ticketSearch.update((s) => ({
			...s,
			isSearching: false,
			error: toIntegrationError(error),
		}));
	}
}

export function resetTicketSearch(): void {
	searchSerial += 1;
	ticketSearch.set({
		query: DEFAULT_TICKET_QUERY,
		results: [],
		hasMore: false,
		isSearching: false,
		error: null,
	});
}

const LOOKS_LIKE_URL = /^https?:\/\//i;

/** A pasted URL goes through the tracker's URL resolver, anything else is read as a key. */
export async function resolveTicketInput(
	projectId: string,
	input: string,
): Promise<Ticket | null> {
	const text = input.trim();
	if (!text) return null;
	if (LOOKS_LIKE_URL.test(text)) return trackerResolveUrl(projectId, text);
	return trackerGetTicket(projectId, text);
}

export async function loadTicket(
	projectId: string,
	instanceId: string,
	key: string,
): Promise<void> {
	const stateKey = integrationKey(projectId, instanceId);
	patch(stateKey, { isRefreshing: true });
	try {
		const ticket = await trackerGetTicket(projectId, key);
		patch(stateKey, {
			ticket,
			isLoaded: true,
			isRefreshing: false,
			error: null,
		});
		propagateTicket(stateKey, ticket);
	} catch (error) {
		patch(stateKey, {
			isLoaded: true,
			isRefreshing: false,
			error: toIntegrationError(error),
		});
	}
}

export async function loadTransitions(
	projectId: string,
	instanceId: string,
): Promise<void> {
	const stateKey = integrationKey(projectId, instanceId);
	const ticket = (get(_tickets)[stateKey] ?? EMPTY).ticket;
	if (!ticket) return;
	try {
		const transitions = await trackerListTransitions(projectId, ticket.key);
		patch(stateKey, { transitions, error: null });
	} catch (error) {
		patch(stateKey, { error: toIntegrationError(error) });
	}
}

export async function transitionTicket(
	projectId: string,
	instanceId: string,
	transitionId: string,
): Promise<void> {
	const stateKey = integrationKey(projectId, instanceId);
	const ticket = (get(_tickets)[stateKey] ?? EMPTY).ticket;
	if (!ticket) return;
	try {
		const updated = await trackerTransition(
			projectId,
			ticket.key,
			transitionId,
		);
		patch(stateKey, { ticket: updated, error: null });
		propagateTicket(stateKey, updated);
		await loadTransitions(projectId, instanceId);
	} catch (error) {
		patch(stateKey, { error: toIntegrationError(error) });
		throw error;
	}
}

/** Runs one of the project's automatic transitions by status name; a miss is silent. */
export async function transitionTicketToStatus(
	projectId: string,
	instanceId: string,
	statusName: string,
): Promise<boolean> {
	const stateKey = integrationKey(projectId, instanceId);
	const ticket = (get(_tickets)[stateKey] ?? EMPTY).ticket;
	if (!ticket || !statusName) return false;
	const transitions = await trackerListTransitions(projectId, ticket.key);
	const wanted = statusName.toLowerCase();
	const match = transitions.find(
		(t) =>
			t.toStatus.toLowerCase() === wanted || t.name.toLowerCase() === wanted,
	);
	if (!match) return false;
	await transitionTicket(projectId, instanceId, match.id);
	return true;
}

export function setTicket(
	projectId: string,
	instanceId: string,
	ticket: Ticket | null,
): void {
	const stateKey = integrationKey(projectId, instanceId);
	patch(stateKey, {
		ticket,
		transitions: [],
		isLoaded: true,
		error: null,
	});
	if (ticket) propagateTicket(stateKey, ticket);
}

export function clearTicket(projectId: string, instanceId: string): void {
	_tickets.update((current) => {
		const next = { ...current };
		delete next[integrationKey(projectId, instanceId)];
		return next;
	});
}

/** Forgets the ticket state of every instance of a removed project. */
export function forgetProject(projectId: string): void {
	_tickets.update((m) => dropProjectKeys(m, projectId));
}

onProjectRemoved(forgetProject);
