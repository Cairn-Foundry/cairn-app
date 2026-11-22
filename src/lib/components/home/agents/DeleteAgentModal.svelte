<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * Confirmation before deleting an agent definition: the agent, every file it
   * was written to with the CLIs that read each one, and what they lose.
   * Forwards `confirm` and `close`.
   */
  import { t } from '#lib/i18n';
  import Icon from '#lib/components/Icon.svelte';
  import ConfirmModal from '#lib/components/ConfirmModal.svelte';
  import ProviderChips from '#lib/components/home/ProviderChips.svelte';
  import AgentAvatar from './AgentAvatar.svelte';
  import type { NativeAgent } from '#lib/services/native-agent-service';

  export let agent: NativeAgent;
</script>

<ConfirmModal
  title={(t('agentDefs.delete.title') as (name: string) => string)(agent.name)}
  confirmLabel={t('agentDefs.delete.confirm') as string}
  on:close
  on:confirm
>
  <svelte:fragment slot="subject">
    <AgentAvatar name={agent.name} color={agent.color}/>
    <span class="cm-text">
      <span class="cm-name">{agent.name}</span>
      <span class="cm-sub">{agent.scope === 'project' ? agent.projectName : t('agentDefs.scope.global')}</span>
    </span>
  </svelte:fragment>

  <section class="cm-section">
    <h3>{t('agentDefs.delete.filesTitle')}</h3>
    <ul class="cm-list">
      {#each agent.locations as location (location.path)}
        <li>
          <ProviderChips providers={location.providers} size={12}/>
          <code class="da-path selectable" title={location.path}>{location.path}</code>
        </li>
      {/each}
    </ul>
  </section>

  <p class="cm-note">
    <Icon name="at" size={13}/>
    {(t('agentDefs.delete.effect') as (name: string) => string)(agent.name)}
  </p>
</ConfirmModal>

<style>
  .da-path {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--fg-2);
  }
</style>
