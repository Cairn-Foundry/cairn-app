import type { Ticket } from './project.ts';

export type InstanceStatus = 'idle' | 'running' | 'paused' | 'done';

export type WorkflowStep = 'files' | 'agent' | 'review' | 'tests' | 'git' | 'cicd';

export interface Instance {
  id: string;
  projectId: string;
  ticket: Ticket;
  branch: string;
  worktreePath: string;
  status: InstanceStatus;
  createdAt: number;
}

export interface TimelineEvent {
  id: string;
  instanceId: string;
  timestamp: number;
  type: 'agent_action' | 'file_changed' | 'commit' | 'test_result' | 'ci_event' | 'checkpoint';
  summary: string;
  isCheckpoint: boolean;
}
