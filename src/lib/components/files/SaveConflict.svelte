<script lang="ts">
  // Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  // SPDX-License-Identifier: AGPL-3.0-or-later

  import { createEventDispatcher } from 'svelte';
  import { t } from '$lib/i18n';
  import Icon from '$lib/components/Icon.svelte';

  /** Path shown to the user, relative to the worktree. */
  export let path: string;
  /** True when the file is gone from disk rather than merely changed. */
  export let deleted = false;

  const dispatch = createEventDispatcher<{
    overwrite: void;
    cancel: void;
    openDisk: void;
  }>();
</script>

<div
  class="modal-backdrop"
  role="dialog"
  aria-modal="true"
  tabindex="-1"
  on:click={() => dispatch('cancel')}
  on:keydown={(e) => e.key === 'Escape' && dispatch('cancel')}
>
  <div class="modal conflict-modal" on:click|stopPropagation role="presentation">
    <div class="modal-head">
      <div>
        <div class="step-count">{t('saveConflict.heading')}</div>
        <h3 class="selectable">{path}</h3>
      </div>
    </div>

    <div class="modal-body">
      <p class="lead">
        {deleted ? t('saveConflict.deletedLead') : t('saveConflict.changedLead')}
      </p>

      <div class="choices">
        <button class="choice" on:click={() => dispatch('openDisk')}>
          <Icon name="columns" size={15} />
          <span>
            <strong>{t('saveConflict.openDisk')}</strong>
            <small>{t('saveConflict.openDiskHint')}</small>
          </span>
        </button>

        <button class="choice" on:click={() => dispatch('cancel')}>
          <Icon name="x" size={15} />
          <span>
            <strong>{t('saveConflict.cancel')}</strong>
            <small>{t('saveConflict.cancelHint')}</small>
          </span>
        </button>

        <button class="choice danger" on:click={() => dispatch('overwrite')}>
          <Icon name="alert" size={15} />
          <span>
            <strong>{t('saveConflict.overwrite')}</strong>
            <small>
              {deleted ? t('saveConflict.overwriteDeletedHint') : t('saveConflict.overwriteHint')}
            </small>
          </span>
        </button>
      </div>
    </div>
  </div>
</div>

<style>
  .conflict-modal { width: min(520px, 92vw); }
  .lead { margin: 0 0 16px; color: var(--fg-1); line-height: 1.5; }

  .choices { display: flex; flex-direction: column; gap: 8px; }

  .choice {
    display: flex;
    align-items: flex-start;
    gap: 11px;
    padding: 12px 14px;
    text-align: left;
    background: var(--bg-1);
    border: 1px solid var(--stroke-0);
    border-radius: 8px;
    color: var(--fg-0);
    cursor: pointer;
  }
  .choice:hover { background: var(--bg-2); border-color: var(--stroke-1); }
  .choice :global(svg) { margin-top: 1px; flex: none; color: var(--fg-2); }
  .choice span { display: flex; flex-direction: column; gap: 3px; }
  .choice strong { font-weight: 600; }
  .choice small { color: var(--fg-2); line-height: 1.4; }

  .choice.danger:hover { border-color: var(--danger); }
  .choice.danger:hover :global(svg) { color: var(--danger); }
</style>
