<script lang="ts">
  /**
   * Renders one agent turn: its text, reasoning and tool call blocks.
   */
  import Icon from '$lib/components/Icon.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import { t } from '$lib/i18n';
  import type { AgentBlock } from '$lib/services/conversation-service';
  import { shortenPaths } from '$lib/utils/agent/tool-label';

  export let blocks: AgentBlock[] = [];
  export let showThinking = true;
  export let renderMarkdown: (source: string, blockId?: string) => string;
  /** Paths the user already knows, stripped from tool lines. */
  export let roots: string[] = [];
  /** Opens the full thread of a subagent, with its tools and its reasoning. */
  export let onOpenAgent: ((agentRunId: string) => void) | undefined = undefined;

  /**
   * "Bash: cd /tmp" reads as a tool and its argument, not as one long line. The
   * argument is shortened for reading and kept whole for the tooltip - the full
   * path is still the thing to copy.
   */
  /**
   * Blocks are only ever appended, so their position identifies them. The two
   * ends of a delegation share the run that produced them, hence the phase:
   * without it the answer would be taken for the line that started the work.
   */
  function blockKey(block: AgentBlock, index: number): string {
    if (block.kind === 'agent' && block.agentRunId) {
      return `a:${block.agentRunId}:${block.phase ?? ''}`;
    }
    if (block.kind === 'tool' && block.toolId) return `t:${block.toolId}`;
    return `i:${index}`;
  }

  function split(label: string): { name: string; arg: string; full: string } {
    const at = label.indexOf(': ');
    if (at < 0) return { name: label, arg: '', full: '' };
    const full = label.slice(at + 2);
    return { name: label.slice(0, at), arg: shortenPaths(full, roots), full };
  }
</script>

{#each blocks as block, i (blockKey(block, i))}
  {@const key = blockKey(block, i)}
  {#if block.kind === 'tool'}
    {@const parts = split(block.text)}
    <div class="tool" class:done={block.done} class:failed={block.failed}>
      <span class="tool-mark">
        {#if block.failed}
          <Icon name="alert" size={10}/>
        {:else if block.done}
          <Icon name={block.icon || 'terminal'} size={10}/>
        {:else}
          <Spinner size={10} stroke={1.5}/>
        {/if}
      </span>
      <span class="tool-name">{parts.name}</span>
      {#if parts.arg}
        <span class="tool-arg selectable" title={parts.full}>{parts.arg}</span>
      {/if}
    </div>
  {:else if block.kind === 'agent'}
    <div class="agent-block" class:failed={block.failed} style={block.color ? `--agent: ${block.color}` : ''}>
      {#if block.phase === 'end'}
        <details class="agent-done">
          <summary>
            <span class="agent-mark"><Icon name={block.failed ? 'alert' : 'sparkles'} size={10}/></span>
            <span class="agent-label">
              {(t('agent.subagent.finished') as (n: string) => string)(block.text)}
            </span>
            <Icon name="chev-d" size={11}/>
          </summary>
          {#if block.result}
            <div class="agent-result selectable">{@html renderMarkdown(block.result, `r:${key}`)}</div>
          {:else}
            <div class="agent-result empty">{t('agent.subagent.noAnswer')}</div>
          {/if}
          {#if block.agentRunId && onOpenAgent}
            {@const runId = block.agentRunId}
            <button class="agent-open" on:click={() => onOpenAgent?.(runId)}>
              <Icon name="arrow-right" size={11}/> {t('agent.subagent.openThread')}
            </button>
          {/if}
        </details>
      {:else}
        <div class="agent-running">
          <span class="agent-mark">
            {#if block.done}
              <Icon name="sparkles" size={10}/>
            {:else}
              <Spinner size={10} stroke={1.5}/>
            {/if}
          </span>
          <span class="agent-label">
            {(t('agent.subagent.started') as (n: string) => string)(block.text)}
          </span>
        </div>
      {/if}
    </div>
  {:else if block.kind === 'thinking'}
    {#if showThinking}
      <details class="thinking-block">
        <summary><Icon name="wand" size={11}/> {t('agent.thinking')}</summary>
        <div class="thinking-content selectable">{block.text}</div>
      </details>
    {/if}
  {:else}
    <div class="answer selectable">
      {@html renderMarkdown(block.text, key)}
    </div>
  {/if}
{/each}

<style>
  .tool {
    align-items: center;
    color: var(--fg-3);
    display: flex;
    font-size: 11px;
    gap: 7px;
    min-width: 0;
    padding: 1px 0;
  }

  .tool-mark {
    align-items: center;
    background: var(--bg-2);
    border: 1px solid var(--stroke-0);
    border-radius: 5px;
    color: var(--fg-3);
    display: flex;
    flex: 0 0 auto;
    height: 18px;
    justify-content: center;
    width: 18px;
  }

  .tool.done .tool-mark { color: var(--fg-2); }

  .tool.failed .tool-mark {
    border-color: var(--danger);
    color: var(--danger);
  }

  .tool-name {
    color: var(--fg-1);
    flex: 0 0 auto;
    font-weight: 500;
  }

  .tool.failed .tool-name { color: var(--danger); }

  .tool-arg {
    color: var(--fg-3);
    font-family: var(--font-mono);
    font-size: 10.5px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .answer {
    font-size: 13px;
    line-height: 1.6;
    min-width: 0;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  /* Code wraps rather than pushing the thread sideways: this panel is narrow,
     and a command line is read, not scrolled to. */
  .answer :global(pre) {
    overflow-wrap: anywhere;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .answer :global(code) { overflow-wrap: anywhere; }

  .answer :global(p) { margin: 0 0 8px; }
  .answer :global(p:last-child) { margin-bottom: 0; }

  /* A note the turn wrote on its way, not the reply it landed on. */

  .agent-block {
    --agent: var(--accent);
    font-size: 11px;
    min-width: 0;
    padding: 1px 0;
  }

  .agent-running,
  .agent-done > summary {
    align-items: center;
    color: var(--agent);
    display: flex;
    gap: 7px;
    min-width: 0;
  }

  .agent-done > summary {
    cursor: pointer;
    list-style: none;
  }

  .agent-done > summary::-webkit-details-marker { display: none; }
  .agent-done[open] > summary :global(svg:last-child) { transform: rotate(180deg); }

  .agent-mark {
    align-items: center;
    color: var(--agent);
    display: inline-flex;
    flex: 0 0 auto;
    height: 14px;
    justify-content: center;
    width: 14px;
  }

  .agent-label {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .agent-block.failed .agent-running,
  .agent-block.failed .agent-done > summary,
  .agent-block.failed .agent-mark { color: var(--danger); }

  .agent-result {
    border-left: 2px solid color-mix(in srgb, var(--agent) 45%, transparent);
    color: var(--fg-1);
    font-size: 12px;
    line-height: 1.6;
    margin: 6px 0 0 6px;
    padding: 2px 0 2px 10px;
  }

  .agent-result.empty { color: var(--fg-3); font-style: italic; }
  .agent-result :global(p) { margin: 0 0 8px; }
  .agent-result :global(p:last-child) { margin-bottom: 0; }

  .agent-open {
    align-items: center;
    background: none;
    border: none;
    color: var(--agent);
    cursor: pointer;
    display: inline-flex;
    font: inherit;
    font-size: 11px;
    gap: 4px;
    margin: 6px 0 0 16px;
    padding: 2px 0;
  }

  .agent-open:hover { text-decoration: underline; }

  .thinking-block {
    color: var(--fg-3);
    font-size: 11px;
  }

  .thinking-block summary { cursor: pointer; }

  .thinking-content {
    padding: 6px 0 0 14px;
    white-space: pre-wrap;
  }
</style>
