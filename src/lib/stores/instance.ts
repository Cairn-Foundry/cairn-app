import { derived, get, writable } from "svelte/store";
import type { CreateInstanceArgs } from "$lib/services/instance-service";
import {
	createInstance,
	deleteInstance,
	duplicateInstance as duplicateInstanceService,
	listInstances,
} from "$lib/services/instance-service";
import type { Instance, TimelineEvent } from "$lib/types/instance";
import { activateInstance, activeProject } from "./project";

export const instances = writable<Instance[]>([]);
export const timeline = writable<TimelineEvent[]>([]);

export const activeInstance = derived(
	[instances, activeProject],
	([$instances, $activeProject]) => {
		if (!$activeProject?.activeInstanceId) return null;
		return (
			$instances.find((i) => i.id === $activeProject.activeInstanceId) ?? null
		);
	},
);

export const activeTimeline = derived(
	[timeline, activeInstance],
	([$timeline, $activeInstance]) => {
		if (!$activeInstance) return [];
		return $timeline.filter((e) => e.instanceId === $activeInstance.id);
	},
);

export async function loadInstances(projectId: string): Promise<void> {
	const data = await listInstances(projectId);
	instances.set(data);
}

export async function spawnInstance(
	args: CreateInstanceArgs,
): Promise<Instance> {
	const instance = await createInstance(args);
	instances.update((list) => [...list, instance]);
	await activateInstance(args.projectId, instance.id);
	return instance;
}

export async function duplicateInstance(
	source: {
		id: string;
		projectId: string;
		ticket: { id: string; title: string };
	},
	opts: { title: string; copyWorkingChanges: boolean },
): Promise<Instance> {
	const newId = crypto.randomUUID();
	const seq =
		get(instances).filter((i) => i.parentInstanceId === source.id).length + 1;
	const ticket = {
		id: `${source.ticket.id}-${seq}`,
		title: opts.title,
	};
	const instance = await duplicateInstanceService({
		sourceId: source.id,
		projectId: source.projectId,
		newId,
		ticket,
		copyWorkingChanges: opts.copyWorkingChanges,
	});
	instances.update((list) => [...list, instance]);
	return instance;
}

export function getNextDuplicateTitle(source: {
	id: string;
	ticket: { title: string };
}): string {
	const seq =
		get(instances).filter((i) => i.parentInstanceId === source.id).length + 1;
	return `${source.ticket.title} (${seq})`;
}

export async function removeInstance(
	id: string,
	projectId: string,
): Promise<void> {
	await deleteInstance(id, projectId);
	instances.update((list) => list.filter((i) => i.id !== id));
}
