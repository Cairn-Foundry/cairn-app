export type AgentProfile = 'default' | 'refactor' | 'debug' | 'documentation' | 'review';

export type AgentEventType = 'message' | 'file_change' | 'command' | 'error' | 'done';

export interface AgentEvent {
  id: string;
  timestamp: number;
  type: AgentEventType;
  content: string;
  filePath?: string;
}

export interface AgentSession {
  instanceId: string;
  profile: AgentProfile;
  isRunning: boolean;
  events: AgentEvent[];
}

export interface AgentIntent {
  instruction: string;
  profile: AgentProfile;
  contextFiles?: string[];
}
