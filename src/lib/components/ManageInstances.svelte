<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import { t } from '$lib/i18n';
  import { instances, removeInstance } from '$lib/stores/instance';
  import { activeProject, activateInstance } from '$lib/stores/project';
  import { revealInFileManager } from '$lib/services/project-service';
  import type { Instance } from '$lib/types/instance';
  import { matchesSearch } from '$lib/utils/files/files-search';
  import { CLIPBOARD_CLEAR_DELAY } from '$lib/utils/timing';
  import { formatDate } from '$lib/utils/format';

  export let activeInstanceId: string | null;

  const dispatch = createEventDispatcher<{ close: void; newInstance: void }>();

  let search = '';
  let deletingId: string | null = null;
  let confirmDeleteId: string | null = null;
  let copiedId: string | null = null;

  $: filtered = $instances.filter(i =>
    matchesSearch(i.ticket.id, search) || matchesSearch(i.ticket.title, search)
  );

  async function handleSetActive(inst: Instance) {
    if (!$activeProject) return;
    await activateInstance($activeProject.id, inst.id);
    dispatch('close');
  }

  async function handleReveal(inst: Instance) {
    await revealInFileManager(inst.worktreePath);
  }

  async function handleCopyPath(inst: Instance) {
    await navigator.clipboard.writeText(inst.worktreePath);
    copiedId = inst.id;
    setTimeout(() => { copiedId = null; }, CLIPBOARD_CLEAR_DELAY);
  }

  async function handleDelete(inst: Instance) {
    if (!$activeProject) return;
    if (confirmDeleteId !== inst.id) {
      confirmDeleteId = inst.id;
      return;
    }
    deletingId = inst.id;
    confirmDeleteId = null;
    try {
      await removeInstance(inst.id, $activeProject.id);
    } finally {
      deletingId = null;
    }
  }

  function cancelDelete() {
    confirmDeleteId = null;
  }

  const STATUS_LABEL: Record<string, string> = {
    idle: t('manageInstances.statusLabels.idle') as string,
    running: t('manageInstances.statusLabels.running') as string,
    paused: t('manageInstances.statusLabels.paused') as string,
    done: t('manageInstances.statusLabels.done') as string,
  };

</script>

<div class="modal-backdrop" on:click={() => dispatch('close')} role="button" tabindex="-1" on:keydown={(e) => e.key === 'Escape' && dispatch('close')}>
  <div class="modal mi-modal" on:click|stopPropagation role="presentation">

    <div class="modal-head">
      <div>
        <div class="step-count">{t('manageInstances.heading')}</div>
        <h3>{t('manageInstances.subheading')}</h3>
      </div>
      <button class="icon-btn close" on:click={() => dispatch('close')} aria-label={t('common.close') as string}>
        <Icon name="x" size={16}/>
      </button>
    </div>

    <div class="mi-search-bar">
      <Icon name="search" size={13}/>
      <input
        class="mi-search-input"
        type="text"
        bind:value={search}
        placeholder={t('manageInstances.searchPlaceholder') as string}
        autocomplete="off"
      />
      {#if search}
        <button class="mi-search-clear" on:click={() => search = ''} aria-label={t('common.clearSearch') as string}>
          <Icon name="x" size={11}/>
        </button>
      {/if}
    </div>

    <div class="modal-body mi-body">
      {#if $instances.length === 0}
        <div class="mi-empty">{t('manageInstances.emptyAll')}</div>
      {:else if filtered.length === 0}
        <div class="mi-empty">{(t('manageInstances.emptyFiltered') as (q: string) => string)(search)}</div>
      {:else}
        <ul class="mi-list">
          {#each filtered as inst (inst.id)}
            {@const isActive = inst.id === activeInstanceId}
            {@const isDeleting = deletingId === inst.id}
            {@const isConfirming = confirmDeleteId === inst.id}
            <li class="mi-row {isActive ? 'current' : ''} {isDeleting ? 'deleting' : ''}">
              <div class="mi-row-main">
                <div class="mi-row-top">
                  <span class="mi-status-dot status-{inst.status}"></span>
                  <span class="mi-ticket-id">{inst.ticket.id}</span>
                  <span class="mi-ticket-title">{inst.ticket.title}</span>
                  <div class="mi-badges">
                    <span class="mi-badge mode">{inst.useGit ? 'git' : 'local'}</span>
                    <span class="mi-badge status-badge">{STATUS_LABEL[inst.status] ?? inst.status}</span>
                    {#if isActive}<span class="mi-badge active-badge">{t('manageInstances.activeBadge')}</span>{/if}
                  </div>
                </div>
                {#if inst.branch}
                  <div class="mi-row-branch">
                    <Icon name="branch" size={11}/>
                    <span class="mi-branch">{inst.branch}</span>
                    {#if inst.baseBranch}
                      <span class="mi-base-branch">{t('manageInstances.fromBranch')} <code>{inst.baseBranch}</code></span>
                    {/if}
                  </div>
                {/if}
              </div>

              <span class="mi-date"><Icon name="clock" size={11}/> {formatDate(inst.createdAt)}</span>

              {#if isConfirming}
                <div class="mi-confirm">
                  <span class="mi-confirm-label">{t('manageInstances.deleteConfirm')}</span>
                  <button class="mi-action danger" on:click={() => handleDelete(inst)} disabled={isDeleting}>
                    {#if isDeleting}<Spinner size={11} />{:else}{t('common.confirm')}{/if}
                  </button>
                  <button class="mi-action ghost" on:click={cancelDelete}>{t('common.cancel')}</button>
                </div>
              {:else}
                <div class="mi-actions">
                  {#if !isActive}
                    <button class="mi-action primary" on:click={() => handleSetActive(inst)}>
                      <Icon name="chev-r" size={13}/> {t('manageInstances.actions.select')}
                    </button>
                  {/if}
                  <button class="mi-action" title={t('manageInstances.actions.revealInFinder') as string} on:click={() => handleReveal(inst)}>
                    <Icon name="folder" size={13}/> {t('manageInstances.actions.reveal')}
                  </button>
                  <button class="mi-action" title={t('manageInstances.actions.copyPath') as string} on:click={() => handleCopyPath(inst)}>
                    <Icon name={copiedId === inst.id ? 'check' : 'copy'} size={13}/>
                    {copiedId === inst.id ? t('manageInstances.actions.copyPathDone') : t('manageInstances.actions.copyPathLabel')}
                  </button>
                  <button class="mi-action danger" title={t('common.delete') as string} on:click={() => handleDelete(inst)}>
                    <Icon name="x" size={13}/> {t('common.delete')}
                  </button>
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>


    <div class="modal-foot">
      <button class="btn primary" on:click={() => { dispatch('newInstance'); dispatch('close'); }}>
        <Icon name="plus" size={13}/> {t('manageInstances.newInstance')}
      </button>
      <div class="spacer"></div>
      <button class="btn ghost" on:click={() => dispatch('close')}>{t('common.close')}</button>
    </div>

  </div>
</div>

<style>
  .mi-modal { width: min(640px, 94vw); }

  /* Search bar */
  .mi-search-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 16px;
    height: 40px;
    border-bottom: 1px solid var(--stroke-0);
    background: var(--bg-1);
    color: var(--fg-3);
    flex-shrink: 0;
  }

  .mi-search-input {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    font-size: 13px;
    color: var(--fg-0);
    font-family: var(--font-ui);
  }
  .mi-search-input::placeholder { color: var(--fg-4); }

  .mi-search-clear {
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--fg-3);
    cursor: pointer;
    padding: 2px;
    border-radius: 3px;
  }
  .mi-search-clear:hover { color: var(--fg-0); background: var(--bg-3); }

  .mi-body { padding: 0 !important; }

  .mi-empty {
    padding: 32px 24px;
    font-size: 13px;
    color: var(--fg-3);
    text-align: center;
  }

  .mi-list {
    list-style: none;
    margin: 0;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 440px;
    overflow-y: auto;
  }

  .mi-row {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 14px;
    border-radius: var(--r-md);
    border: 1px solid var(--stroke-0);
    background: var(--bg-0);
    transition: border-color 0.15s;
  }
  .mi-row.current { border-color: var(--accent); background: var(--accent-weak); }
  .mi-row.deleting { opacity: 0.5; pointer-events: none; }

  .mi-row-top {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .mi-status-dot {
    width: 7px; height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
    background: var(--fg-4);
  }
  .mi-status-dot.status-running { background: var(--accent); box-shadow: 0 0 0 3px var(--accent-weak); }
  .mi-status-dot.status-done    { background: oklch(0.7 0.15 145); }
  .mi-status-dot.status-paused  { background: oklch(0.7 0.12 60); }

  .mi-ticket-id {
    font-size: 11px;
    font-family: var(--font-mono);
    color: var(--fg-3);
    flex-shrink: 0;
  }

  .mi-ticket-title {
    font-size: 13px;
    font-weight: 500;
    color: var(--fg-0);
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .mi-badges { display: flex; gap: 4px; flex-shrink: 0; }

  .mi-date {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    color: var(--fg-4);
  }

  .mi-badge {
    font-size: 10px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 999px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    background: var(--bg-3);
    color: var(--fg-3);
  }
  .mi-badge.active-badge { background: var(--accent-weak); color: var(--accent); }

  .mi-row-branch {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--fg-3);
  }

  .mi-branch {
    font-size: 11px;
    font-family: var(--font-mono);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .mi-base-branch {
    font-size: 11px;
    color: var(--fg-4);
  }
  .mi-base-branch code {
    font-family: var(--font-mono);
    color: var(--fg-3);
  }

  /* Actions row */
  .mi-actions, .mi-confirm {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
  }

  .mi-confirm { gap: 8px; }
  .mi-confirm-label { font-size: 12px; color: var(--fg-2); margin-right: 4px; }

  .mi-action {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
    border-radius: var(--r-sm);
    border: 1px solid var(--stroke-0);
    background: var(--bg-2);
    color: var(--fg-2);
    font-size: 12px;
    cursor: pointer;
    transition: background 0.1s, color 0.1s, border-color 0.1s;
  }
  .mi-action:hover { background: var(--bg-4); color: var(--fg-0); }
  .mi-action.ghost { background: none; border-color: transparent; }
  .mi-action.ghost:hover { background: var(--bg-3); }
  .mi-action.primary { border-color: var(--accent); color: var(--accent); background: var(--accent-weak); }
  .mi-action.primary:hover { background: var(--accent); color: #fff; }
  .mi-action.danger { color: oklch(0.75 0.18 15); border-color: transparent; }
  .mi-action.danger:hover { background: oklch(0.28 0.06 15); border-color: oklch(0.62 0.18 15); }

</style>
