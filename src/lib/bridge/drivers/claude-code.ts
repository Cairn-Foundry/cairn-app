import { invoke } from '@tauri-apps/api/core';
import type { AgentDriver, AgentEvent, AgentIntent } from '../agent-bridge.js';

export class ClaudeCodeDriver implements AgentDriver {
  private eventHandlers: ((event: AgentEvent) => void)[] = [];

  async start(intent: AgentIntent): Promise<void> {
    await invoke('run_agent_command', { command: 'start', payload: intent });
  }

  async stop(): Promise<void> {
    await invoke('run_agent_command', { command: 'stop', payload: null });
  }

  async send(message: string): Promise<void> {
    await invoke('run_agent_command', { command: 'send', payload: { message } });
  }

  onEvent(handler: (event: AgentEvent) => void): () => void {
    this.eventHandlers.push(handler);
    return () => {
      this.eventHandlers = this.eventHandlers.filter(h => h !== handler);
    };
  }
}
