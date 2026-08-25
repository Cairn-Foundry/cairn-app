<script lang="ts">
  /**
   * Merge and rebase panel: pick a target branch, run the operation, and work
   * through the resulting conflicts (continue / skip / abort).
   * Dispatches `openFile` with a conflicted path and `filesChanged` after any git write.
   */
  import { createEventDispatcher, onMount } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import { t } from '$lib/i18n';
  import {
    git,
    loadBranches,
    stageFile,
    removeFile,
    rebaseOnto,
    mergeBranch,
    continueRebase,
    skipRebase,
    abortRebase,
    continueMerge,
    abortMerge,
  } from '$lib/stores/git';
  import type { GitOpResult } from '$lib/services/git-service';
  import { readFile } from '$lib/services/file-service';
  import { activeProject } from '$lib/stores/project';
  import { activeInstance, setInstanceBaseBranch } from '$lib/stores/instance';
  import { hasConflictMarkers } from '$lib/utils/git/conflict-markers';

  const dispatch = createEventDispatcher<{ openFile: string; filesChanged: void }>();

  $: state = $git;
  $: op = state.operationState;
  $: inOperation = (op?.kind ?? 'none') !== 'none';
  $: currentBranch = state.currentBranch;
  $: localTargets = state.branches.filter((b) => b !== currentBranch);
  $: remoteTargets = state.remoteBranches;
  $: hasTargets = localTargets.length + remoteTargets.length > 0;

  let conflictQuery = '';
  let warnPath: string | null = null;
  $: cq = conflictQuery.trim().toLowerCase();
  $: structural = new Set(op?.structuralFiles ?? []);
  $: conflictFiles = (op?.conflictedFiles ?? []).filter(
    (f) => !cq || f.toLowerCase().includes(cq),
  );
  $: contentFiles = conflictFiles.filter((f) => !structural.has(f));
  $: structuralFiles = conflictFiles.filter((f) => structural.has(f));

  /** Stages a conflicted file, warning first if it still contains conflict markers. */
  async function markResolved(file: string) {
    const wt = $activeInstance?.worktreePath;
    if (!wt) return;
    const raw = (await readFile(`${wt}/${file}`).catch(() => '')) ?? '';
    if (hasConflictMarkers(raw)) {
      warnPath = file;
      return;
    }
    await guarded(() => stageFile(file));
  }

  function confirmMarkResolved() {
    const file = warnPath;
    warnPath = null;
    if (file) guarded(() => stageFile(file));
  }

  let strategy: 'rebase' | 'merge' | null = null;
  let setAsBase = true;
  let target: string | null = null;
  let branchQuery = '';
  let running = false;

  $: q = branchQuery.trim().toLowerCase();
  $: filteredLocal = q
    ? localTargets.filter((b) => b.toLowerCase().includes(q))
    : localTargets;
  $: filteredRemote = q
    ? remoteTargets.filter((b) => b.toLowerCase().includes(q))
    : remoteTargets;
  $: hasFiltered = filteredLocal.length + filteredRemote.length > 0;
  $: canRun = !!strategy && !!target && !running;

  onMount(() => {
    if (!hasTargets && $activeProject?.path) loadBranches($activeProject.path);
  });

  /** Clears the branch selection once an operation succeeded. */
  function afterOp(result: GitOpResult | null) {
    if (result && result.ok) {
      strategy = null;
      target = null;
      branchQuery = '';
    }
  }

  /**
   * Runs the selected strategy against the selected target branch. A rebase moves
   * where the instance's work starts, so the recorded base branch follows it -
   * otherwise the diffs, the divergence counts and the merge request target would
   * keep pointing at the branch it no longer sits on.
   */
  async function run() {
    if (!strategy || !target || running) return;
    running = true;
    const onto = target;
    try {
      const result =
        strategy === 'rebase'
          ? await rebaseOnto(onto)
          : await mergeBranch(onto);
      if (result?.ok && strategy === 'rebase' && setAsBase && $activeInstance) {
        await setInstanceBaseBranch($activeInstance.id, $activeInstance.projectId, onto)
          .catch(() => {});
      }
      afterOp(result);
      dispatch('filesChanged');
    } finally {
      running = false;
    }
  }

  /** Serializes a git action behind the `running` flag and notifies the parent afterwards. */
  async function guarded(fn: () => Promise<unknown>) {
    if (running) return;
    running = true;
    try {
      await fn();
      dispatch('filesChanged');
    } finally {
      running = false;
    }
  }
</script>

<div class="mr-root">
  {#if inOperation && op}
    <div class="mr-inprogress">
      <div class="mr-op-head">
        <span class="mr-op-title">
          {op.kind === 'merge'
            ? t('git.mergeInProgress')
            : t('git.rebaseInProgress')}
        </span>
        {#if op.head}
          <span class="mr-op-branch selectable">{op.head}</span>
        {/if}
        {#if op.kind === 'rebase' && op.total > 0}
          <span class="mr-op-step">
            {(t('git.rebaseStep') as (n: number, total: number) => string)(
              op.current,
              op.total,
            )}
          </span>
        {/if}
      </div>

      <p class="mr-hint">
        {op.kind === 'merge'
          ? t('git.mergeConflictHint')
          : t('git.rebaseConflictHint')}
      </p>

      {#if op.conflictedFiles.length === 0}
        <div class="mr-resolved">
          <Icon name="check" size={14} />
          <span>{t('git.allResolved')}</span>
        </div>
      {:else}
        <div class="mr-search">
          <Icon name="search" size={12} />
          <input
            class="selectable"
            type="text"
            bind:value={conflictQuery}
            placeholder={t('git.searchConflicts') as string}
          />
        </div>
        <div class="mr-conflicts">
          {#if conflictFiles.length === 0}
            <div class="mr-empty">{t('git.changesNoResults')}</div>
          {:else}
            {#if contentFiles.length > 0}
              <div class="mr-group">{t('git.contentConflicts')}</div>
              {#each contentFiles as file (file)}
                <div class="mr-conflict-row">
                  <Icon name="alert" size={13} />
                  <span class="mr-conflict-name selectable">{file}</span>
                  <button class="mr-link" on:click={() => dispatch('openFile', file)}>
                    {t('git.openConflict')}
                  </button>
                  <button
                    class="mr-link"
                    disabled={running}
                    on:click={() => markResolved(file)}
                  >
                    {t('git.markResolved')}
                  </button>
                </div>
              {/each}
            {/if}
            {#if structuralFiles.length > 0}
              <div class="mr-group">{t('git.structuralConflicts')}</div>
              {#each structuralFiles as file (file)}
                <div class="mr-conflict-row">
                  <Icon name="alert" size={13} />
                  <span class="mr-conflict-name selectable">{file}</span>
                  <button
                    class="mr-link"
                    disabled={running}
                    on:click={() => guarded(() => stageFile(file))}
                  >
                    {t('git.keepFile')}
                  </button>
                  <button
                    class="mr-link danger"
                    disabled={running}
                    on:click={() => guarded(() => removeFile(file))}
                  >
                    {t('git.removeFile')}
                  </button>
                </div>
              {/each}
            {/if}
          {/if}
        </div>
      {/if}

      <div class="mr-actions">
        <button
          class="btn primary"
          disabled={running || op.conflictedFiles.length > 0}
          on:click={() =>
            guarded(op.kind === 'merge' ? continueMerge : continueRebase)}
        >
          {#if running}
            <Spinner size={12} trackColor="oklch(1 0 0 / 0.3)" color="var(--accent-fg)" />
          {/if}
          {t('git.continueRebase')}
        </button>
        {#if op.kind === 'rebase'}
          <button class="btn" disabled={running} on:click={() => guarded(skipRebase)}>
            {t('git.skipCommit')}
          </button>
        {/if}
        <button
          class="btn danger"
          disabled={running}
          on:click={() =>
            guarded(op.kind === 'merge' ? abortMerge : abortRebase)}
        >
          {t('git.abort')}
        </button>
      </div>
    </div>
  {:else}
    <div class="mr-section">
      <div class="mr-section-title">{t('git.strategy')}</div>
      <div class="mr-cards">
        <button
          class="mr-card"
          class:selected={strategy === 'rebase'}
          on:click={() => (strategy = 'rebase')}
        >
          <div class="mr-card-head">
            <Icon name="git" size={15} />
            <span>{t('git.strategyRebase')}</span>
          </div>
          <p class="mr-card-desc">{t('git.strategyRebaseDesc')}</p>
        </button>
        <button
          class="mr-card"
          class:selected={strategy === 'merge'}
          on:click={() => (strategy = 'merge')}
        >
          <div class="mr-card-head">
            <Icon name="branch" size={15} />
            <span>{t('git.strategyMerge')}</span>
          </div>
          <p class="mr-card-desc">{t('git.strategyMergeDesc')}</p>
        </button>
      </div>
    </div>

    <div class="mr-section mr-section-grow">
      <div class="mr-section-title">{t('git.targetBranch')}</div>
      {#if !hasTargets}
        <div class="mr-empty">{t('git.noOtherBranches')}</div>
      {:else}
        <div class="mr-search">
          <Icon name="search" size={12} />
          <input
            class="selectable"
            type="text"
            bind:value={branchQuery}
            placeholder={t('git.filterBranches') as string}
          />
        </div>
        <div class="mr-branch-list">
          {#if !hasFiltered}
            <div class="mr-empty">
              {(t('git.noBranchesMatch') as (q: string) => string)(branchQuery)}
            </div>
          {:else}
            {#if filteredLocal.length > 0}
              <div class="mr-group">{t('git.localBranches')}</div>
              {#each filteredLocal as b (b)}
                <button
                  class="mr-branch"
                  class:selected={target === b}
                  on:click={() => (target = b)}
                >
                  <Icon name="branch" size={12} />
                  <span class="mr-branch-name">{b}</span>
                </button>
              {/each}
            {/if}
            {#if filteredRemote.length > 0}
              <div class="mr-group">{t('git.remoteBranches')}</div>
              {#each filteredRemote as b (b)}
                <button
                  class="mr-branch"
                  class:selected={target === b}
                  on:click={() => (target = b)}
                >
                  <Icon name="git" size={12} />
                  <span class="mr-branch-name">{b}</span>
                </button>
              {/each}
            {/if}
          {/if}
        </div>
      {/if}
    </div>

    <div class="mr-footer">
      <span class="mr-summary">
        {#if strategy && target}
          {strategy === 'rebase'
            ? (t('git.summaryRebase') as (h: string, t: string) => string)(
                currentBranch,
                target,
              )
            : (t('git.summaryMerge') as (t: string, h: string) => string)(
                target,
                currentBranch,
              )}
        {:else}
          {t('git.pickStrategyAndBranch')}
        {/if}
      </span>
      {#if strategy === 'rebase' && $activeInstance && target && target !== $activeInstance.baseBranch}
        <label class="mr-set-base">
          <input type="checkbox" bind:checked={setAsBase} />
          <span>{t('git.setAsBaseBranch')}</span>
        </label>
      {/if}
      <button class="btn primary" disabled={!canRun} on:click={run}>
        {#if running}
          <Spinner size={12} trackColor="oklch(1 0 0 / 0.3)" color="var(--accent-fg)" />
        {/if}
        {strategy === 'merge' ? t('git.startMerge') : t('git.startRebase')}
      </button>
    </div>
  {/if}
</div>

{#if warnPath}
  <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
  <div
    class="mr-modal-backdrop"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    on:click={() => (warnPath = null)}
    on:keydown={(e) => e.key === 'Escape' && (warnPath = null)}
  >
    <div class="mr-modal" on:click|stopPropagation role="presentation">
      <div class="mr-modal-head">
        <Icon name="alert" size={16} />
        <h3>{t('git.stillConflictedTitle')}</h3>
      </div>
      <p class="mr-modal-body">
        {(t('git.stillConflictedBody') as (f: string) => string)(warnPath)}
      </p>
      <div class="mr-modal-foot">
        <button class="btn" on:click={() => (warnPath = null)}>
          {t('common.cancel')}
        </button>
        <button class="btn danger" on:click={confirmMarkResolved}>
          {t('git.markResolvedAnyway')}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .mr-set-base {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
    padding: 4px 9px;
    background: var(--bg-2);
    border: 1px solid var(--stroke-0);
    border-radius: 999px;
    color: var(--fg-2);
    font-size: 11.5px;
    cursor: pointer;
  }
  .mr-set-base:hover { background: var(--bg-3); color: var(--fg-1); }
  .mr-set-base input { width: 12px; height: 12px; margin: 0; flex: none; }

  .mr-root {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }

  .mr-section {
    padding: 12px;
    border-bottom: 1px solid var(--stroke-0);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .mr-section-grow {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  .mr-section-title {
    color: var(--fg-3);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .mr-cards {
    display: flex;
    gap: 8px;
  }
  .mr-card {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px;
    text-align: left;
    border: 1px solid var(--stroke-0);
    border-radius: 8px;
    background: var(--bg-2);
    color: var(--fg-1);
    cursor: pointer;
    transition:
      border-color 0.12s ease,
      background 0.12s ease;
  }
  .mr-card:hover {
    border-color: var(--fg-3);
  }
  .mr-card.selected {
    border-color: var(--accent);
    background: var(--accent-weak);
  }
  .mr-card-head {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 13px;
    font-weight: 600;
  }
  .mr-card-desc {
    margin: 0;
    color: var(--fg-2);
    font-size: 11px;
    line-height: 1.4;
  }

  .mr-search {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    border: 1px solid var(--stroke-0);
    border-radius: 6px;
    background: var(--bg-1);
    color: var(--fg-3);
  }
  .mr-search:focus-within {
    border-color: var(--accent);
  }
  .mr-search input {
    flex: 1;
    min-width: 0;
    border: none;
    background: transparent;
    color: var(--fg-1);
    font-size: 12px;
    outline: none;
  }

  .mr-branch-list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .mr-group {
    padding: 6px 4px 2px;
    color: var(--fg-3);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .mr-branch {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 6px 8px;
    border: 1px solid transparent;
    border-radius: 5px;
    background: transparent;
    color: var(--fg-1);
    font-size: 12px;
    text-align: left;
    cursor: pointer;
    transition: background 0.1s ease;
  }
  .mr-branch:hover {
    background: var(--bg-3);
  }
  .mr-branch.selected {
    border-color: var(--accent);
    background: var(--accent-weak);
  }
  .mr-branch-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mr-empty {
    padding: 12px;
    color: var(--fg-3);
    font-size: 12px;
    text-align: center;
  }

  .mr-footer {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px;
    border-top: 1px solid var(--stroke-0);
    margin-top: auto;
  }
  .mr-summary {
    flex: 1;
    min-width: 0;
    color: var(--fg-2);
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mr-inprogress {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    height: 100%;
    min-height: 0;
  }
  .mr-op-head {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .mr-op-title {
    font-size: 13px;
    font-weight: 600;
  }
  .mr-op-branch {
    font-size: 12px;
    color: var(--fg-2);
  }
  .mr-op-step {
    padding: 1px 7px;
    border-radius: 999px;
    background: var(--bg-3);
    color: var(--fg-2);
    font-size: 11px;
  }
  .mr-hint {
    margin: 0;
    color: var(--fg-3);
    font-size: 11px;
  }

  .mr-conflicts {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .mr-conflict-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 6px;
    background: color-mix(in oklch, var(--danger) 10%, var(--bg-1));
    color: var(--fg-1);
    font-size: 12px;
  }
  .mr-conflict-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mr-resolved {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 10px;
    color: var(--fg-2);
    font-size: 12px;
  }
  .mr-link {
    border: none;
    background: transparent;
    color: var(--accent);
    font-size: 12px;
    cursor: pointer;
    padding: 2px 4px;
  }
  .mr-link.danger {
    color: var(--danger);
  }
  .mr-link:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .mr-actions {
    display: flex;
    gap: 8px;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border: 1px solid var(--stroke-0);
    border-radius: 6px;
    background: var(--bg-2);
    color: var(--fg-1);
    font-size: 12px;
    cursor: pointer;
    transition:
      background 0.12s ease,
      border-color 0.12s ease;
  }
  .btn:hover:not(:disabled) {
    background: var(--bg-3);
    border-color: var(--fg-3);
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-fg);
  }
  .btn.primary:hover:not(:disabled) {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
  }
  .btn.danger {
    color: var(--danger);
  }
  .btn.danger:hover:not(:disabled) {
    border-color: var(--danger);
    background: color-mix(in oklch, var(--danger) 12%, var(--bg-2));
  }

  .mr-modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    background: oklch(0 0 0 / 0.4);
  }
  .mr-modal {
    width: min(420px, 90vw);
    padding: 16px;
    border: 1px solid var(--stroke-0);
    border-radius: 10px;
    background: var(--bg-1);
    box-shadow: 0 12px 40px oklch(0 0 0 / 0.35);
  }
  .mr-modal-head {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--danger);
  }
  .mr-modal-head h3 {
    margin: 0;
    font-size: 14px;
    color: var(--fg-0);
  }
  .mr-modal-body {
    margin: 10px 0 16px;
    color: var(--fg-2);
    font-size: 12px;
    line-height: 1.5;
  }
  .mr-modal-foot {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
</style>
