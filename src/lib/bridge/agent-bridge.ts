export interface AgentIntent {
  ticketId: string;
  title: string;
  branch: string;
  profile: string;
}

export interface AgentEvent {
  type: 'message' | 'tool_call' | 'tool_result' | 'error' | 'done';
  payload: unknown;
}

export interface AgentDriver {
  start(intent: AgentIntent): Promise<void>;
  stop(): Promise<void>;
  send(message: string): Promise<void>;
  onEvent(handler: (event: AgentEvent) => void): () => void;
}

export abstract class AgentBridge {
  abstract createDriver(): AgentDriver;
}
