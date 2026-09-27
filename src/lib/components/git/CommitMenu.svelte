<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts" context="module">
  import type { CommitAction } from '$lib/services/git-service';

  type MenuItem = { action: CommitAction; icon: string; danger?: boolean; disabled?: boolean };

  /**
   * One definition for every list a commit can be acted on from, grouped by
   * what the action does to the repository: reading it, adding a ref to it,
   * bringing the commit somewhere else, and finally moving the branch - which
   * is the group that can lose work, so it comes last.
   */
  type GroupId = 'copy' | 'create' | 'apply' | 'reset';
  export const COMMIT_MENU_GROUPS: { id: GroupId; items: MenuItem[] }[] = [
    {
      id: 'copy',
      items: [
        { action: 'copy-hash', icon: 'copy' },
        { action: 'copy-message', icon: 'copy' },
      ],
    },
    {
      id: 'create',
      items: [
        { action: 'branch-from', icon: 'branch' },
        { action: 'tag-from', icon: 'bookmark' },
      ],
    },
    {
      id: 'apply',
      items: [
        { action: 'cherry-pick', icon: 'git' },
        { action: 'revert', icon: 'undo' },
        { action: 'rebase', icon: 'upload' },
      ],
    },
    {
      id: 'reset',
      items: [
        { action: 'reset-soft', icon: 'undo' },
        { action: 'reset-mixed', icon: 'layers' },
        { action: 'reset-hard', icon: 'warning', danger: true },
      ],
    },
  ];

  const ROW_H = 26;
  const SEPARATOR_H = 7;

  /** Where the menu fits on screen for a right-click at this point. */
  export function commitMenuPosition(e: MouseEvent): { x: number; y: number } {
    const height = COMMIT_MENU_GROUPS.reduce(
      (total, group) => total + SEPARATOR_H + group.items.length * ROW_H,
      16,
    );
    return {
      x: Math.min(e.clientX, window.innerWidth - 220),
      y: Math.min(e.clientY, window.innerHeight - height),
    };
  }
</script>

<script lang="ts">
  /**
   * The actions a commit offers, shown wherever commits are listed - the graph
   * and the history both open this one menu, so an action added here appears in
   * both rather than in whichever list happened to be updated.
   */
  import { createEventDispatcher } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n';
  import { clickOutside } from '$lib/utils/click-outside';

  export let x: number;
  export let y: number;
  /** Named when the project has a forge, adding the entry that opens it there. */
  export let forgeLabel = '';

  const dispatch = createEventDispatcher<{
    pick: CommitAction;
    openOnForge: void;
    close: void;
  }>();
</script>

<div
  class="commit-menu"
  role="menu"
  style="left:{x}px; top:{y}px"
  use:clickOutside={() => dispatch('close')}
>
  {#each COMMIT_MENU_GROUPS as group (group.id)}
    <div class="commit-menu-group" role="group">
      {#each group.items as { action, icon, danger, disabled } (action)}
        <button
          role="menuitem"
          class:danger={danger}
          disabled={disabled}
          on:click={() => dispatch('pick', action)}
        >
          <Icon name={icon} size={12}/>
          <span class="commit-menu-label">{t(`git.commitMenu.${action}`)}</span>
          {#if disabled}
            <span class="commit-menu-tag">{t('git.commitMenuUnavailable')}</span>
          {/if}
        </button>
      {/each}
    </div>
  {/each}
  {#if forgeLabel}
    <div class="commit-menu-group" role="group">
      <button role="menuitem" on:click={() => dispatch('openOnForge')}>
        <Icon name="external" size={12}/>
        <span class="commit-menu-label">
          {(t('integrations.openOn') as (s: string) => string)(forgeLabel)}
        </span>
      </button>
    </div>
  {/if}
</div>

<style>
  .commit-menu {
    position: fixed;
    z-index: 1200;
    min-width: 200px;
    display: flex;
    flex-direction: column;
    padding: 4px;
    gap: 1px;
    background: var(--bg-1);
    border: 1px solid var(--stroke-0);
    border-radius: 6px;
    box-shadow: 0 8px 24px oklch(0 0 0 / 0.28);
  }
  .commit-menu button {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 5px 7px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--fg-1);
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }
  .commit-menu button:hover:not(:disabled) { background: var(--bg-2); color: var(--fg-0); }
  .commit-menu button.danger { color: var(--danger); }
  .commit-menu button:disabled { opacity: 0.45; cursor: default; }
  .commit-menu-label { flex: 1; min-width: 0; }
  .commit-menu-tag {
    font-size: 10px;
    color: var(--fg-3);
    text-transform: lowercase;
  }
  .commit-menu-group + .commit-menu-group {
    margin-top: 3px;
    border-top: 1px solid var(--stroke-0);
    padding-top: 3px;
  }
</style>
