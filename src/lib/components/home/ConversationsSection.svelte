<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * Every running conversation of every project and instance, what waits for
   * the user first, then those the last close of the app interrupted. A row
   * opens that project, that instance and that conversation, which resumes an
   * interrupted one.
   */
  import AgentStatusDot from '#lib/components/agent/AgentStatusDot.svelte';
  import ProviderLogo from '#lib/components/home/agents/ProviderLogo.svelte';
  import { t } from '#lib/i18n';
  import {
    interruptedConversations,
    type LiveConversation,
    liveConversations,
  } from '#lib/stores/agent-status';
  import { needsAttention, statusLabelKey } from '#lib/utils/agent/agent-status';

  interface Props {
    onOpen: (conversation: LiveConversation) => void;
  }

  const { onOpen }: Props = $props();
</script>

{#if $liveConversations.length > 0}
  <div class="list">
    {#each $liveConversations as c (c.id)}
      <button class="row" class:attention={needsAttention(c.status)} onclick={() => onOpen(c)}>
        <AgentStatusDot status={c.status} decorative/>
        <span class="mark">
          <ProviderLogo id={c.cli} size={16} fallback={c.cli.slice(0, 1)}/>
        </span>
        <span class="info">
          <span class="title">{c.title || t('agent.history.untitled')}</span>
          <span class="where">
            <span class="swatch" style="background: {c.projectColor}"></span>
            {c.projectName} · {c.instanceLabel}
          </span>
        </span>
        <span class="status {c.status ?? 'running'}">{t(statusLabelKey(c.status))}</span>
      </button>
    {/each}
  </div>
{:else if $interruptedConversations.length === 0}
  <div class="empty">{t('home.sections.conversationsEmpty')}</div>
{/if}
{#if $interruptedConversations.length > 0}
  <h2 class="group">{t('home.sections.conversationsInterrupted')}</h2>
  <div class="group-hint">{t('home.sections.conversationsInterruptedHint')}</div>
  <div class="list">
    {#each $interruptedConversations as c (c.id)}
      <button class="row" onclick={() => onOpen(c)}>
        <span class="agent-dot-stopped" aria-hidden="true"></span>
        <span class="mark">
          <ProviderLogo id={c.cli} size={16} fallback={c.cli.slice(0, 1)}/>
        </span>
        <span class="info">
          <span class="title">{c.title || t('agent.history.untitled')}</span>
          <span class="where">
            <span class="swatch" style="background: {c.projectColor}"></span>
            {c.projectName} · {c.instanceLabel}
          </span>
        </span>
        <span class="status">{t('home.sections.conversationsResume')}</span>
      </button>
    {/each}
  </div>
{/if}
<div class="hint">{t('home.sections.conversationsHooksHint')}</div>

<style>
  .empty {
    color: var(--fg-3);
    font-size: 13px;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-width: 760px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border-radius: var(--r-sm);
    text-align: left;
    color: var(--fg-1);
    cursor: pointer;
  }
  .row:hover { background: var(--bg-2); color: var(--fg-0); }
  .row.attention { background: var(--bg-1); }
  .row.attention:hover { background: var(--bg-2); }
  .mark {
    display: inline-flex;
    flex: none;
    color: var(--fg-2);
  }
  .info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }
  .title {
    font-size: 13px;
    color: var(--fg-0);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .where {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11.5px;
    color: var(--fg-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .swatch {
    width: 8px;
    height: 8px;
    border-radius: 2px;
    flex: none;
  }
  .status {
    flex: none;
    font-size: 11.5px;
    color: var(--fg-3);
  }
  .status.waiting { color: var(--warning); }
  .status.done { color: var(--success); }
  .status.working { color: var(--accent); }
  .group {
    margin: 24px 0 2px;
    font-size: 13px;
    font-weight: 600;
    color: var(--fg-1);
  }
  .group-hint {
    margin-bottom: 8px;
    font-size: 11.5px;
    color: var(--fg-3);
  }
  .agent-dot-stopped {
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1.5px var(--fg-3);
  }
  .hint {
    margin-top: 20px;
    font-size: 11.5px;
    color: var(--fg-4);
    max-width: 760px;
  }
</style>
