<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * Shown when a branch cannot be checked out because another worktree already
   * holds it. When that worktree belongs to a known instance, the way out is to
   * open it rather than to free the branch.
   */
  import { createEventDispatcher } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n';
  import type { Instance } from '$lib/types/instance';

  export let branch: string;
  export let worktreePath: string;
  export let instance: Instance | null;

  const dispatch = createEventDispatcher<{ close: void; open: Instance }>();
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
  <div class="modal branch-in-use-modal" on:click|stopPropagation role="presentation">
    <div class="modal-head">
      <div>
        <div class="step-count">{t('git.branchInUse.heading')}</div>
        <h3>{(t('git.branchInUse.title') as (branch: string) => string)(branch)}</h3>
      </div>
      <button class="icon-btn close" on:click={() => dispatch('close')} aria-label={t('common.close') as string}>
        <Icon name="x" size={16}/>
      </button>
    </div>
    <div class="modal-body">
      {#if instance}
        <p class="biu-desc">{t('git.branchInUse.descriptionInstance')}</p>
        <div class="biu-instance">
          <div class="biu-instance-key">
            <Icon name="ticket" size={13}/>
            <span class="mono">{instance.ticket.id}</span>
          </div>
          <span class="biu-instance-title">{instance.ticket.title}</span>
        </div>
      {:else}
        <p class="biu-desc">{t('git.branchInUse.descriptionUnknown')}</p>
        <code class="biu-path">{worktreePath}</code>
      {/if}
    </div>
    <div class="modal-foot">
      <div class="spacer"></div>
      <button class="btn ghost" on:click={() => dispatch('close')}>{t('common.cancel')}</button>
      {#if instance}
        <button class="btn primary" on:click={() => instance && dispatch('open', instance)}>
          <Icon name="chev-r" size={14}/> {t('git.branchInUse.openInstance')}
        </button>
      {/if}
    </div>
  </div>
</div>

<style>
  .branch-in-use-modal { width: min(460px, 92vw); }

  .biu-desc {
    font-size: 13px;
    color: var(--fg-2);
    line-height: 1.6;
    margin: 0 0 12px;
  }

  .biu-instance {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 9px 11px;
    background: var(--bg-0);
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-sm);
    font-size: 12.5px;
    color: var(--fg-1);
  }

  /* The key never wraps mid-word; the title takes the second line in full. */
  .biu-instance-key {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
  }
  .biu-instance-key .mono { overflow-wrap: anywhere; }
  .biu-instance-key :global(svg) { flex-shrink: 0; }

  .biu-instance-title {
    color: var(--fg-2);
    line-height: 1.45;
  }

  .biu-path {
    display: block;
    padding: 9px 11px;
    background: var(--bg-0);
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-sm);
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--fg-2);
    overflow-wrap: anywhere;
  }
</style>
