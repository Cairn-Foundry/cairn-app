<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n';
  import { activeInstance } from '$lib/stores/instance';
  import { PROVIDERS } from '$lib/components/home/agents/providers-data';

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
    source: 'stdin' | 'stdout' | 'system';
  }

  let providerId = $state(selectableProviders[0].id);
  let providerOpen = $state(false);
  let messages = $state<Message[]>([]);
  let activity = $state<ActivityEntry[]>([]);
  let draft = $state('');
  let busy = $state(false);
  let error = $state('');
  let scrollEl: HTMLElement;
  let activityEl: HTMLElement;
  let providerBtnEl: HTMLElement;
  let unlisten: UnlistenFn | undefined;

  let currentProvider = $derived(selectableProviders.find((p) => p.id === providerId) ?? selectableProviders[0]);

  function now(): string {
    return new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
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

  onMount(async () => {
    messages = [
      { role: 'system', content: $activeInstance ? `Instance démarrée · ${$activeInstance.ticket.title}` : 'Aucune instance active', time: now() },
    ];

    unlisten = await listen<{ line: string; source: string }>('claude-output', (e) => {
      const { source, line } = e.payload;

      if (source === 'system') {
        if (line === '[done]' || line === '[session reset]' || line === '[session stopped]') {
          busy = false;
          const last = messages.findLast((m) => m.role === 'agent');
          if (last?.streaming) last.streaming = false;
        } else if (line.startsWith('[error:')) {
          error = line.slice(8, -1);
          busy = false;
          const last = messages.findLast((m) => m.role === 'agent');
          if (last?.streaming) last.streaming = false;
        }
        activity.push({ time: now(), icon: 'alert', label: line, source: 'system' });
      } else if (source === 'stdout') {
        const last = messages.findLast((m) => m.role === 'agent' && m.streaming);
        if (last) {
          last.content = line;
        } else {
          messages.push({ role: 'agent', content: line, time: now() });
        }
        activity.push({ time: now(), icon: 'sparkles', label: "Réponse de l'agent reçue", source: 'stdout' });
      }

      autoscroll();
    });

    await autoscroll();
  });

  onDestroy(() => {
    unlisten?.();
  });

  async function send() {
    if (!draft.trim() || busy || !$activeInstance) return;

    const message = draft.trim();
    draft = '';
    error = '';
    busy = true;

    const t_now = now();
    messages.push({ role: 'user', content: message, time: t_now });
    messages.push({ role: 'agent', content: '', time: t_now, streaming: true });
    activity.push({ time: t_now, icon: 'send', label: message.slice(0, 60) + (message.length > 60 ? '…' : ''), source: 'stdin' });

    await autoscroll();

    try {
      await invoke('send_message', {
        message,
        workingDir: $activeInstance.worktreePath,
        providerId,
      });
    } catch (e) {
      error = String(e);
      busy = false;
      const last = messages.findLast((m) => m.role === 'agent' && m.streaming);
      if (last) last.streaming = false;
    }
  }

  async function interrupt() {
    try {
      await invoke('stop_agent', { providerId });
    } catch (e) {
      error = String(e);
    }
  }

  async function newSession() {
    error = '';
    try {
      await invoke('reset_agent_session', { providerId });
      messages = [
        { role: 'system', content: $activeInstance ? `Session réinitialisée · ${$activeInstance.ticket.title}` : 'Session réinitialisée', time: now() },
      ];
      activity = [];
    } catch (e) {
      error = String(e);
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      send();
    }
  }
</script>

<svelte:window onclick={onWindowClick}/>

<div class="agent-split">
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
                  class:active={p.id === providerId}
                  onclick={() => { providerId = p.id; providerOpen = false; }}
                >
                  {p.name}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      </div>
      <div class="pane-actions">
        <button class="btn ghost" onclick={newSession} disabled={busy}>
          <Icon name="plus" size={13}/> {t('agent.restart')}
        </button>
      </div>
    </div>

    {#if error}
      <div style="padding: 6px 14px; background: rgba(255,80,80,.08); border-bottom: 1px solid rgba(255,80,80,.25); color: #ff8080; font-family: var(--font-mono); font-size: 11px;">
        {error}
      </div>
    {/if}

    <div class="chat-scroll" bind:this={scrollEl}>
      {#each messages as m}
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
                  <Icon name="sparkles" size={12} style="vertical-align: -1px; margin-right: 4px;"/>Agent
                {/if}
              </span>
              <span>·</span>
              <span>{m.time}</span>
              {#if m.streaming}
                <span>·</span>
                <span style="color: var(--accent)">{t('agent.streaming')}</span>
              {/if}
            </div>
            <div class="bubble">
              {#if m.streaming && !m.content}
                <p><span class="typing-dots"><span></span><span></span><span></span></span></p>
              {:else}
                <p>{@html m.content}</p>
              {/if}
            </div>
          </div>
        {/if}
      {/each}
    </div>

    <div class="chat-input-wrap">
      <div class="chat-input">
        <textarea
          placeholder={!$activeInstance ? 'Aucune instance active' : busy ? 'En attente de réponse…' : (t('agent.inputPlaceholder') as string)}
          bind:value={draft}
          onkeydown={onKeydown}
          disabled={busy || !$activeInstance}
        ></textarea>
        <div class="chat-input-row">
          <span class="profile-picker"><span class="dot"></span> feature</span>
          {#if $activeInstance}
            <span class="chip"><Icon name="attach" size={11}/> {$activeInstance.ticket.id} · {$activeInstance.ticket.title}</span>
          {/if}
          <span class="chip"><Icon name="at" size={11}/> {t('agent.mentionFile')}</span>
          <div class="spacer"></div>
          {#if busy}
            <button class="btn btn-stop" onclick={interrupt}>
              <Icon name="stop" size={12}/> {t('agent.interrupt')}<span class="kbd">⌘.</span>
            </button>
          {:else}
            <button
              class="btn"
              onclick={send}
              disabled={!$activeInstance || !draft.trim()}
            >
              <Icon name="send" size={12}/> {t('agent.sendBtn')}<span class="kbd">⌘↵</span>
            </button>
          {/if}
        </div>
      </div>
    </div>
  </div>

  <div class="activity">
    <div class="activity-head">
      <span class="live-dot"></span>
      {t('agent.liveActivity')}
      <span class="pause"><Icon name="pause" size={11}/> {t('agent.autoScroll')}</span>
    </div>
    <div class="activity-list" bind:this={activityEl}>
      {#if activity.length === 0}
        <div style="padding: 16px 12px; color: var(--fg-3); font-size: 12px; font-style: italic;">
          {$activeInstance ? "En attente de l'agent…" : 'Aucune instance active'}
        </div>
      {:else}
        {#each activity as entry}
          <div class="act-row" class:live={entry.source === 'stdin' && busy}>
            <span class="act-time">{entry.time}</span>
            <span class="act-icon" class:write={entry.source === 'stdout'} class:ok={entry.source === 'system' && entry.label.includes('reset')}>
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
