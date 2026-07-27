<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import { get } from 'svelte/store';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import Icon from '$lib/components/Icon.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import { t, getLocale } from '$lib/i18n';
  import { activeInstance, instancesWithBase } from '$lib/stores/instance';
  import { settings } from '$lib/stores/settings';
  import { sendMessage, stopAgent } from '$lib/services/agent-service';
  import ConversationHistoryPanel from './ConversationHistoryPanel.svelte';
  import { conversationToMarkdown, deriveConversationTitle, markdownFileName } from '$lib/utils/agent/conversation-export';
  import type { ConversationScope } from '$lib/services/conversation-service';
  import {
    activeConversationId, conversationScopeKey, conversationsOf, findConversation,
    instanceConversations as instanceConversationsStore,
    projectConversations as projectConversationsStore,
    restoreConversations, selectConversation, deleteConversation, duplicateConversation,
    loadConversationBody,
    createConversation as createStoredConversation, updateConversationContent,
    setConversationProvider, setConversationSession, renameConversation,
    togglePinned, toggleArchived, moveConversationToScope,
    type ConversationRef,
  } from '$lib/stores/conversation';
  import {
    setAgentBusy, setAgentDone, pingAgentCompletion, doneConversationOf,
    agentActivityKey, agentBusyConversations, agentDoneConversation,
  } from '$lib/stores/agent-activity';
  import { writeFile } from '$lib/services/file-service';
  import { activeStep, terminalActive, commandsActive } from '$lib/stores/ui';
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
    id: string;
    scope: ConversationScope;
    messages: Message[];
    activity: ActivityEntry[];
    draft: string;
    busy: boolean;
    error: string;
    providerId: string;
  }

  interface Run {
    instanceId: string;
    conversationId: string;
    scope: ConversationScope;
    messages: Message[];
    activity: ActivityEntry[];
  }

  let conversations = $state<Record<string, Conversation>>({});
  let runs = $state<Record<string, Run>>({});

  function runOfConversation(conversationId: string): [string, Run] | undefined {
    return Object.entries(runs).find(
      ([, run]) => run.conversationId === conversationId,
    );
  }
  let providerOpen = $state(false);
  let historyOpen = $state(true);
  let loadingConversation = $state(false);
  let drafts = $state<Record<string, string>>({});
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
  let historyScopeKey = $derived(
    $activeInstance ? conversationScopeKey($activeInstance.projectId, $activeInstance.id) : '',
  );
  let historyInstanceList = $derived($instanceConversationsStore[historyScopeKey] ?? []);
  let activityKey = $derived(
    $activeInstance ? agentActivityKey($activeInstance.projectId, $activeInstance.id) : '',
  );
  let runningConversationIds = $derived($agentBusyConversations[activityKey] ?? []);
  let conversationBusy = $derived(!!current && runningConversationIds.includes(current.id));
  let doneConversationId = $derived($agentDoneConversation[activityKey] ?? null);
  let historyProjectList = $derived(
    $activeInstance ? ($projectConversationsStore[$activeInstance.projectId] ?? []) : [],
  );
  let currentProvider = $derived(
    selectableProviders.find((p) => p.id === current?.providerId) ?? selectableProviders[0],
  );

  function refOf(inst: Instance, scope: ConversationScope): ConversationRef {
    return { projectId: inst.projectId, instanceId: inst.id, scope };
  }

  function startedMessage(inst: Instance): Message {
    return { role: 'system', content: `${t('agent.instanceStarted')} · ${inst.ticket.title}`, time: now() };
  }

  function startConversation(inst: Instance, scope: ConversationScope): Conversation {
    const stored = createStoredConversation(
      refOf(inst, scope),
      selectableProviders[0].id,
      t('agent.history.untitled') as string,
    );
    const conv: Conversation = {
      id: stored.id,
      scope,
      messages: [startedMessage(inst)],
      activity: [],
      draft: '',
      busy: false,
      error: '',
      providerId: stored.providerId,
    };
    conversations[inst.id] = conv;
    syncLive(inst);
    return conv;
  }

  function ensureConversation(inst: Instance): Conversation {
    return conversations[inst.id] ?? startConversation(inst, 'instance');
  }

  function syncLive(inst: Instance) {
    const conv = conversations[inst.id];
    if (!conv) return;
    updateConversationContent(
      refOf(inst, conv.scope),
      conv.id,
      $state.snapshot(conv.messages),
      $state.snapshot(conv.activity),
    );
  }

  async function openConversation(inst: Instance, id: string, scope: ConversationScope) {
    const found = findConversation(inst.projectId, inst.id, id);
    if (!found) return;
    const previous = conversations[inst.id];
    if (previous) {
      syncLive(inst);
      drafts[previous.id] = previous.draft;
    }

    const found_run = runOfConversation(id);
    const run = found_run?.[1];
    const rejoining = !!run;

    let messages: Message[];
    let activity: ActivityEntry[];
    if (rejoining && run) {
      messages = run.messages;
      activity = run.activity;
    } else {
      loadingConversation = true;
      const body = await loadConversationBody(found.ref, id);
      loadingConversation = false;
      messages = body.messages;
      activity = body.activity;
    }

    conversations[inst.id] = {
      id: found.meta.id,
      scope,
      messages,
      activity,
      draft: drafts[found.meta.id] ?? '',
      busy: rejoining,
      error: '',
      providerId: found.meta.providerId || selectableProviders[0].id,
    };
    selectConversation(inst.projectId, inst.id, id);
    await autoscroll();
  }

  async function hydrate(inst: Instance) {
    await restoreConversations(inst.projectId, inst.id);
    if (conversations[inst.id]) return;

    const scopeKey = conversationScopeKey(inst.projectId, inst.id);
    const activeStoredId = get(activeConversationId)[scopeKey];
    const found = activeStoredId
      ? findConversation(inst.projectId, inst.id, activeStoredId)
      : null;

    if (found) {
      await openConversation(inst, found.meta.id, found.ref.scope);
    } else {
      startConversation(inst, 'instance');
    }
  }

  function instanceById(instanceId: string): Instance | undefined {
    return get(instancesWithBase).find((i) => i.id === instanceId);
  }

  function setBusy(inst: Instance, conversationId: string, busy: boolean) {
    const live = conversations[inst.id];
    if (live?.id === conversationId) live.busy = busy;
    setAgentBusy(inst.projectId, inst.id, busy, conversationId);
  }

  function persistRun(inst: Instance, run: Run) {
    updateConversationContent(
      refOf(inst, run.scope),
      run.conversationId,
      $state.snapshot(run.messages),
      $state.snapshot(run.activity),
    );
  }

  function endStreaming(run: Run) {
    const last = run.messages.findLast((m) => m.role === 'agent');
    if (last?.streaming) last.streaming = false;
  }

  function isViewingAgent(inst: Instance): boolean {
    return inst.id === $activeInstance?.id && $activeStep === 'agent' && !$terminalActive && !$commandsActive;
  }

  function notifyAgentCompletion(inst: Instance, conversationId: string) {
    if (isViewingAgent(inst) && conversations[inst.id]?.id === conversationId) return;
    setAgentDone(inst.projectId, inst.id, true, conversationId);
    pingAgentCompletion();
  }

  $effect(() => {
    const inst = $activeInstance;
    const openId = inst ? conversations[inst.id]?.id : undefined;
    if (!inst || $activeStep !== 'agent' || $terminalActive || $commandsActive) return;
    const pending = doneConversationOf(inst.projectId, inst.id);
    if (pending === null) return;
    if (pending === '' || pending === openId) {
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
    if (!untrack(() => conversations[inst.id])) void hydrate(inst);
    tick().then(resizeTextarea);
  });

  onMount(async () => {
    unlisten = await listen<{ line: string; source: string; summary?: string; workingDir?: string; runId?: string }>('claude-output', (e) => {
      const { source, line, summary, runId } = e.payload;
      if (!runId) return;

      const run = runs[runId];
      if (!run) return;

      const inst = instanceById(run.instanceId);
      if (!inst) return;

      const live = conversations[inst.id];
      const isLive = live?.id === run.conversationId;

      if (source === 'system') {
        if (line === '[done]') {
          setBusy(inst, run.conversationId, false);
          notifyAgentCompletion(inst, run.conversationId);
          endStreaming(run);
          persistRun(inst, run);
          delete runs[runId];
          return;
        }
        if (line === '[session stopped]') {
          setBusy(inst, run.conversationId, false);
          endStreaming(run);
          persistRun(inst, run);
          delete runs[runId];
          return;
        }
        if (line.startsWith('[error:')) {
          if (isLive && live) live.error = line.slice(8, -1);
          setBusy(inst, run.conversationId, false);
          notifyAgentCompletion(inst, run.conversationId);
          endStreaming(run);
          run.activity.push({ time: now(), icon: 'alert', label: line, source: 'system' });
        }
      } else if (source === 'assistant') {
        const last = run.messages.findLast((m) => m.role === 'agent' && m.streaming);
        if (last) {
          last.content += line;
        } else {
          run.messages.push({ role: 'agent', content: line, time: now(), streaming: true });
        }
      } else if (source === 'tool') {
        run.activity.push({ time: now(), icon: iconForTool(summary), label: line, source: 'tool' });
      } else if (source === 'session') {
        setConversationSession(refOf(inst, run.scope), run.conversationId, line);
      }

      persistRun(inst, run);
      if (isLive) autoscroll();
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

    if (!conv.draft.trim() || runOfConversation(conv.id)) return;

    const message = conv.draft.trim();
    conv.draft = '';
    drafts[conv.id] = '';
    await tick();
    resizeTextarea();
    conv.error = '';

    const t_now = now();
    conv.messages.push({ role: 'user', content: message, time: t_now });
    conv.messages.push({ role: 'agent', content: '', time: t_now, streaming: true });
    conv.activity.push({ time: t_now, icon: 'send', label: message.slice(0, 60) + (message.length > 60 ? '...' : ''), source: 'stdin' });

    const runId = crypto.randomUUID();
    const run: Run = {
      instanceId: inst.id,
      conversationId: conv.id,
      scope: conv.scope,
      messages: conv.messages,
      activity: conv.activity,
    };
    runs[runId] = run;
    setBusy(inst, conv.id, true);

    const ref = refOf(inst, conv.scope);
    const isFirstPrompt = conv.messages.filter((m) => m.role === 'user').length === 1;
    if (isFirstPrompt) renameConversation(ref, conv.id, deriveConversationTitle(message));
    syncLive(inst);

    await autoscroll();

    try {
      const sessionId =
        conversationsOf(ref).find((c) => c.id === conv.id)?.sessionId ?? null;
      await sendMessage(message, inst.worktreePath, conv.providerId, runId, sessionId);
    } catch (e) {
      conv.error = String(e);
      setBusy(inst, conv.id, false);
      endStreaming(run);
      persistRun(inst, run);
      delete runs[runId];
    }
  }

  async function interrupt() {
    if (!current) return;
    const running = runOfConversation(current.id);
    if (!running) return;
    try {
      await stopAgent(running[0]);
    } catch (e) {
      current.error = String(e);
    }
  }

  async function newSession(scope: ConversationScope = 'instance') {
    const inst = $activeInstance;
    if (!inst) return;
    const previous = conversations[inst.id];
    if (previous) {
      syncLive(inst);
      drafts[previous.id] = previous.draft;
    }

    startConversation(inst, scope);
    await autoscroll();
  }

  function pickProvider(providerId: string) {
    const inst = $activeInstance;
    providerOpen = false;
    if (!inst || !current) return;
    current.providerId = providerId;
    setConversationProvider(refOf(inst, current.scope), current.id, providerId);
  }

  function withInstance<A extends unknown[]>(fn: (inst: Instance, ...args: A) => void) {
    return (...args: A) => {
      const inst = $activeInstance;
      if (inst) fn(inst, ...args);
    };
  }

  const handleSelect = withInstance((inst, id: string, scope: ConversationScope) => {
    void openConversation(inst, id, scope);
  });

  const handleCreate = withInstance((_inst, scope: ConversationScope) => {
    void newSession(scope);
  });

  const handleRename = withInstance((inst, id: string, scope: ConversationScope, title: string) => {
    renameConversation(refOf(inst, scope), id, title);
  });

  const handleDelete = withInstance((inst, id: string, scope: ConversationScope) => {
    const running = runOfConversation(id);
    if (running) {
      void stopAgent(running[0]).catch(() => {});
      delete runs[running[0]];
      setBusy(inst, id, false);
    }
    deleteConversation(refOf(inst, scope), id);
    if (conversations[inst.id]?.id === id) {
      const remaining = conversationsOf(refOf(inst, scope))[0];
      if (remaining) void openConversation(inst, remaining.id, scope);
      else startConversation(inst, 'instance');
    }
  });

  const handleDuplicate = withInstance((inst, id: string, scope: ConversationScope) => {
    const source = conversationsOf(refOf(inst, scope)).find((c) => c.id === id);
    if (!source) return;
    void duplicateConversation(refOf(inst, scope), id, `${source.title} (${t('agent.history.copySuffix')})`);
  });

  const handleTogglePin = withInstance((inst, id: string, scope: ConversationScope) => {
    togglePinned(refOf(inst, scope), id);
  });

  const handleToggleArchive = withInstance((inst, id: string, scope: ConversationScope) => {
    toggleArchived(refOf(inst, scope), id);
  });

  const handleDownload = withInstance((inst, id: string, scope: ConversationScope) => {
    const ref = refOf(inst, scope);
    const source = conversationsOf(ref).find((c) => c.id === id);
    if (!source) return;
    void downloadConversation(ref, source.id, source.title);
  });

  async function downloadConversation(ref: ConversationRef, id: string, title: string) {
    const [body, { save }] = await Promise.all([
      loadConversationBody(ref, id),
      import('@tauri-apps/plugin-dialog'),
    ]);
    const path = await save({
      defaultPath: `${markdownFileName(title)}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (!path) return;
    await writeFile(path, conversationToMarkdown(title, body.messages));
  }

  const handleMoveScope = withInstance((inst, from: ConversationScope, id: string) => {
    void moveConversationToScope(refOf(inst, from), id);
    if (conversations[inst.id]?.id === id) {
      conversations[inst.id].scope = from === 'instance' ? 'project' : 'instance';
    }
  });

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

<div
  class="agent-split"
  style="grid-template-columns: {historyOpen ? '240px ' : ''}minmax(0, 1fr) {activityWidth}px;"
>
  {#if historyOpen}
    <ConversationHistoryPanel
      instanceConversations={historyInstanceList}
      projectConversations={historyProjectList}
      activeId={current?.id ?? null}
      runningIds={runningConversationIds}
      doneId={doneConversationId}
      onSelect={handleSelect}
      onCreate={handleCreate}
      onRename={handleRename}
      onDelete={handleDelete}
      onDuplicate={handleDuplicate}
      onTogglePin={handleTogglePin}
      onToggleArchive={handleToggleArchive}
      onDownload={handleDownload}
      onMoveScope={handleMoveScope}
    />
  {/if}

  <div class="agent-chat">
    <div class="pane-header">
      <div class="pane-title">
        <button
          class="history-toggle"
          class:active={historyOpen}
          title={t('agent.history.toggle') as string}
          aria-label={t('agent.history.toggle') as string}
          onclick={() => { historyOpen = !historyOpen; }}
        >
          <Icon name="clock" size={13}/>
        </button>
        <span class="pane-title-sep"></span>
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
                  onclick={() => pickProvider(p.id)}
                >
                  {p.name}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      </div>
      <div class="pane-actions">
        <button class="btn ghost" onclick={() => newSession()} disabled={!current || conversationBusy}>
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
      {#if loadingConversation}
        <div class="chat-skeleton"><Skeleton lines={6} gap={14}/></div>
      {:else}
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
      {/if}
    </div>

    <div class="chat-input-wrap">
      <div class="chat-input">
        {#if current}
          <textarea
            bind:this={textareaEl}
            placeholder={conversationBusy ? (t('agent.waitingResponse') as string) : (t('agent.inputPlaceholder') as string)}
            bind:value={current.draft}
            oninput={resizeTextarea}
            onkeydown={onKeydown}
            disabled={conversationBusy}
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
          {#if conversationBusy}
            <button class="btn btn-stop" onclick={interrupt}>
              <Icon name="stop" size={12}/> {t('agent.interrupt')}<span class="kbd">{MOD_LABEL}.</span>
            </button>
          {:else}
            <button
              class="btn"
              onclick={send}
              disabled={!current || !current.draft.trim() || conversationBusy}
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
          <div class="act-row" class:live={entry.source === 'stdin' && conversationBusy}>
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
  .history-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 3px;
    margin-right: 2px;
    color: var(--fg-3);
    background: transparent;
    border: none;
    border-radius: var(--r-xs);
    cursor: pointer;
    transition: color 0.1s, background 0.1s;
  }

  .history-toggle:hover { color: var(--fg-0); background: var(--bg-2); }
  .history-toggle.active { color: var(--accent); }

  .pane-title-sep {
    width: 1px;
    height: 14px;
    margin: 0 8px 0 4px;
    background: var(--stroke-1);
  }

  .chat-skeleton { padding: 8px 4px; }

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
