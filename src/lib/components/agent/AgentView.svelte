<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import { get } from 'svelte/store';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import Icon from '$lib/components/Icon.svelte';
  import { t, getLocale } from '$lib/i18n';
  import { activeInstance, instancesWithBase } from '$lib/stores/instance';
  import { settings } from '$lib/stores/settings';
  import { sendMessage, stopAgent, resetAgentSession } from '$lib/services/agent-service';
  import { setAgentBusy, setAgentDone, pingAgentCompletion } from '$lib/stores/agent-activity';
  import { activeStep, terminalActive } from '$lib/stores/ui';
  import { PROVIDERS } from '$lib/components/home/agents/providers-data';
  import { IS_MAC, MOD_LABEL } from '$lib/utils/platform';
  import type { Instance } from '$lib/types/instance';
  import { marked } from 'marked';

  marked.use({ async: false, gfm: true });

  function renderMarkdown(content: string): string {
    return marked.parse(content, { async: false }) as string;
  }

  const selectableProviders = PROVIDERS.filter((p) => p.status !== 'coming-soon');

  interface Message {
    role: 'system' | 'user' | 'agent';
    content: string;
    time: string;
    streaming?: boolean;
  }

  interface ActivityEntry {
    time: string;
    icon: string;
    label: string;
    source: 'stdin' | 'tool' | 'system';
  }

  interface Conversation {
    messages: Message[];
    activity: ActivityEntry[];
    draft: string;
    busy: boolean;
    error: string;
    providerId: string;
  }

  let conversations = $state<Record<string, Conversation>>({});
  let providerOpen = $state(false);
  let scrollEl: HTMLElement;
  let activityEl: HTMLElement;
  let providerBtnEl: HTMLElement;
  let textareaEl = $state<HTMLTextAreaElement>();
  let unlisten: UnlistenFn | undefined;
  let copiedKey = $state<string | null>(null);

  let activityWidth = $state(300);
  let isActivityResizing = $state(false);
  let resizeStartX = 0;
  let resizeStartWidth = 0;

  $effect(() => {
    const w = $settings.agentActivityWidth;
    if (!untrack(() => isActivityResizing)) activityWidth = w;
  });

  let activeId = $derived($activeInstance?.id ?? null);
  let current = $derived(activeId ? conversations[activeId] : undefined);
  let currentProvider = $derived(
    selectableProviders.find((p) => p.id === current?.providerId) ?? selectableProviders[0],
  );

  function createConversation(inst: Instance): Conversation {
    return {
      messages: [{ role: 'system', content: `${t('agent.instanceStarted')} · ${inst.ticket.title}`, time: now() }],
      activity: [],
      draft: '',
      busy: false,
      error: '',
      providerId: selectableProviders[0].id,
    };
  }

  function ensureConversation(inst: Instance): Conversation {
    let conv = conversations[inst.id];
    if (!conv) {
      conv = createConversation(inst);
      conversations[inst.id] = conv;
    }
    return conv;
  }

  function instanceForWorkingDir(workingDir?: string | null): Instance | undefined {
    if (workingDir) {
      return get(instancesWithBase).find((i) => i.worktreePath === workingDir);
    }
    return $activeInstance ?? undefined;
  }

  function setBusy(inst: Instance, busy: boolean) {
    const conv = ensureConversation(inst);
    conv.busy = busy;
    setAgentBusy(inst.projectId, inst.id, busy);
  }

  function isViewingAgent(inst: Instance): boolean {
    return inst.id === $activeInstance?.id && $activeStep === 'agent' && !$terminalActive;
  }

  function notifyAgentCompletion(inst: Instance) {
    if (isViewingAgent(inst)) return;
    setAgentDone(inst.projectId, inst.id, true);
    pingAgentCompletion();
  }

  $effect(() => {
    const inst = $activeInstance;
    if (inst && $activeStep === 'agent' && !$terminalActive) {
      setAgentDone(inst.projectId, inst.id, false);
    }
  });

  function resizeTextarea() {
    if (!textareaEl) return;
    textareaEl.style.height = 'auto';
    textareaEl.style.height = textareaEl.scrollHeight + 'px';
  }

  function now(): string {
    return new Date().toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' });
  }

  function iconForTool(tool?: string): string {
    switch ((tool ?? '').toLowerCase()) {
      case 'read': return 'file';
      case 'write':
      case 'edit':
      case 'multiedit': return 'edit';
      case 'bash': return 'terminal';
      case 'grep':
      case 'glob': return 'search';
      default: return 'zap';
    }
  }

  async function copyText(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      copiedKey = key;
      setTimeout(() => { if (copiedKey === key) copiedKey = null; }, 1500);
    } catch {}
  }

  function startActivityResize(e: PointerEvent) {
    isActivityResizing = true;
    resizeStartX = e.clientX;
    resizeStartWidth = activityWidth;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onActivityResizeMove(e: PointerEvent) {
    if (!isActivityResizing) return;
    const delta = resizeStartX - e.clientX;
    activityWidth = Math.max(240, Math.min(640, resizeStartWidth + delta));
  }

  function stopActivityResize() {
    if (!isActivityResizing) return;
    isActivityResizing = false;
    settings.save({ agentActivityWidth: Math.round(activityWidth) });
  }

  async function autoscroll() {
    await tick();
    if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
    if (activityEl) activityEl.scrollTop = activityEl.scrollHeight;
  }

  function onWindowClick(e: MouseEvent) {
    if (providerOpen && providerBtnEl && !providerBtnEl.contains(e.target as Node)) {
      providerOpen = false;
    }
  }

  $effect(() => {
    const inst = $activeInstance;
    if (!inst) return;
    if (!untrack(() => conversations[inst.id])) {
      conversations[inst.id] = createConversation(inst);
    }
    tick().then(resizeTextarea);
  });

  onMount(async () => {
    unlisten = await listen<{ line: string; source: string; summary?: string; workingDir?: string }>('claude-output', (e) => {
      const { source, line, summary, workingDir } = e.payload;
      const inst = instanceForWorkingDir(workingDir);
      if (!inst) return;
      const conv = ensureConversation(inst);

      if (source === 'system') {
        if (line === '[done]') {
          setBusy(inst, false);
          notifyAgentCompletion(inst);
          const last = conv.messages.findLast((m) => m.role === 'agent');
          if (last?.streaming) last.streaming = false;
        } else if (line === '[session reset]' || line === '[session stopped]') {
          setBusy(inst, false);
          const last = conv.messages.findLast((m) => m.role === 'agent');
          if (last?.streaming) last.streaming = false;
        } else if (line.startsWith('[error:')) {
          conv.error = line.slice(8, -1);
          setBusy(inst, false);
          notifyAgentCompletion(inst);
          const last = conv.messages.findLast((m) => m.role === 'agent');
          if (last?.streaming) last.streaming = false;
          conv.activity.push({ time: now(), icon: 'alert', label: line, source: 'system' });
        }
      } else if (source === 'assistant') {
        const last = conv.messages.findLast((m) => m.role === 'agent' && m.streaming);
        if (last) {
          last.content += line;
        } else {
          conv.messages.push({ role: 'agent', content: line, time: now(), streaming: true });
        }
      } else if (source === 'tool') {
        conv.activity.push({ time: now(), icon: iconForTool(summary), label: line, source: 'tool' });
      }

      if (conv === current) autoscroll();
    });

    await autoscroll();
  });

  onDestroy(() => {
    unlisten?.();
  });

  async function send() {
    const inst = $activeInstance;
    if (!inst) return;
    const conv = ensureConversation(inst);
    if (!conv.draft.trim() || conv.busy) return;

    const message = conv.draft.trim();
    conv.draft = '';
    await tick();
    resizeTextarea();
    conv.error = '';
    setBusy(inst, true);

    const t_now = now();
    conv.messages.push({ role: 'user', content: message, time: t_now });
    conv.messages.push({ role: 'agent', content: '', time: t_now, streaming: true });
    conv.activity.push({ time: t_now, icon: 'send', label: message.slice(0, 60) + (message.length > 60 ? '...' : ''), source: 'stdin' });

    await autoscroll();

    try {
      await sendMessage(message, inst.worktreePath, conv.providerId);
    } catch (e) {
      conv.error = String(e);
      setBusy(inst, false);
      const last = conv.messages.findLast((m) => m.role === 'agent' && m.streaming);
      if (last) last.streaming = false;
    }
  }

  async function interrupt() {
    const inst = $activeInstance;
    if (!inst || !current) return;
    try {
      await stopAgent(current.providerId, inst.worktreePath);
    } catch (e) {
      current.error = String(e);
    }
  }

  async function newSession() {
    const inst = $activeInstance;
    if (!inst) return;
    const conv = ensureConversation(inst);
    conv.error = '';
    try {
      await resetAgentSession(conv.providerId, inst.worktreePath);
      conv.messages = [
        { role: 'system', content: `${t('agent.sessionReset')} · ${inst.ticket.title}`, time: now() },
      ];
      conv.activity = [];
    } catch (e) {
      conv.error = String(e);
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      send();
      return;
    }
    
    if (!IS_MAC && e.ctrlKey && !e.altKey) {
      const key = e.key.toLowerCase();
      if (key === 'z') {
        e.preventDefault();
        document.execCommand(e.shiftKey ? 'redo' : 'undo');
      } else if (key === 'y') {
        e.preventDefault();
        document.execCommand('redo');
      }
    }
  }
</script>

<svelte:window onclick={onWindowClick}/>

<div class="agent-split" style="grid-template-columns: minmax(0, 1fr) {activityWidth}px;">
  <div class="agent-chat">
    <div class="pane-header">
      <div class="pane-title">
        {t('agent.title')}
        <div class="provider-select-wrap" bind:this={providerBtnEl}>
          <button
            class="provider-select"
            onclick={(e) => { e.stopPropagation(); providerOpen = !providerOpen; }}
          >
            {currentProvider.name}
            <Icon name={providerOpen ? 'chev-u' : 'chev-d'} size={10}/>
          </button>
          {#if providerOpen}
            <div class="provider-dropdown">
              {#each selectableProviders as p}
                <button
                  class="provider-option"
                  class:active={p.id === current?.providerId}
                  onclick={() => { if (current) current.providerId = p.id; providerOpen = false; }}
                >
                  {p.name}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      </div>
      <div class="pane-actions">
        <button class="btn ghost" onclick={newSession} disabled={!current || current.busy}>
          <Icon name="plus" size={13}/> {t('agent.restart')}
        </button>
      </div>
    </div>

    {#if current?.error}
      <div style="padding: 6px 14px; background: rgba(255,80,80,.08); border-bottom: 1px solid rgba(255,80,80,.25); color: #ff8080; font-family: var(--font-mono); font-size: 11px;">
        {current.error}
      </div>
    {/if}

    <div class="chat-scroll" bind:this={scrollEl}>
      {#if !current}
        <div style="font-size: 11px; color: var(--fg-3); font-family: var(--font-mono); text-align: center; padding: 4px 0; border-bottom: 1px dashed var(--stroke-0); margin-bottom: 6px;">
          <Icon name="flag" size={11} style="margin-right: 6px; vertical-align: -1px;"/>
          {t('agent.noActiveInstance')} · {now()}
        </div>
      {/if}
      {#each current?.messages ?? [] as m, i}
        {#if m.role === 'system'}
          <div style="font-size: 11px; color: var(--fg-3); font-family: var(--font-mono); text-align: center; padding: 4px 0; border-bottom: 1px dashed var(--stroke-0); margin-bottom: 6px;">
            <Icon name="flag" size={11} style="margin-right: 6px; vertical-align: -1px;"/>
            {m.content} · {m.time}
          </div>
        {:else}
          <div class="msg {m.role}">
            <div class="meta">
              <span class="role">
                {#if m.role === 'user'}
                  {t('agent.you')}
                {:else}
                  <Icon name="sparkles" size={12}/>Agent
                {/if}
              </span>
              <span>·</span>
              <span>{m.time}</span>
              {#if m.streaming}
                <span>·</span>
                <span style="color: var(--accent)">{t('agent.streaming')}</span>
              {/if}
              {#if m.content}
                <button
                  class="copy-btn"
                  title={copiedKey === `${activeId}:${i}` ? (t('common.copied') as string) : (t('common.copy') as string)}
                  onclick={() => copyText(m.content, `${activeId}:${i}`)}
                >
                  <Icon name={copiedKey === `${activeId}:${i}` ? 'check' : 'copy'} size={12}/>
                </button>
              {/if}
            </div>
            <div class="bubble selectable">
              {#if m.streaming && !m.content}
                <p><span class="typing-dots"><span></span><span></span><span></span></span></p>
              {:else}
                {#if m.role === 'agent'}
                  {@html renderMarkdown(m.content)}
                {:else}
                  <p>{m.content}</p>
                {/if}
              {/if}
            </div>
          </div>
        {/if}
      {/each}
    </div>

    <div class="chat-input-wrap">
      <div class="chat-input">
        {#if current}
          <textarea
            bind:this={textareaEl}
            placeholder={current.busy ? (t('agent.waitingResponse') as string) : (t('agent.inputPlaceholder') as string)}
            bind:value={current.draft}
            oninput={resizeTextarea}
            onkeydown={onKeydown}
            disabled={current.busy}
          ></textarea>
        {:else}
          <textarea
            placeholder={t('agent.noActiveInstance') as string}
            disabled
          ></textarea>
        {/if}
        <div class="chat-input-row">
          <span class="chip"><Icon name="at" size={11}/> {t('agent.mentionFile')}</span>
          <div class="spacer"></div>
          {#if current?.busy}
            <button class="btn btn-stop" onclick={interrupt}>
              <Icon name="stop" size={12}/> {t('agent.interrupt')}<span class="kbd">{MOD_LABEL}.</span>
            </button>
          {:else}
            <button
              class="btn"
              onclick={send}
              disabled={!current || !current.draft.trim()}
            >
              <Icon name="send" size={12}/> {t('agent.sendBtn')}<span class="kbd">{MOD_LABEL}↵</span>
            </button>
          {/if}
        </div>
      </div>
    </div>
  </div>

  <div class="activity">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="activity-resize"
      class:active={isActivityResizing}
      role="separator"
      aria-orientation="vertical"
      onpointerdown={startActivityResize}
      onpointermove={onActivityResizeMove}
      onpointerup={stopActivityResize}
    ></div>
    <div class="activity-head">
      <Icon name="zap" size={13}/>
      {t('agent.liveActivity')}
    </div>
    <div class="activity-list" bind:this={activityEl}>
      {#if !current || current.activity.length === 0}
        <div style="padding: 16px 12px; color: var(--fg-3); font-size: 12px; font-style: italic;">
          {$activeInstance ? (t('agent.waitingAgent') as string) : (t('agent.noActiveInstance') as string)}
        </div>
      {:else}
        {#each current.activity as entry}
          <div class="act-row" class:live={entry.source === 'stdin' && current.busy}>
            <span class="act-time">{entry.time}</span>
            <span class="act-icon" class:write={entry.source === 'tool'} class:error={entry.source === 'system'}>
              <Icon name={entry.icon} size={13}/>
            </span>
            <div class="act-body">
              <span class="act-label">{entry.label}</span>
            </div>
          </div>
        {/each}
      {/if}
    </div>
  </div>
</div>

<style>
  .provider-select-wrap {
    position: relative;
  }

  .provider-select {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 7px;
    font-size: 11px;
    color: var(--fg-1);
    font-family: var(--font-mono);
    background: var(--bg-2);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-sm);
    cursor: pointer;
    transition: border-color 0.1s, color 0.1s;
  }

  .provider-select:hover {
    border-color: var(--accent-line, var(--stroke-1));
    color: var(--fg-0);
  }

.provider-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 100;
    min-width: 200px;
    background: var(--bg-2);
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-md);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
    padding: 4px;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .provider-option {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    font-size: 12px;
    color: var(--fg-1);
    background: transparent;
    border: none;
    border-radius: var(--r-sm);
    cursor: pointer;
    text-align: left;
  }

  .provider-option:hover {
    background: var(--bg-3);
    color: var(--fg-0);
  }

  .provider-option.active {
    color: var(--accent);
    background: var(--accent-weak, var(--bg-3));
  }

  .msg .meta .role {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .copy-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 2px;
    margin-left: 2px;
    color: var(--fg-3);
    background: transparent;
    border: none;
    border-radius: var(--r-xs);
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.1s, color 0.1s, background 0.1s;
  }

  .msg:hover .copy-btn { opacity: 1; }
  .copy-btn:hover { color: var(--fg-0); background: var(--bg-2); }

  .activity { position: relative; }

  .activity-resize {
    position: absolute;
    top: 0;
    left: -3px;
    width: 6px;
    height: 100%;
    cursor: col-resize;
    z-index: 5;
    touch-action: none;
  }

  .activity-resize::after {
    content: '';
    position: absolute;
    left: 2px;
    top: 0;
    width: 2px;
    height: 100%;
    background: transparent;
    transition: background 0.1s;
  }

  .activity-resize:hover::after,
  .activity-resize.active::after {
    background: var(--accent-line, var(--stroke-1));
  }

.btn-stop {
    background: var(--danger-weak, rgba(255, 80, 80, 0.08));
    border-color: var(--danger-line, rgba(255, 80, 80, 0.3));
    color: #ff8080;
  }

  .btn-stop:hover {
    background: rgba(255, 80, 80, 0.15);
    border-color: rgba(255, 80, 80, 0.5);
    color: #ffaaaa;
  }
</style>
