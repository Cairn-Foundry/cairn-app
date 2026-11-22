<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * Confirmation before removing an integration connection: the connection
   * itself, then every project bound to it with what that project loses.
   * Forwards `confirm` and `close`; the parent does the removal.
   */
  import { onMount } from 'svelte';
  import { t } from '#lib/i18n';
  import Icon from '#lib/components/Icon.svelte';
  import ConfirmModal from '#lib/components/ConfirmModal.svelte';
  import Skeleton from '#lib/components/Skeleton.svelte';
  import { projects } from '#lib/stores/project';
  import { bindingsByProject, loadProjectIntegrations } from '#lib/stores/integrations';
  import type { Capability, IntegrationConnection } from '#lib/types/integrations';

  export let connection: IntegrationConnection;
  export let icon: string;
  export let host: string;
  export let isRemoving = false;

  const CAPABILITY_LABELS: Record<Capability, string> = {
    tracker: t('integrations.bindings.tracker') as string,
    forge: t('integrations.bindings.forge') as string,
    ci: t('integrations.bindings.ci') as string,
  };

  let isLoaded = false;

  onMount(async () => {
    await Promise.all($projects.map((p) => loadProjectIntegrations(p.id).catch(() => undefined)));
    isLoaded = true;
  });

  $: affected = $projects
    .map((project) => {
      const bindings = $bindingsByProject[project.id];
      const lost = (['tracker', 'forge', 'ci'] as Capability[])
        .filter((capability) => bindings?.[capability]?.connectionId === connection.id);
      return { project, lost };
    })
    .filter((entry) => entry.lost.length > 0);
</script>

<ConfirmModal
  title={(t('integrations.removeTitle') as (l: string) => string)(connection.label)}
  confirmLabel={t('integrations.removeAction') as string}
  isBusy={isRemoving}
  on:close
  on:confirm
>
  <svelte:fragment slot="subject">
    <span class="rc-tile"><Icon name={icon} size={16}/></span>
    <span class="cm-text">
      <span class="cm-name">{connection.label}</span>
      <span class="cm-sub">
        {#if connection.identity}{connection.identity.login} {(t('integrations.connectedOn') as (h: string) => string)(host)}{:else}{host}{/if}
      </span>
    </span>
  </svelte:fragment>

  <section class="cm-section">
    <h3>{t('integrations.removeProjectsTitle')}</h3>
    {#if !isLoaded}
      <Skeleton lines={2} height={12}/>
    {:else if affected.length === 0}
      <p class="rc-none">{t('integrations.removeNoProject')}</p>
    {:else}
      <ul class="cm-list">
        {#each affected as { project, lost } (project.id)}
          <li>
            <span class="rc-swatch" style="background: {project.color}"></span>
            <span class="rc-project">{project.name}</span>
            <span class="rc-lost">
              {#each lost as capability (capability)}
                <span class="rc-chip">{CAPABILITY_LABELS[capability]}</span>
              {/each}
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  {#if connection.hasCredentials}
    <p class="cm-note rc-token">
      <Icon name="key" size={13}/>
      {t('integrations.removeTokenNote')}
    </p>
  {/if}
</ConfirmModal>

<style>
  .rc-tile {
    display: grid;
    flex: none;
    place-items: center;
    width: 32px;
    height: 32px;
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-sm);
    background: var(--bg-2);
    color: var(--fg-1);
  }
  .rc-none { margin: 0; font-size: 12.5px; color: var(--fg-3); }
  .rc-swatch { flex: none; width: 8px; height: 8px; border-radius: 2px; }
  .rc-project {
    flex: 1;
    min-width: 0;
    color: var(--fg-0);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rc-lost { display: flex; flex: none; gap: 4px; }
  .rc-chip {
    padding: 0 6px;
    font-size: 11px;
    line-height: 18px;
    color: var(--danger);
    background: var(--danger-weak);
    border-radius: 4px;
  }
</style>
