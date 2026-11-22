<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * Confirmation before unregistering a project from Cairn: what goes with it
   * (its instances and their worktrees, the uncommitted work among them, what
   * Cairn keeps about it) and what stays, the folder itself.
   * Forwards `confirm` and `close`.
   */
  import { t } from '#lib/i18n';
  import Icon from '#lib/components/Icon.svelte';
  import ConfirmModal from '#lib/components/ConfirmModal.svelte';
  import { loadedInstances } from '#lib/stores/instance';
  import { activeInstancesOf, worktreeKey, worktreeStates } from '#lib/stores/project-overview';
  import type { Project } from '#lib/types/project';

  export let project: Project;

  /** Branches shown by name; the rest are counted. */
  const SHOWN_BRANCHES = 4;

  /** An adopted worktree lives outside the project data and is left where it is. */
  $: instances = activeInstancesOf($loadedInstances, project.id).filter((i) => !i.external);
  $: dirtyCount = instances.filter((i) => {
    const state = $worktreeStates[worktreeKey(project.id, i.id)];
    return state !== undefined && state.added + state.removed > 0;
  }).length;
</script>

<ConfirmModal
  title={(t('deleteProject.title') as (name: string) => string)(project.name)}
  confirmLabel={t('deleteProject.deleteProject') as string}
  on:close
  on:confirm
>
  <svelte:fragment slot="subject">
    <span class="dp-swatch" style="background: {project.color}"></span>
    <span class="cm-text">
      <span class="cm-name">{project.name}</span>
      <span class="cm-sub dp-path selectable" title={project.path}>{project.path}</span>
    </span>
  </svelte:fragment>

  <section class="cm-section">
    <h3>{t('deleteProject.removedTitle')}</h3>
    <ul class="cm-list">
      {#if instances.length > 0}
        <li class="dp-instances">
          <Icon name="layers" size={14}/>
          <span class="dp-text">
            {(t('deleteProject.instances') as (n: number) => string)(instances.length)}
            <span class="dp-branches">
              {#each instances.slice(0, SHOWN_BRANCHES) as instance (instance.id)}
                <code class="dp-branch">{instance.branch}</code>
              {/each}
              {#if instances.length > SHOWN_BRANCHES}
                <span class="dp-more">+{instances.length - SHOWN_BRANCHES}</span>
              {/if}
            </span>
            {#if dirtyCount > 0}
              <span class="dp-warn">
                {(t('deleteProject.uncommitted') as (n: number, total: number) => string)(dirtyCount, instances.length)}
              </span>
            {/if}
          </span>
        </li>
      {/if}
      <li>
        <Icon name="message" size={14}/>
        <span class="dp-text">{t('deleteProject.cairnData')}</span>
      </li>
    </ul>
  </section>

  <p class="cm-note">
    <Icon name="folder" size={13}/>
    {t('deleteProject.keptNote')}
  </p>
</ConfirmModal>

<style>
  .dp-swatch { flex: none; width: 10px; height: 10px; margin: 0 4px; border-radius: 3px; }
  .dp-path { font-family: var(--font-mono); }
  .cm-list li :global(.ic) { flex: none; color: var(--fg-3); }
  .dp-instances :global(.ic) { align-self: flex-start; margin-top: 2px; }
  .dp-text { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .dp-branches { display: flex; flex-wrap: wrap; gap: 4px; }
  .dp-branch {
    padding: 0 6px;
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 18px;
    color: var(--fg-2);
    background: var(--bg-2);
    border: 1px solid var(--stroke-0);
    border-radius: 4px;
  }
  .dp-more { font-size: 11.5px; line-height: 20px; color: var(--fg-3); }
  .dp-warn { font-size: 12px; color: var(--danger); }
</style>
