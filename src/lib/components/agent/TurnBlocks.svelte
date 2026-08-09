<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import { t } from '$lib/i18n';
  import type { AgentBlock } from '$lib/services/conversation-service';
  import { shortenPaths } from '$lib/utils/agent/tool-label';

  export let blocks: AgentBlock[] = [];
  export let showThinking = true;
  export let renderMarkdown: (source: string) => string;
  /** Paths the user already knows, stripped from tool lines. */
  export let roots: string[] = [];

  /**
   * The last text is the answer; the ones before it are working notes written
   * between tool calls. They are kept - they say why the turn went where it
   * went - but they must not compete with the reply.
   */
  $: answerIndex = blocks.reduce(
    (found, block, i) => (block.kind === 'text' ? i : found),
    -1,
  );

  /**
   * "Bash: cd /tmp" reads as a tool and its argument, not as one long line. The
   * argument is shortened for reading and kept whole for the tooltip - the full
   * path is still the thing to copy.
   */
  function split(label: string): { name: string; arg: string; full: string } {
    const at = label.indexOf(': ');
    if (at < 0) return { name: label, arg: '', full: '' };
    const full = label.slice(at + 2);
    return { name: label.slice(0, at), arg: shortenPaths(full, roots), full };
  }
</script>

{#each blocks as block, i (i)}
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
  {:else if block.kind === 'thinking'}
    {#if showThinking}
      <details class="thinking-block">
        <summary><Icon name="wand" size={11}/> {t('agent.thinking')}</summary>
        <div class="thinking-content selectable">{block.text}</div>
      </details>
    {/if}
  {:else}
    <div class="answer selectable" class:note={i !== answerIndex}>
      {@html renderMarkdown(block.text)}
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
  .answer.note {
    border-left: 2px solid var(--stroke-0);
    color: var(--fg-3);
    font-size: 12px;
    padding-left: 10px;
  }

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
