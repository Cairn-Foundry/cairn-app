<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * Editor for the repository-local ignore file (`info/exclude` in the common git
   * dir). It applies to every worktree of the repo and is never committed.
   */
  import { onMount } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import { t } from '$lib/i18n';
  import { activeInstance } from '$lib/stores/instance';
  import { readExclude, writeExclude } from '$lib/stores/git';

  let content = '';
  let saved = '';
  let isLoading = true;
  let isSaving = false;
  let loadedWorktree: string | null = null;

  $: worktreePath = $activeInstance?.worktreePath ?? null;
  $: isDirty = content !== saved;
  $: if (worktreePath && worktreePath !== loadedWorktree) load(worktreePath);

  async function load(wt: string) {
    loadedWorktree = wt;
    isLoading = true;
    try {
      saved = await readExclude();
      content = saved;
    } catch {
      saved = '';
      content = '';
    } finally {
      isLoading = false;
    }
  }

  async function save() {
    if (isSaving || !isDirty) return;
    isSaving = true;
    const pending = content;
    try {
      await writeExclude(pending);
      saved = pending.endsWith('\n') || pending === '' ? pending : `${pending}\n`;
      content = saved;
    } catch {
      // The store publishes the git error
    } finally {
      isSaving = false;
    }
  }

  function revert() {
    content = saved;
  }

  function handleKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      save();
    }
  }

  onMount(() => {
    if (worktreePath) load(worktreePath);
    else isLoading = false;
  });
</script>

<div class="gitignore-toolbar">
  <span class="gitignore-path selectable">.git/info/exclude</span>
  <div class="gitignore-actions">
    {#if isDirty}
      <button class="btn" on:click={revert} disabled={isSaving}>
        {t('git.gitignoreRevert')}
      </button>
    {/if}
    <button class="btn primary" on:click={save} disabled={!isDirty || isSaving}>
      {#if isSaving}
        <Spinner size={11}/>
      {:else}
        <Icon name="check" size={12}/>
      {/if}
      {t('git.gitignoreSave')}
    </button>
  </div>
</div>

<p class="gitignore-hint">{t('git.gitignoreHint')}</p>

<div class="gitignore-body">
  {#if isLoading}
    <div class="gitignore-skeleton"><Skeleton lines={8}/></div>
  {:else}
    <textarea
      class="gitignore-input selectable"
      bind:value={content}
      on:keydown={handleKeydown}
      spellcheck="false"
      placeholder={t('git.gitignorePlaceholder') as string}
    ></textarea>
  {/if}
</div>

<style>
  .gitignore-toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--stroke-0);
    flex-shrink: 0;
  }

  .gitignore-path {
    flex: 1;
    min-width: 0;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-4);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .gitignore-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .gitignore-actions .btn {
    font-size: 11px;
    padding: 4px 10px;
    white-space: nowrap;
  }

  .gitignore-hint {
    margin: 0;
    padding: 8px 10px;
    font-size: 11px;
    line-height: 1.5;
    color: var(--fg-4);
    border-bottom: 1px solid var(--stroke-0);
    flex-shrink: 0;
  }

  .gitignore-body {
    flex: 1;
    display: flex;
    min-height: 0;
  }

  .gitignore-skeleton {
    flex: 1;
    padding: 10px;
  }

  .gitignore-input {
    flex: 1;
    resize: none;
    border: none;
    outline: none;
    background: transparent;
    color: var(--fg-1);
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.6;
    padding: 10px;
    tab-size: 2;
  }
</style>
