<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * Confirmation before deleting a skill: the skill, every folder it was
   * written to with the CLIs that read each one, and the files it ships with.
   * Forwards `confirm` and `close`.
   */
  import { t } from '#lib/i18n';
  import Icon from '#lib/components/Icon.svelte';
  import ConfirmModal from '#lib/components/ConfirmModal.svelte';
  import ProviderChips from '#lib/components/home/ProviderChips.svelte';
  import type { Skill } from '#lib/services/skill-service';

  export let skill: Skill;
</script>

<ConfirmModal
  title={(t('skills.delete.title') as (name: string) => string)(skill.name)}
  confirmLabel={t('skills.delete.confirm') as string}
  on:close
  on:confirm
>
  <svelte:fragment slot="subject">
    <span class="ds-tile"><Icon name="book" size={14}/></span>
    <span class="cm-text">
      <span class="cm-name">{skill.name}</span>
      <span class="cm-sub">{skill.scope === 'project' ? skill.projectName : t('skills.scope.global')}</span>
    </span>
  </svelte:fragment>

  <section class="cm-section">
    <h3>{t('skills.delete.foldersTitle')}</h3>
    <ul class="cm-list">
      {#each skill.locations as location (location.path)}
        <li>
          <ProviderChips providers={location.providers} size={12}/>
          <code class="ds-path selectable" title={location.path}>{location.path}</code>
        </li>
      {/each}
    </ul>
  </section>

  <p class="cm-note">
    <Icon name="file" size={13}/>
    {skill.resources.length === 0
      ? t('skills.delete.onlySkillMd')
      : (t('skills.delete.withFiles') as (n: number) => string)(skill.resources.length)}
  </p>
</ConfirmModal>

<style>
  .ds-tile {
    display: grid;
    flex: none;
    place-items: center;
    width: 28px;
    height: 28px;
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-sm);
    background: var(--bg-2);
    color: var(--fg-2);
  }
  .ds-path {
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
