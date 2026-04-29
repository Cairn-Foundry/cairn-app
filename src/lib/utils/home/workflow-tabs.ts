import type { WorkflowTabConfig } from '$lib/services/settings-service';

export const DEFAULT_WF_TABS: WorkflowTabConfig[] = [
  { key: 'files',  name: 'Files',  icon: 'folder', enabled: true, order: 0 },
  { key: 'agent',  name: 'Agent',  icon: 'agent',  enabled: true, order: 1 },
  { key: 'review', name: 'Review', icon: 'review', enabled: true, order: 2 },
  { key: 'tests',  name: 'Tests',  icon: 'tests',  enabled: true, order: 3 },
  { key: 'git',    name: 'Git',    icon: 'git',    enabled: true, order: 4 },
  { key: 'cicd',   name: 'CI/CD',  icon: 'ci',     enabled: true, order: 5 },
];

export function wfComputeInsert(listEl: HTMLElement | null, clientY: number): number {
  const rows = listEl?.querySelectorAll<HTMLElement>('.wf-row');
  if (!rows || rows.length === 0) return 0;
  for (let i = 0; i < rows.length; i++) {
    const rect = rows[i].getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) return i;
  }
  return rows.length;
}
