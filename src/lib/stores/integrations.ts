/** Connections, kind descriptors, the bindings and capabilities of the active project, and the single `integration-update` listener. */
import { derived, get, writable } from "svelte/store";
import {
	getProjectCapabilities,
	getProjectIntegrations,
	integrationKinds,
	integrationUnwatch,
	integrationWatch,
	listIntegrationConnections,
	onIntegrationUpdate,
	saveProjectIntegrations as saveProjectIntegrationsService,
	toIntegrationError,
} from "$lib/services/integration-service";
import type {
	IntegrationConnection,
	IntegrationError,
	IntegrationKindDescriptor,
	IntegrationUpdateEvent,
	ProjectIntegrations,
	ResolvedCapabilities,
} from "$lib/types/integrations";
import { integrationKey } from "$lib/utils/integrations/instance-key";
import { applyUpdate as applyMergeRequestUpdate } from "./merge-request";
import { applyUpdate as applyPipelineUpdate } from "./pipelines";
import { activeProjectId } from "./project";

export const connections = writable<IntegrationConnection[]>([]);
export const kindDescriptors = writable<IntegrationKindDescriptor[]>([]);
export const connectionsError = writable<IntegrationError | null>(null);

export const EMPTY_BINDINGS: ProjectIntegrations = {
	tracker: null,
	forge: null,
	ci: null,
	autoTransition: { onCreate: null, onFinalize: null },
};

export const NO_CAPABILITIES: ResolvedCapabilities = {
	tracker: null,
	forge: null,
	ci: null,
};

const _bindingsByProject = writable<Record<string, ProjectIntegrations>>({});
const _capabilitiesByProject = writable<Record<string, ResolvedCapabilities>>(
	{},
);

export const bindingsByProject = { subscribe: _bindingsByProject.subscribe };
export const capabilitiesByProject = {
	subscribe: _capabilitiesByProject.subscribe,
};

/** Bindings of the active project; empty until loaded, and for a project without any. */
export const projectBindings = derived(
	[_bindingsByProject, activeProjectId],
	([$bindings, $projectId]) =>
		($projectId && $bindings[$projectId]) || EMPTY_BINDINGS,
);

/** What the active project can do; nothing until loaded. */
export const capabilities = derived(
	[_capabilitiesByProject, activeProjectId],
	([$capabilities, $projectId]) =>
		($projectId && $capabilities[$projectId]) || NO_CAPABILITIES,
);

export const hasTracker = derived(capabilities, ($c) => $c.tracker !== null);
export const hasForge = derived(capabilities, ($c) => $c.forge !== null);
export const hasCi = derived(capabilities, ($c) => $c.ci !== null);

/** The account the forge connection authenticates as, for defaulting an assignee to oneself. */
export const forgeIdentity = derived(
	[connections, projectBindings],
	([$connections, $bindings]) => {
		const id = $bindings.forge?.connectionId;
		if (!id) return null;
		return $connections.find((c) => c.id === id)?.identity ?? null;
	},
);

/** Which i18n vocabulary the forge speaks: `integrations.terms.mr.*` or `.pr.*`. */
export const forgeTerms = derived(
	capabilities,
	($c): "mr" | "pr" => $c.forge?.terms.mergeRequest ?? "mr",
);

export function capabilitiesOf(projectId: string): ResolvedCapabilities {
	return get(_capabilitiesByProject)[projectId] ?? NO_CAPABILITIES;
}

export function kindDescriptor(
	kind: string,
): IntegrationKindDescriptor | undefined {
	return get(kindDescriptors).find((d) => d.kind === kind);
}

export async function loadKinds(): Promise<void> {
	if (get(kindDescriptors).length > 0) return;
	kindDescriptors.set(await integrationKinds());
}

export async function loadConnections(): Promise<void> {
	try {
		connections.set(await listIntegrationConnections());
		connectionsError.set(null);
	} catch (error) {
		connectionsError.set(toIntegrationError(error));
	}
}

export async function loadProjectIntegrations(
	projectId: string,
): Promise<void> {
	const [bindings, resolved] = await Promise.all([
		getProjectIntegrations(projectId),
		getProjectCapabilities(projectId),
	]);
	_bindingsByProject.update((current) => ({
		...current,
		[projectId]: bindings ?? EMPTY_BINDINGS,
	}));
	_capabilitiesByProject.update((current) => ({
		...current,
		[projectId]: resolved ?? NO_CAPABILITIES,
	}));
}

export async function saveProjectIntegrations(
	projectId: string,
	bindings: ProjectIntegrations,
): Promise<void> {
	await saveProjectIntegrationsService(projectId, bindings);
	_bindingsByProject.update((current) => ({
		...current,
		[projectId]: bindings,
	}));
	const resolved = await getProjectCapabilities(projectId);
	_capabilitiesByProject.update((current) => ({
		...current,
		[projectId]: resolved ?? NO_CAPABILITIES,
	}));
}

export function forgetProjectIntegrations(projectId: string): void {
	_bindingsByProject.update((current) => {
		const next = { ...current };
		delete next[projectId];
		return next;
	});
	_capabilitiesByProject.update((current) => {
		const next = { ...current };
		delete next[projectId];
		return next;
	});
}

/** Routes one update to the store owning its kind, by instance key. */
export function reduceIntegrationUpdate(update: IntegrationUpdateEvent): void {
	const key = integrationKey(update.projectId, update.instanceId);
	if (update.kind === "pipeline") {
		applyPipelineUpdate(key, update.data);
	} else if (update.kind === "merge_request") {
		applyMergeRequestUpdate(key, update.data);
	}
}

let unlisten: (() => void) | null = null;
let listening: Promise<void> | null = null;

/** Attaches the single event listener; safe to call more than once. */
export function init(): void {
	if (listening) return;
	listening = onIntegrationUpdate(reduceIntegrationUpdate).then((off) => {
		unlisten = off;
	});
}

export function dispose(): void {
	unlisten?.();
	unlisten = null;
	listening = null;
}

export function watchInstance(
	projectId: string,
	instanceId: string,
	branch: string,
): Promise<void> {
	return integrationWatch(projectId, instanceId, branch);
}

export function unwatchInstance(
	projectId: string,
	instanceId: string,
): Promise<void> {
	return integrationUnwatch(projectId, instanceId);
}
