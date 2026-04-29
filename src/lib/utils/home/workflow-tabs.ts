import type { WorkflowTabConfig } from '$lib/services/settings-service';

export const DEFAULT_WF_TABS: WorkflowTabConfig[] = [
  { key: 'files',  name: 'Files',  icon: 'folder', enabled: true, order: 0 },
  { key: 'agent',  name: 'Agent',  icon: 'agent',  enabled: true, order: 1 },
  { key: 'review', name: 'Review', icon: 'review', enabled: true, order: 2 },
  { key: 'tests',  name: 'Tests',  icon: 'tests',  enabled: true, order: 3 },
  { key: 'git',    name: 'Git',    icon: 'git',    enabled: true, order: 4 },
  { key: 'cicd',   name: 'CI/CD',  icon: 'ci',     enabled: true, order: 5 },
];
