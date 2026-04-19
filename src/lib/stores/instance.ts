import { writable, derived } from 'svelte/store';
import type { Instance, TimelineEvent } from '$lib/types/instance';
import { activeProject } from './project';

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
