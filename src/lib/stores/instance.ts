import { writable, derived, get } from 'svelte/store';
import type { Instance, TimelineEvent } from '$lib/types/instance';
import { activeProject, activateInstance } from './project';
import { listInstances, createInstance, deleteInstance } from '$lib/services/instance-service';
import type { CreateInstanceArgs } from '$lib/services/instance-service';

export const instances = writable<Instance[]>([]);
export const timeline = writable<TimelineEvent[]>([]);

export const activeInstance = derived(
  [instances, activeProject],
  ([$instances, $activeProject]) => {
    if (!$activeProject?.activeInstanceId) return null;
    return $instances.find((i) => i.id === $activeProject.activeInstanceId) ?? null;
  }
);

export const activeTimeline = derived(
  [timeline, activeInstance],
  ([$timeline, $activeInstance]) => {
    if (!$activeInstance) return [];
    return $timeline.filter((e) => e.instanceId === $activeInstance.id);
  }
);

export async function loadInstances(projectId: string): Promise<void> {
  const data = await listInstances(projectId);
  instances.set(data);
}

export async function spawnInstance(args: CreateInstanceArgs): Promise<Instance> {
  const instance = await createInstance(args);
  instances.update((list) => [...list, instance]);
  await activateInstance(args.projectId, instance.id);
  return instance;
}

export async function removeInstance(id: string, projectId: string): Promise<void> {
  await deleteInstance(id, projectId);
  instances.update((list) => list.filter((i) => i.id !== id));
}
