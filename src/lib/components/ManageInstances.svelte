<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import DeleteInstanceModal from '$lib/components/home/DeleteInstanceModal.svelte';
  import DuplicateInstanceModal from '$lib/components/home/DuplicateInstanceModal.svelte';
  import { t } from '$lib/i18n';
  import { instances, instancesWithBase, isBaseInstance, removeInstance, duplicateInstance, getNextDuplicateTitle } from '$lib/stores/instance';
  import { activeProject, activateInstance } from '$lib/stores/project';
  import { revealInFileManager } from '$lib/services/project-service';
  import type { Instance } from '$lib/types/instance';
  import { matchesSearch } from '$lib/utils/files/files-search';
  import { CLIPBOARD_CLEAR_DELAY } from '$lib/utils/timing';

  export let activeInstanceId: string | null;

  const dispatch = createEventDispatcher<{ close: void; newInstance: void }>();

  let search = '';
  let deletingId: string | null = null;
  let duplicatingId: string | null = null;
  let pendingDuplicateInst: Instance | null = null;
  let pendingDeleteInst: Instance | null = null;
  let moreOpenId: string | null = null;
  let copiedId: string | null = null;
  let moreMenuPos = { top: 0, right: 0 };

  function openMore(inst: Instance, btn: HTMLElement) {
    if (moreOpenId === inst.id) { moreOpenId = null; return; }
    const r = btn.getBoundingClientRect();
    moreMenuPos = { top: r.bottom + 4, right: window.innerWidth - r.right };
    moreOpenId = inst.id;
  }

  $: filtered = $instancesWithBase.filter(i =>
    isBaseInstance(i.id) || matchesSearch(i.ticket.id, search) || matchesSearch(i.ticket.title, search)
  );

  $: grouped = (() => {
    const allById = new Map($instancesWithBase.map(i => [i.id, i]));
    const filteredIds = new Set(filtered.map(i => i.id));

    function isVisibleRoot(inst: Instance): boolean {
      if (!inst.parentInstanceId) return true;
      const parent = allById.get(inst.parentInstanceId);
      return !parent || !filteredIds.has(parent.id);
    }

    const placed = new Set<string>();
    const result: Array<{ inst: Instance; depth: number }> = [];

    function placeSubtree(inst: Instance, depth: number) {
      if (placed.has(inst.id)) return;
      result.push({ inst, depth });
      placed.add(inst.id);
      for (const child of filtered) {
        if (child.parentInstanceId === inst.id) placeSubtree(child, depth + 1);
      }
    }

    for (const inst of filtered) {
      if (!placed.has(inst.id) && isVisibleRoot(inst)) placeSubtree(inst, 0);
    }
    return result;
  })();

  async function handleSetActive(inst: Instance) {
    if (!$activeProject) return;
    await activateInstance($activeProject.id, inst.id);
    dispatch('close');
  }

  async function handleReveal(inst: Instance) {
    moreOpenId = null;
    await revealInFileManager(inst.worktreePath);
  }

  async function handleCopyPath(inst: Instance) {
    moreOpenId = null;
    await navigator.clipboard.writeText(inst.worktreePath);
    copiedId = inst.id;
    setTimeout(() => { copiedId = null; }, CLIPBOARD_CLEAR_DELAY);
  }

  function handleDuplicate(inst: Instance) {
    moreOpenId = null;
    pendingDuplicateInst = inst;
  }

  async function confirmDuplicate(e: CustomEvent<{ title: string; copyWorkingChanges: boolean }>) {
    if (!pendingDuplicateInst) return;
    const inst = pendingDuplicateInst;
    pendingDuplicateInst = null;
    duplicatingId = inst.id;
    try {
      await duplicateInstance(inst, e.detail);
    } finally {
      duplicatingId = null;
    }
  }

  function handleDelete(inst: Instance) {
    moreOpenId = null;
    pendingDeleteInst = inst;
  }

  async function confirmDelete() {
    if (!$activeProject || !pendingDeleteInst) return;
    const inst = pendingDeleteInst;
    pendingDeleteInst = null;
    deletingId = inst.id;
    try {
      await removeInstance(inst.id, $activeProject.id);
    } finally {
      deletingId = null;
    }
  }

  $: moreInst = moreOpenId ? ($instancesWithBase.find(i => i.id === moreOpenId) ?? null) : null;

  const STATUS_DOT: Record<string, string> = {
    running: 'var(--accent)',
    done:    'oklch(0.65 0.14 145)',
    paused:  'oklch(0.68 0.12 60)',
    idle:    'var(--fg-4)',
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
      {#if $instancesWithBase.length === 0}
        <div class="mi-empty">{t('manageInstances.emptyAll')}</div>
      {:else if filtered.length === 0}
        <div class="mi-empty">{(t('manageInstances.emptyFiltered') as (q: string) => string)(search)}</div>
      {:else}
        <ul class="mi-list">
          {#each grouped as { inst, depth }, idx (inst.id)}
            {@const isBase = isBaseInstance(inst.id)}
            {@const isActive = inst.id === activeInstanceId}
            {@const isDeleting = deletingId === inst.id}
            {@const isMoreOpen = moreOpenId === inst.id}
            {#if idx === 1 && isBaseInstance(grouped[0].inst.id)}
              <li class="mi-group-row">{t('workspace.instancesGroup')}</li>
            {/if}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
            <li
              class="mi-row"
              class:active={isActive}
              class:deleting={isDeleting}
              class:clickable={!isActive && !isDeleting}
              class:mi-row-child={depth > 0}
              class:mi-row-base={isBase}
              style="padding-left: {16 + depth * 14}px"
              on:click={() => { if (!isActive && !isDeleting) handleSetActive(inst); }}
              role={!isActive && !isDeleting ? 'button' : undefined}
              tabindex={!isActive && !isDeleting ? 0 : undefined}
            >
              {#if depth > 0}
                <span class="mi-child-indent" style="left: {16 + (depth - 1) * 14}px" aria-hidden="true"></span>
              {/if}

              {#if isBase}
                <span class="mi-icon"><Icon name="folder" size={13}/></span>
              {:else}
                <span class="mi-dot" style="background:{STATUS_DOT[inst.status] ?? STATUS_DOT.idle}"></span>
              {/if}

              <div class="mi-body-inner">
                <span class="mi-title">{inst.ticket.title}</span>
                {#if !isBase && inst.branch}
                  <span class="mi-branch">
                    <Icon name="branch" size={10}/>
                    {inst.branch}
                  </span>
                {/if}
              </div>

              <div class="mi-actions">
                {#if isDeleting || duplicatingId === inst.id}
                  <Spinner size={10}/>
                {:else}
                  <button
                    class="row-btn icon-only"
                    class:open={isMoreOpen}
                    aria-label="More actions"
                    on:click|stopPropagation={(e) => openMore(inst, e.currentTarget)}
                  >
                    <Icon name="more" size={13}/>
                  </button>
                {/if}
              </div>

            </li>
          {/each}
        </ul>
      {/if}
    </div>

    {#if moreInst}
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <div class="more-overlay" on:click={() => moreOpenId = null} role="presentation"></div>
      <div class="more-menu" style="top:{moreMenuPos.top}px; right:{moreMenuPos.right}px;">
        {#if !isBaseInstance(moreInst.id)}
          <button class="more-item" on:click={() => handleDuplicate(moreInst)}>
            <Icon name="copy" size={13}/>
            {t('manageInstances.actions.duplicate')}
          </button>
          <div class="more-sep"></div>
        {/if}
        <button class="more-item" on:click={() => handleReveal(moreInst)}>
          <Icon name="folder" size={13}/>
          {t('manageInstances.actions.reveal')}
        </button>
        <button class="more-item" on:click={() => handleCopyPath(moreInst)}>
          <Icon name={copiedId === moreInst.id ? 'check' : 'copy'} size={13}/>
          {copiedId === moreInst.id ? t('manageInstances.actions.copyPathDone') : t('manageInstances.actions.copyPathLabel')}
        </button>
        {#if !isBaseInstance(moreInst.id)}
          <div class="more-sep"></div>
          <button class="more-item danger" on:click={() => handleDelete(moreInst)}>
            <Icon name="trash" size={13}/>
            {t('common.delete')}
          </button>
        {/if}
      </div>
    {/if}

    <div class="modal-foot">
      <div class="spacer"></div>
      <button class="btn primary" on:click={() => { dispatch('newInstance'); dispatch('close'); }}>
        <Icon name="plus" size={13}/> {t('manageInstances.newInstance')}
      </button>
    </div>

  </div>
</div>

{#if pendingDeleteInst}
  <DeleteInstanceModal
    instance={pendingDeleteInst}
    on:close={() => pendingDeleteInst = null}
    on:confirm={confirmDelete}
  />
{/if}

{#if pendingDuplicateInst}
  <DuplicateInstanceModal
    instance={pendingDuplicateInst}
    defaultTitle={getNextDuplicateTitle(pendingDuplicateInst)}
    on:close={() => pendingDuplicateInst = null}
    on:confirm={confirmDuplicate}
  />
{/if}

<style>
  .mi-modal { width: min(580px, 94vw); }

  .mi-search-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 16px;
    height: 38px;
    border-bottom: 1px solid var(--stroke-0);
    color: var(--fg-3);
    flex-shrink: 0;
    background: var(--bg-0);
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
    background: none;
    border: none;
    color: var(--fg-3);
    cursor: pointer;
    padding: 2px 4px;
    border-radius: var(--r-xs);
  }
  .mi-search-clear:hover { color: var(--fg-0); background: var(--bg-3); }

  .mi-body { padding: 0 !important; }

  .mi-empty {
    padding: 40px 20px;
    font-size: 13px;
    color: var(--fg-3);
    text-align: center;
  }

  .mi-list {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 400px;
    overflow-y: auto;
  }

  .mi-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--stroke-0);
    transition: background 0.1s;
    min-height: 52px;
    position: relative;
  }
  .mi-row:last-child { border-bottom: none; }
  .mi-row:hover { background: var(--bg-2); }
  .mi-row.active { background: var(--accent-weak); }
  .mi-row.clickable { cursor: pointer; }
  .mi-row.deleting { opacity: 0.4; pointer-events: none; }
  .mi-row-child { background: var(--bg-0); }
  .mi-row-child:hover { background: var(--bg-2); }

  .mi-child-indent {
    position: absolute;
    left: 16px;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--stroke-1);
  }

  .mi-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .mi-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--fg-3);
    flex-shrink: 0;
  }
  .mi-row-base.active .mi-icon { color: var(--accent); }

  .mi-row-base { background: var(--bg-0); }
  .mi-row-base:hover { background: var(--bg-2); }
  .mi-row-base.active { background: var(--accent-weak); }

  .mi-group-row {
    padding: 10px 16px 4px;
    font-size: 10px;
    font-family: var(--font-mono);
    color: var(--fg-4);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .mi-body-inner {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .mi-title {
    font-size: 13px;
    font-weight: 500;
    color: var(--fg-0);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .mi-branch {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    font-family: var(--font-mono);
    color: var(--fg-3);
  }

  .mi-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .row-btn {
    padding: 3px 9px;
    font-family: var(--font-ui);
    font-size: 11px;
    color: var(--fg-2);
    background: none;
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-xs);
    cursor: pointer;
    transition: background 0.1s, color 0.1s, border-color 0.1s;
    display: flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
  }
  .row-btn:hover { color: var(--fg-0); background: var(--bg-3); }
  .row-btn.icon-only { padding: 4px 5px; color: var(--fg-3); border-color: transparent; }
  .row-btn.icon-only:hover,
  .row-btn.icon-only.open { color: var(--fg-1); background: var(--bg-3); border-color: var(--stroke-1); }

  /* More dropdown - fixed to escape overflow:hidden scroll containers */
  .more-overlay {
    position: fixed;
    inset: 0;
    z-index: 299;
  }

  .more-menu {
    position: fixed;
    z-index: 300;
    background: var(--bg-2);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-md);
    padding: 4px;
    min-width: 160px;
    box-shadow: 0 6px 20px oklch(0 0 0 / 0.35);
    animation: pop-menu .1s cubic-bezier(.2,1,.4,1);
  }
  @keyframes pop-menu {
    from { opacity: 0; transform: translateY(-4px) scale(.97); }
    to   { opacity: 1; transform: none; }
  }

  .more-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    background: none;
    border: none;
    border-radius: var(--r-sm);
    font-size: 12px;
    color: var(--fg-1);
    cursor: pointer;
    text-align: left;
    transition: background 0.1s, color 0.1s;
  }
  .more-item:hover { background: var(--bg-4); color: var(--fg-0); }
  .more-item.danger { color: var(--fg-2); }
  .more-item.danger:hover { background: oklch(0.22 0.04 15); color: oklch(0.75 0.16 15); }

  .more-sep {
    height: 1px;
    background: var(--stroke-0);
    margin: 4px 0;
  }
</style>
