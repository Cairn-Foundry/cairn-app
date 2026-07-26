import { derived, get, writable } from "svelte/store";
import { t } from "$lib/i18n";
import type { CreateInstanceArgs } from "$lib/services/instance-service";
import {
	createInstance,
	deleteInstance,
	duplicateInstance as duplicateInstanceService,
	listInstances,
	updateInstanceStatus,
} from "$lib/services/instance-service";
import type {
	Instance,
	InstanceStatus,
	TimelineEvent,
} from "$lib/types/instance";
import type { Project } from "$lib/types/project";
import { clearProjectAgentActivity } from "./agent-activity";
import { activateInstance, activeProject } from "./project";
import { removeInstanceTerminals } from "./terminal";

export const instances = writable<Instance[]>([]);
export const timeline = writable<TimelineEvent[]>([]);

export const BASE_INSTANCE_ID = "__base__";

export function isBaseInstance(id: string | null | undefined): boolean {
	return id === BASE_INSTANCE_ID;
}

/**
 * A finalized instance is archived: it leaves the instance selector and only
 * shows up in the manager, from where it can be reopened.
 */
export function isArchivedInstance(instance: Instance): boolean {
	return instance.status === "done";
}

export function baseInstance(project: Project): Instance {
	return {
		id: BASE_INSTANCE_ID,
		projectId: project.id,
		ticket: {
			id: "base",
			title: t("workspace.baseFolder.title") as string,
		},
		branch: "",
		worktreePath: project.path,
		status: "idle",
		createdAt: 0,
		baseBranch: "",
	};
}

export const activeInstance = derived(
	[instances, activeProject],
	([$instances, $activeProject]) => {
		if (!$activeProject) return null;
		const id = $activeProject.activeInstanceId;
		if (!id || id === BASE_INSTANCE_ID) return baseInstance($activeProject);
		return $instances.find((i) => i.id === id) ?? baseInstance($activeProject);
	},
);

export const instancesWithBase = derived(
	[instances, activeProject],
	([$instances, $activeProject]) =>
		$activeProject ? [baseInstance($activeProject), ...$instances] : $instances,
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

export async function setInstanceStatus(
	id: string,
	projectId: string,
	status: InstanceStatus,
): Promise<void> {
	const updated = await updateInstanceStatus(id, projectId, status);
	instances.update((list) => list.map((i) => (i.id === id ? updated : i)));
}

export async function removeInstance(
	id: string,
	projectId: string,
): Promise<void> {
	await removeInstanceTerminals(projectId, id);
	clearProjectAgentActivity(projectId, id);
	await deleteInstance(id, projectId);
	instances.update((list) => list.filter((i) => i.id !== id));
}
