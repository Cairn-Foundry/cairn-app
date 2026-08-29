/** Per-project counts shown on the home cards: tickets assigned to me, cached for five minutes. Errors leave the project without a count. */
import { get, writable } from "svelte/store";
import { trackerListTickets } from "$lib/services/integration-service";
import { onProjectRemoved } from "$lib/stores/project-teardown";
import { dropProjectKeys, purgeProjectEntries } from "$lib/utils/project-scope";
import { bindingsByProject, loadProjectIntegrations } from "./integrations";

interface ProjectInboxCount {
	tickets: number;
	hasMore: boolean;
}

const CACHE_TTL_MS = 5 * 60 * 1000;

export const projectInbox = writable<Record<string, ProjectInboxCount>>({});

const fetchedAt = new Map<string, number>();
const inFlight = new Map<string, Promise<void>>();

export function inboxLabel(count: ProjectInboxCount): string {
	return count.hasMore ? `${count.tickets}+` : String(count.tickets);
}

export async function loadProjectInbox(projectId: string): Promise<void> {
	const last = fetchedAt.get(projectId);
	if (last !== undefined && Date.now() - last < CACHE_TTL_MS) return;
	const pending = inFlight.get(projectId);
	if (pending) return pending;
	const task = fetchInbox(projectId).finally(() => inFlight.delete(projectId));
	inFlight.set(projectId, task);
	return task;
}

async function fetchInbox(projectId: string): Promise<void> {
	try {
		await loadProjectIntegrations(projectId);
		const bindings = get(bindingsByProject)[projectId];
		if (!bindings?.tracker) {
			clear(projectId);
			return;
		}
		const page = await trackerListTickets(projectId, {
			scope: "assigned",
			text: "",
			state: "open",
			page: 1,
		});
		fetchedAt.set(projectId, Date.now());
		projectInbox.update((current) => ({
			...current,
			[projectId]: { tickets: page.items.length, hasMore: page.hasMore },
		}));
	} catch {
		clear(projectId);
	}
}

function clear(projectId: string): void {
	fetchedAt.set(projectId, Date.now());
	projectInbox.update((current) => {
		if (!(projectId in current)) return current;
		const next = { ...current };
		delete next[projectId];
		return next;
	});
}

export function forgetProjectInbox(projectId: string): void {
	fetchedAt.delete(projectId);
	projectInbox.update((current) => {
		const next = { ...current };
		delete next[projectId];
		return next;
	});
}

/** Forgets the inbox count cached for a removed project, and its TTL. */
export function forgetProject(projectId: string): void {
	purgeProjectEntries(fetchedAt, projectId);
	purgeProjectEntries(inFlight, projectId);
	projectInbox.update((m) => dropProjectKeys(m, projectId));
}

onProjectRemoved(forgetProject);
