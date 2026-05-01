<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import Icon from '$lib/components/Icon.svelte';
  import { activeInstance } from '$lib/stores/instance';

  interface OutputLine {
    line: string;
    source: string;
  }

  let lines: OutputLine[] = [];
  let draft = '';
  let running = false;
  let busy = false;
  let error = '';
  let scrollEl: HTMLElement;
  let unlisten: UnlistenFn | undefined;

  async function autoscroll() {
    await tick();
    if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
  }

  onMount(async () => {
    unlisten = await listen<OutputLine>('claude-output', (e) => {
      const { source, line } = e.payload;

      if (source === 'system') {
        if (line === '[session started]') running = true;
        if (line === '[session stopped]') { running = false; busy = false; }
        if (line === '[done]') busy = false;
      } else {
        lines = [...lines, e.payload];
      }
      autoscroll();
    });
  });

  onDestroy(() => {
    unlisten?.();
  });

  async function start() {
    if (running || !$activeInstance) return;
    error = '';
    try {
      await invoke('start_claude_session', { workingDir: $activeInstance.worktreePath });
    } catch (e) {
      error = String(e);
    }
  }

  async function stop() {
    try {
      await invoke('stop_claude_session');
    } catch (e) {
      error = String(e);
    }
  }

  async function send() {
    if (!draft.trim() || !running || busy) return;
    const message = draft;
    draft = '';
    error = '';
    busy = true;
    try {
      await invoke('send_claude_message', { message });
    } catch (e) {
      error = String(e);
      busy = false;
    }
  }

  function onInputKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function clearLog() {
    lines = [];
  }

  function sourceLabel(source: string): string {
    if (source === 'stdin') return '>';
    if (source === 'stderr') return 'E';
    if (source === 'system') return '*';
    return ' ';
  }
</script>

<div class="claude-test">
  <div class="header">
    <div class="title">
      <span class="num">07</span>
      Claude Test
      {#if $activeInstance}
        <span class="sub">· {$activeInstance.worktreePath}</span>
      {:else}
        <span class="sub warn">· no active instance</span>
      {/if}
    </div>
    <div class="status">
      <span class="dot" class:on={running} class:busy></span>
      <span class="status-text">{busy ? 'thinking…' : running ? 'ready' : 'idle'}</span>
    </div>
    <div class="actions">
      <button class="btn" on:click={start} disabled={running || !$activeInstance}>
        <Icon name="play" size={12}/> Start
      </button>
      <button class="btn ghost" on:click={stop} disabled={!running}>
        <Icon name="x" size={12}/> Stop
      </button>
      <button class="btn ghost" on:click={clearLog}>
        <Icon name="refresh" size={12}/> Clear
      </button>
    </div>
  </div>

  {#if error}
    <div class="error">{error}</div>
  {/if}

  <div class="debug" bind:this={scrollEl}>
    {#each lines as l, i (i)}
      <div class="line src-{l.source}">
        <span class="prefix">{sourceLabel(l.source)}</span>
        <span class="text">{l.line}</span>
      </div>
    {/each}
    {#if lines.length === 0}
      <div class="empty">No output yet. Press Start to open a session.</div>
    {/if}
  </div>

  <div class="input-row">
    <input
      type="text"
      placeholder={!running ? 'Start a session first' : busy ? 'Waiting for response…' : 'Type a message and press Enter…'}
      bind:value={draft}
      on:keydown={onInputKeydown}
      disabled={!running || busy}
    />
    <button class="btn" on:click={send} disabled={!running || busy || !draft.trim()}>
      <Icon name="send" size={12}/> Send
    </button>
  </div>
</div>

<style>
  .claude-test {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-1);
    color: var(--fg-0);
  }

  .header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--stroke-0);
    background: var(--bg-2);
  }

  .title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--fg-0);
  }
  .num {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-3);
    margin-right: 2px;
  }
  .sub { color: var(--fg-3); font-size: 12px; }
  .sub.warn { color: #f0a060; }

  .status {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: 6px;
    font-size: 11px;
    color: var(--fg-2);
    font-family: var(--font-mono);
  }
  .status .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--fg-3);
  }
  .status .dot.on {
    background: var(--accent);
    box-shadow: 0 0 6px var(--accent);
  }
  .status .dot.busy {
    background: #f0a060;
    box-shadow: 0 0 6px #f0a060;
    animation: pulse 1s ease-in-out infinite alternate;
  }
  @keyframes pulse { to { opacity: 0.4; } }

  .actions { margin-left: auto; display: flex; gap: 6px; }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 5px 10px;
    background: var(--bg-3);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-sm);
    color: var(--fg-1);
    font-size: 12px;
    cursor: pointer;
  }
  .btn:hover:not(:disabled) {
    background: var(--accent-weak, var(--bg-4));
    color: var(--fg-0);
    border-color: var(--accent);
  }
  .btn.ghost { background: transparent; }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }

  .error {
    padding: 6px 14px;
    background: rgba(255, 80, 80, 0.1);
    border-bottom: 1px solid rgba(255, 80, 80, 0.3);
    color: #ff8080;
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .debug {
    flex: 1;
    overflow-y: auto;
    padding: 10px 14px;
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.5;
    background: var(--bg-1);
  }

  .empty {
    color: var(--fg-3);
    font-style: italic;
  }

  .line {
    display: flex;
    gap: 8px;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .line .prefix {
    flex-shrink: 0;
    width: 12px;
    color: var(--fg-3);
    user-select: none;
  }
  .line.src-stdout .text { color: var(--fg-0); }
  .line.src-stderr .text { color: #ff9080; }
  .line.src-stdin .text { color: var(--accent); }
  .line.src-system .text { color: var(--fg-3); font-style: italic; }

  .input-row {
    display: flex;
    gap: 8px;
    padding: 10px 14px;
    border-top: 1px solid var(--stroke-0);
    background: var(--bg-2);
  }
  .input-row input {
    flex: 1;
    padding: 6px 10px;
    background: var(--bg-1);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-sm);
    color: var(--fg-0);
    font-family: var(--font-mono);
    font-size: 12px;
    outline: none;
  }
  .input-row input:focus { border-color: var(--accent); }
  .input-row input:disabled { opacity: 0.5; }
</style>
