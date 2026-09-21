<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * Confirmation before deleting an instance, and the choice of what happens to
   * its worktree: cleaned up, or left on disk with only the link forgotten.
   * The default follows who made it - Cairn's own worktree goes, an adopted one
   * stays - but either can be overridden here, wherever the directory lives.
   * Dispatches `confirm` with { removeWorktree } or `close`.
   */
  import { createEventDispatcher } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n';
  import type { Instance } from '$lib/types/instance';

  export let instance: Instance;

  const dispatch = createEventDispatcher<{ close: void; confirm: { removeWorktree: boolean } }>();

  let removeWorktree = !instance.external;
</script>

<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<div
  class="modal-backdrop"
  role="dialog"
  aria-modal="true"
  tabindex="-1"
  on:click={() => dispatch('close')}
  on:keydown={(e) => e.key === 'Escape' && dispatch('close')}
>
  <div class="modal del-modal" on:click|stopPropagation role="presentation">
    <div class="modal-head">
      <div>
        <div class="step-count">{t('deleteInstance.heading')}</div>
        <h3>{(t('deleteInstance.title') as (name: string) => string)(instance.ticket.title)}</h3>
      </div>
      <button class="icon-btn close" on:click={() => dispatch('close')} aria-label={t('common.close') as string}>
        <Icon name="x" size={16}/>
      </button>
    </div>
    <div class="modal-body">
      <p class="del-desc">
        {instance.external ? t('deleteInstance.descriptionAdopted') : t('deleteInstance.description')}
      </p>

      <label class="del-toggle">
        <div class="del-toggle-text">
          <span class="del-label">{t('deleteInstance.removeWorktree')}</span>
          <span class="del-toggle-desc">
            {removeWorktree ? t('deleteInstance.removeWorktreeDesc') : t('deleteInstance.keepWorktreeDesc')}
          </span>
          <span class="del-path selectable">{instance.worktreePath}</span>
        </div>
        <button
          type="button"
          class="toggle-btn"
          class:on={removeWorktree}
          on:click={() => removeWorktree = !removeWorktree}
          aria-pressed={removeWorktree}
          aria-label={t('deleteInstance.removeWorktree') as string}
        >
          <span class="toggle-thumb"></span>
        </button>
      </label>
    </div>
    <div class="modal-foot">
      <div class="spacer"></div>
      <button class="btn ghost" on:click={() => dispatch('close')}>{t('common.cancel')}</button>
      <button class="btn danger" on:click={() => dispatch('confirm', { removeWorktree })}>
        <Icon name="trash" size={14}/> {t('deleteInstance.deleteInstance')}
      </button>
    </div>
  </div>
</div>

<style>
  .del-modal { width: min(460px, 92vw); }
  .del-desc {
    font-size: 13px;
    color: var(--fg-2);
    line-height: 1.6;
    margin: 0 0 18px;
  }

  .del-toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    cursor: pointer;
  }

  .del-toggle-text {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .del-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--fg-2);
  }

  .del-toggle-desc {
    font-size: 11.5px;
    color: var(--fg-3);
    line-height: 1.5;
  }

  .del-path {
    font-size: 11px;
    font-family: var(--font-mono);
    color: var(--fg-4);
    overflow-wrap: anywhere;
  }

  .toggle-btn {
    flex-shrink: 0;
    width: 36px;
    height: 20px;
    border-radius: 10px;
    border: none;
    background: var(--bg-4);
    cursor: pointer;
    position: relative;
    transition: background 0.15s;
    padding: 0;
  }
  .toggle-btn.on { background: var(--danger); }

  .toggle-thumb {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--fg-0);
    transition: transform 0.15s;
  }
  .toggle-btn.on .toggle-thumb { transform: translateX(16px); }
</style>
