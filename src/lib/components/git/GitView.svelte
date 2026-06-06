<script lang="ts">
  import { onMount, createEventDispatcher, tick } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import InlineDiff from '$lib/components/review/InlineDiff.svelte';
  import GraphView from '$lib/components/git/GraphView.svelte';
  import StashView from '$lib/components/git/StashView.svelte';
  import { langFromPath, readFile, isBinaryPath } from '$lib/services/file-service';
  import { getDiffCommit } from '$lib/services/git-service';
  import type { GitFileDiff, GitDiffHunk } from '$lib/services/git-service';
  import type { EditorLanguage } from '$lib/utils/editor/editor-theme';
  import { t } from '$lib/i18n';
  import {
    git,
    refreshStatus,
    refreshLog,
    refreshGraph,
    refreshStashes,
    getStashDiff,
    stageFile,
    unstageFile,
    commitChanges,
    amendLastCommit,
    pushBranch,
    setCommitMessage,
    revertCommit,
    discardFile,
  } from '$lib/stores/git';
  import type { GitStash } from '$lib/services/git-service';
  import { activeInstance, instances } from '$lib/stores/instance';
  import { activateInstance } from '$lib/stores/project';
  import { settings } from '$lib/stores/settings';
  import { activeStep, pendingGitAction, gitLeftTab } from '$lib/stores/ui';
  import { currentProjectViewState, updateProjectViewState } from '$lib/stores/view-state';
  import { getCommitState, saveCommitState } from '$lib/services/commit-state-service';

  const dispatch = createEventDispatcher<{ openFile: string; goGitSettings: void; fileDiscarded: string }>();

  function goToGitSettings() {
    pendingGitAction.set('createProfile');
    dispatch('goGitSettings');
  }

  function goToGitSettingsManage() {
    dispatch('goGitSettings');
  }

  $: state = $git;
  $: instance = $activeInstance;
  $: projectInstances = instance ? $instances.filter(i => i.projectId === instance.projectId) : [];

  type FileCard = {
    file: string;
    basename: string;
    dirpath: string;
    oldContent: string;
    newContent: string;
    hasDiff: boolean;
    filePath: string;
    status: string;
    added: number;
    removed: number;
  };

  const STATUS_CLASS: Record<string, string> = {
    modified:          'status-modified',
    untracked:         'status-added',
    deleted:           'status-deleted',
    'staged-modified': 'status-modified',
    'staged-added':    'status-added',
    'staged-deleted':  'status-deleted',
    'staged-renamed':  'status-modified',
    'staged-copied':   'status-added',
  };

  function basename(p: string) { return p.split('/').pop() ?? p; }
  function dirpath(p: string) {
    const parts = p.split('/');
    return parts.length > 1 ? parts.slice(0, -1).join('/') + '/' : '';
  }

  function buildFileCards(
    statusEntries: [string, string][],
    diffs: typeof state.unstagedDiffs,
    untracked: Record<string, string> = {},
  ): FileCard[] {
    const byPath = new Map(diffs.map(f => [f.filePath, f]));
    const sorted = [...statusEntries].sort(([a], [b]) => basename(a).localeCompare(basename(b)));
    return sorted.map(([filePath, status]) => {
      const lines = (byPath.get(filePath)?.hunks ?? []).flatMap(h => h.lines);
      let oldContent = lines.filter(l => l.kind !== 'add').map(l => l.content).join('\n');
      let newContent = lines.filter(l => l.kind !== 'remove').map(l => l.content).join('\n');
      let hasDiff = lines.length > 0;
      let added = lines.filter(l => l.kind === 'add').length;
      let removed = lines.filter(l => l.kind === 'remove').length;
      // Untracked files have no diff hunks — show their content as all-added.
      if (!hasDiff && status === 'untracked' && filePath in untracked) {
        oldContent = '';
        newContent = untracked[filePath];
        hasDiff = newContent.length > 0;
        added = newContent ? newContent.split('\n').length : 0;
        removed = 0;
      }
      return {
        file: filePath,
        basename: basename(filePath),
        dirpath: dirpath(filePath),
        oldContent,
        newContent,
        hasDiff,
        filePath,
        status,
        added,
        removed,
      };
    });
  }

  const isStaged = (s: string) => s.startsWith('staged-');

  let untrackedContent: Record<string, string> = {};

  $: void loadUntrackedContent(state.status, instance?.worktreePath ?? null);

  async function loadUntrackedContent(
    status: typeof state.status,
    wt: string | null,
  ): Promise<void> {
    if (!wt) {
      if (Object.keys(untrackedContent).length) untrackedContent = {};
      return;
    }
    const paths = Object.entries(status)
      .filter(([p, s]) => s === 'untracked' && !isBinaryPath(p))
      .map(([p]) => p);
    const next: Record<string, string> = {};
    for (const p of paths) {
      next[p] = (await readFile(`${wt}/${p}`).catch(() => '')) ?? '';
    }
    untrackedContent = next;
  }

  $: unstagedCards = buildFileCards(
    Object.entries(state.status).filter(([, s]) => !isStaged(s)),
    state.unstagedDiffs,
    untrackedContent,
  );

  $: filteredUnstagedCards = $currentProjectViewState.gitChangesSearch.trim()
    ? unstagedCards.filter(h => h.filePath.toLowerCase().includes($currentProjectViewState.gitChangesSearch.toLowerCase()))
    : unstagedCards;

  $: stagedCards = buildFileCards(
    Object.entries(state.status).filter(([, s]) => isStaged(s)),
    state.stagedDiffs,
  );

  $: remoteLabel = (() => {
    if (!state.currentBranch) return '';
    if (!state.remoteStatus?.hasUpstream) return `on ${state.currentBranch}`;
    const { ahead, behind } = state.remoteStatus;
    const parts = [];
    if (ahead) parts.push(`${ahead} ahead`);
    if (behind) parts.push(`${behind} behind`);
    const suffix = parts.length ? ` · ${parts.join(', ')} of origin` : ' · up to date';
    return `on ${state.currentBranch}${suffix}`;
  })();

  type SelectedCommitInfo = {
    hash: string;
    shortHash: string;
    message: string;
    author: string;
    date: string;
  };

  let selectedCommit: SelectedCommitInfo | null = null;
  let selectedCommitDiff: GitFileDiff[] = [];
  let isLoadingCommitDiff = false;

  function diffStatus(hunks: GitDiffHunk[]): string {
    const changed = hunks.flatMap(h => h.lines).filter(l => l.kind !== 'context');
    const hasAdd = changed.some(l => l.kind === 'add');
    const hasRemove = changed.some(l => l.kind === 'remove');
    if (hasAdd && !hasRemove) return 'staged-added';
    if (!hasAdd && hasRemove) return 'staged-deleted';
    return 'staged-modified';
  }

  $: commitDiffCards = selectedCommitDiff.map(f => {
    const lines = f.hunks.flatMap(h => h.lines);
    return {
      filePath: f.filePath,
      file: f.filePath,
      basename: basename(f.filePath),
      dirpath: dirpath(f.filePath),
      oldContent: lines.filter(l => l.kind !== 'add').map(l => l.content).join('\n'),
      newContent: lines.filter(l => l.kind !== 'remove').map(l => l.content).join('\n'),
      hasDiff: lines.length > 0,
      status: diffStatus(f.hunks),
      added: lines.filter(l => l.kind === 'add').length,
      removed: lines.filter(l => l.kind === 'remove').length,
    };
  });

  $: totalAdded          = commitDiffCards.reduce((s, c) => s + c.added,   0);
  $: totalRemoved        = commitDiffCards.reduce((s, c) => s + c.removed, 0);
  $: totalStagedAdded   = stagedCards.reduce((s, c) => s + c.added,   0);
  $: totalStagedRemoved = stagedCards.reduce((s, c) => s + c.removed, 0);

  async function selectCommit(commit: SelectedCommitInfo) {
    if (!instance?.worktreePath) return;
    if (selectedCommit?.hash === commit.hash) {
      clearSelectedCommit();
      return;
    }
    selectedCommit = commit;
    selectedCommitDiff = [];
    isLoadingCommitDiff = true;
    try {
      selectedCommitDiff = await getDiffCommit(instance.worktreePath, commit.hash);
    } catch {
      selectedCommitDiff = [];
    } finally {
      isLoadingCommitDiff = false;
    }
  }

  function clearSelectedCommit() {
    selectedCommit = null;
    selectedCommitDiff = [];
    isLoadingCommitDiff = false;
    revertError = null;
  }

  let isReverting = false;
  let revertError: string | null = null;

  async function doRevert(hash: string) {
    isReverting = true;
    revertError = null;
    try {
      await revertCommit(hash);
      clearSelectedCommit();
    } catch (e) {
      revertError = String(e);
    } finally {
      isReverting = false;
    }
  }

  let discardTarget: string | null = null;
  let isDiscarding = false;

  function openDiscard(filePath: string) {
    discardTarget = filePath;
  }

  function closeDiscard() {
    discardTarget = null;
  }

  async function handleDiscard() {
    if (!discardTarget) return;
    isDiscarding = true;
    const path = discardTarget;
    try {
      await discardFile(path);
      discardTarget = null;
      dispatch('fileDiscarded', path);
    } finally {
      isDiscarding = false;
    }
  }

  let selectedStash: GitStash | null = null;
  let stashDiffFiles: GitFileDiff[] = [];
  let isLoadingStashDiff = false;

  $: stashDiffCards = stashDiffFiles.map(f => {
    const lines = f.hunks.flatMap(h => h.lines);
    return {
      filePath: f.filePath,
      file: f.filePath,
      basename: basename(f.filePath),
      dirpath: dirpath(f.filePath),
      oldContent: lines.filter(l => l.kind !== 'add').map(l => l.content).join('\n'),
      newContent: lines.filter(l => l.kind !== 'remove').map(l => l.content).join('\n'),
      hasDiff: lines.length > 0,
      status: diffStatus(f.hunks),
      added: lines.filter(l => l.kind === 'add').length,
      removed: lines.filter(l => l.kind === 'remove').length,
    };
  });

  async function handleSelectStash(stash: GitStash | null) {
    selectedStash = stash;
    stashDiffFiles = [];
    if (!stash) return;
    isLoadingStashDiff = true;
    try {
      stashDiffFiles = await getStashDiff(stash.index);
    } catch {
      stashDiffFiles = [];
    } finally {
      isLoadingStashDiff = false;
    }
  }

  function setLeftTab(tab: 'changes' | 'log' | 'graph' | 'stash') {
    gitLeftTab.set(tab);
    if (tab === 'changes') { clearSelectedCommit(); selectedStash = null; }
    if (tab === 'log') { refreshLog(); selectedStash = null; }
    if (tab === 'graph') { refreshGraph(); selectedStash = null; }
    if (tab === 'stash') { clearSelectedCommit(); refreshStashes(); }
  }

  function relativeTime(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24);
    return d < 30 ? `${d}d` : new Date(dateStr).toLocaleDateString();
  }

  $: aheadCount = state.remoteStatus?.ahead ?? 0;
  $: aheadHashes = new Set(state.log.slice(0, aheadCount).map(c => c.hash));

  $: filteredLog = (() => {
    const list = state.log.filter(c => c.onCurrentBranch);
    const q = $currentProjectViewState.gitLogSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter(c =>
      c.message.toLowerCase().includes(q) ||
      c.author.toLowerCase().includes(q) ||
      c.hash.toLowerCase().includes(q) ||
      c.shortHash.toLowerCase().includes(q),
    );
  })();

  let lastWorktreePath = '';

  onMount(() => {
    if (instance?.worktreePath) {
      lastWorktreePath = instance.worktreePath;
      refreshStatus();
    }
  });

  $: if (instance?.worktreePath && instance.worktreePath !== lastWorktreePath) {
    lastWorktreePath = instance.worktreePath;
    refreshStatus();
    refreshLog();
  }

  $: if ($activeStep === 'git' && instance?.worktreePath) {
    refreshStatus();
    refreshLog();
    if ($gitLeftTab === 'graph') refreshGraph();
  }

  $: stagedCount = Object.values(state.status).filter(s => isStaged(s)).length;
  $: canCommit = (stagedCount > 0 || amendMode || allowEmpty) && state.commitMessage.trim().length > 0;

  let showOptions = false;
  let profileDropdownOpen = false;
  let profileTriggerEl: HTMLElement | null = null;
  let profileDropdownEl: HTMLElement | null = null;
  let noVerify = false;
  let signOff = false;
  let allowEmpty = false;
  let amendMode = false;
  let appendTicketId = false;
  let selectedProfileId = '';

  function pickProfile(id: string) {
    selectedProfileId = id;
    profileDropdownOpen = false;
  }

  function handleWindowPointerdown(e: PointerEvent) {
    if (!profileDropdownOpen) return;
    const target = e.target as Node;
    if (!profileTriggerEl?.contains(target) && !profileDropdownEl?.contains(target)) {
      profileDropdownOpen = false;
    }
  }

  $: hasActiveOptions = noVerify || signOff || allowEmpty || amendMode || appendTicketId;

  let commitStateLoaded = false;
  let prevInstanceId = '';

  $: {
    const iid = instance?.id ?? '';
    if (iid && iid !== prevInstanceId) {
      prevInstanceId = iid;
      commitStateLoaded = false;
      getCommitState(instance!.projectId, iid).then((s) => {
        if (s) {
          noVerify = s.noVerify;
          signOff = s.signOff;
          allowEmpty = s.allowEmpty;
          selectedProfileId = s.selectedProfileId;
          appendTicketId = s.appendTicketId ?? false;
        } else {
          noVerify = false;
          signOff = false;
          allowEmpty = false;
          selectedProfileId = '';
          appendTicketId = false;
        }
        commitStateLoaded = true;
      });
    }
  }

  $: if (commitStateLoaded && instance) {
    saveCommitState(instance.projectId, instance.id, {
      noVerify, signOff, allowEmpty, selectedProfileId, appendTicketId,
    });
  }

  async function toggleAmend() {
    amendMode = !amendMode;
    if (amendMode) {
      await refreshLog();
      const lastMsg = $git.log[0]?.message ?? '';
      if (lastMsg) setCommitMessage(lastMsg);
    }
  }

  function buildOptions() {
    const opts: Record<string, unknown> = { noVerify, signOff, allowEmpty };
    if (selectedProfileId) {
      const profile = $settings.gitProfiles.find(p => p.id === selectedProfileId);
      if (profile) {
        opts.authorName = profile.name;
        opts.authorEmail = profile.email;
      }
    }
    return opts;
  }

  function buildCommitMessage(): string {
    const ticketId = instance?.ticket?.id;
    if (appendTicketId && ticketId) {
      return `${state.commitMessage}, ${ticketId}`;
    }
    return state.commitMessage;
  }

  async function doCommit() {
    const opts = buildOptions();
    const message = buildCommitMessage();
    if (amendMode) {
      await amendLastCommit(message, opts);
      amendMode = false;
    } else {
      await commitChanges(message, opts);
    }
  }

  let isPushing = false;

  async function doPush() {
    isPushing = true;
    await tick();
    await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    try {
      await pushBranch();
    } finally {
      isPushing = false;
    }
  }

  async function doCommitAndPush() {
    await doCommit();
    await doPush();
  }
</script>

<svelte:window on:pointerdown={handleWindowPointerdown} on:keydown={(e) => { if (e.key === 'Escape' && discardTarget) closeDiscard(); }}/>

<div class="git-layout">
  <!-- Left column: changes / log tabs -->
  <div class="git-col">
    <div class="git-col-head tab-head">
      <button
        class="col-tab"
        class:active={$gitLeftTab === 'changes'}
        on:click={() => setLeftTab('changes')}
      >
        {t('git.changesTab')}
        <span class="col-tab-count">{unstagedCards.length}</span>
      </button>
      <button
        class="col-tab"
        class:active={$gitLeftTab === 'stash'}
        on:click={() => setLeftTab('stash')}
      >
        {t('git.stashTab')}
        {#if state.stashes.length > 0}
          <span class="col-tab-count">{state.stashes.length}</span>
        {/if}
      </button>
      <button
        class="col-tab"
        class:active={$gitLeftTab === 'log'}
        on:click={() => setLeftTab('log')}
      >
        {t('git.logTab')}
        {#if aheadCount > 0}
          <span class="col-tab-badge">{aheadCount}</span>
        {/if}
      </button>
      <button
        class="col-tab"
        class:active={$gitLeftTab === 'graph'}
        on:click={() => setLeftTab('graph')}
      >
        {t('git.graphTab')}
      </button>
    </div>

    {#if $gitLeftTab === 'changes'}
      <div class="log-filter-bar">
        <div class="log-search">
          <Icon name="search" size={11}/>
          <input
            class="log-search-input"
            value={$currentProjectViewState.gitChangesSearch}
            on:input={(e) => updateProjectViewState({ gitChangesSearch: e.currentTarget.value })}
            placeholder={t('git.changesSearchPlaceholder') as string}
          />
          {#if $currentProjectViewState.gitChangesSearch}
            <button class="log-search-clear" on:click={() => updateProjectViewState({ gitChangesSearch: '' })}>×</button>
          {/if}
        </div>
      </div>
      <div class="hunks-list">
        {#if unstagedCards.length === 0}
          <div class="empty-hint">
            {#if state.isLoading}
              ...
            {:else if stagedCards.length > 0}
              {t('git.cleanAllStaged')}
            {:else}
              {t('git.workingTreeClean')}
            {/if}
          </div>
        {:else if filteredUnstagedCards.length === 0}
          <div class="empty-hint">{t('git.changesNoResults')}</div>
        {:else}
          {#each filteredUnstagedCards as h (h.filePath)}
            <div class="hunk-card {STATUS_CLASS[h.status] ?? ''}">
              <div class="hunk-card-head">
                <span class="file-info">
                  <span class="file-basename">{h.basename}</span>
                  {#if h.dirpath}<span class="file-dir">{h.dirpath}</span>{/if}
                </span>
                {#if h.added > 0 || h.removed > 0}
                  <span class="diff-stat">
                    {#if h.added > 0}<span class="stat-add">+{h.added}</span>{/if}
                    {#if h.removed > 0}<span class="stat-remove">-{h.removed}</span>{/if}
                  </span>
                {/if}
                {#if h.status !== 'deleted'}
                  <button class="open-file-btn" title={h.filePath} on:click={() => dispatch('openFile', h.filePath)}>
                    <Icon name="external" size={12}/>
                  </button>
                {/if}
                {#if h.status !== 'untracked'}
                  <button class="discard-btn" title={t('git.discardTitle') as string} on:click={() => openDiscard(h.filePath)}>
                    <Icon name="undo" size={12}/>
                  </button>
                {/if}
                <button class="stage-btn" on:click={() => stageFile(h.filePath)}>
                  {t('git.stage')}
                </button>
              </div>
              {#if h.hasDiff}
                <div class="card-diff">
                  {#key h.filePath}
                    <InlineDiff oldContent={h.oldContent} newContent={h.newContent} language={langFromPath(h.filePath) as EditorLanguage} />
                  {/key}
                </div>
              {:else}
                <div class="hunk-no-preview">{t('git.noDiffPreview')}</div>
              {/if}
            </div>
          {/each}
        {/if}
      </div>
    {:else if $gitLeftTab === 'log'}
      {#if aheadCount > 0}
        <div class="log-push-bar">
          <span class="log-push-label">{aheadCount} {t('git.commitsAhead')}</span>
          <button class="btn primary log-push-btn" disabled={isPushing} on:click={doPush}>
            {#if isPushing}
              <Spinner size={12} trackColor="oklch(1 0 0 / 0.3)" color="white"/>
            {:else}
              <Icon name="send" size={12}/>
            {/if}
            {t('git.push')}
          </button>
        </div>
      {/if}
      <div class="log-filter-bar">
        <div class="log-search">
          <Icon name="search" size={11}/>
          <input
            class="log-search-input"
            value={$currentProjectViewState.gitLogSearch}
            on:input={(e) => updateProjectViewState({ gitLogSearch: e.currentTarget.value })}
            placeholder={t('git.logSearchPlaceholder') as string}
          />
          {#if $currentProjectViewState.gitLogSearch}
            <button class="log-search-clear" on:click={() => updateProjectViewState({ gitLogSearch: '' })}>×</button>
          {/if}
        </div>
      </div>
      <div class="log-list">
        {#if state.log.length === 0}
          <div class="empty-hint">{t('git.noHistory')}</div>
        {:else if filteredLog.length === 0}
          <div class="empty-hint">{t('git.logNoResults')}</div>
        {:else}
          {#each filteredLog as commit}
            <div
              class="log-entry"
              class:is-ahead={aheadHashes.has(commit.hash)}
              class:is-selected={selectedCommit?.hash === commit.hash}
              role="button"
              tabindex="0"
              on:click={() => selectCommit(commit)}
              on:keydown={(e) => e.key === 'Enter' && selectCommit(commit)}
            >
              <div class="log-entry-main">
                <span class="log-hash">{commit.shortHash}</span>
                <span class="log-message">{commit.message}</span>
              </div>
              <div class="log-entry-meta">
                <span class="log-author">{commit.author}</span>
                <span class="log-date">{relativeTime(commit.date)}</span>
              </div>
            </div>
          {/each}
        {/if}
      </div>
    {:else if $gitLeftTab === 'graph'}
      <GraphView
        commits={state.graph}
        currentBranch={state.currentBranch}
        instances={projectInstances}
        selectedHash={selectedCommit?.hash ?? ''}
        on:switchInstance={(e) => instance && activateInstance(instance.projectId, e.detail.id)}
        on:selectCommit={(e) => selectCommit(e.detail)}
      />
    {:else if $gitLeftTab === 'stash'}
      <StashView
        selectedStashIndex={selectedStash?.index ?? null}
        on:selectStash={(e) => handleSelectStash(e.detail)}
      />
    {/if}
  </div>

  <!-- Right column: commit diff / stash diff when selected, else staged + commit -->
  <div class="git-col">
    {#if $gitLeftTab === 'stash' && selectedStash}
      <div class="git-col-head commit-diff-head">
        <button class="back-btn" title={t('common.close') as string} on:click={() => handleSelectStash(null)}>
          <Icon name="x" size={11}/>
        </button>
        <div class="commit-diff-info">
          <div class="commit-diff-title">
            <span class="log-hash">{selectedStash.name}</span>
            <span class="commit-diff-message">{selectedStash.message || selectedStash.name}</span>
          </div>
          {#if selectedStash.branch}
            <span class="log-author">{t('git.stashOn')} {selectedStash.branch}</span>
          {/if}
        </div>
        <div class="commit-diff-right">
          {#if isLoadingStashDiff}
            <Spinner size={10} trackColor="var(--bg-3)" color="var(--fg-3)"/>
          {:else}
            <span class="log-date">{selectedStash.date ? new Date(selectedStash.date).toLocaleDateString() : ''}</span>
            {#if stashDiffCards.length > 0}
              <span class="meta-sep">·</span>
              <span class="diff-file-count">{stashDiffCards.length} {t('git.files')}</span>
            {/if}
          {/if}
        </div>
      </div>
      <div class="hunks-list">
        {#if isLoadingStashDiff}
          <div class="empty-hint">
            <Spinner size={16} trackColor="var(--bg-3)" color="var(--fg-3)"/>
          </div>
        {:else if stashDiffCards.length === 0}
          <div class="empty-hint">{t('git.stashDiffEmpty')}</div>
        {:else}
          {#each stashDiffCards as card (card.filePath)}
            <div class="hunk-card {STATUS_CLASS[card.status] ?? ''}">
              <div class="hunk-card-head">
                <span class="file-info">
                  <span class="file-basename">{card.basename}</span>
                  {#if card.dirpath}<span class="file-dir">{card.dirpath}</span>{/if}
                </span>
                {#if card.added > 0 || card.removed > 0}
                  <span class="diff-stat">
                    {#if card.added > 0}<span class="stat-add">+{card.added}</span>{/if}
                    {#if card.removed > 0}<span class="stat-remove">-{card.removed}</span>{/if}
                  </span>
                {/if}
                {#if card.status !== 'staged-deleted'}
                  <button class="open-file-btn" title={card.filePath} on:click={() => dispatch('openFile', card.filePath)}>
                    <Icon name="external" size={12}/>
                  </button>
                {/if}
              </div>
              {#if card.hasDiff}
                <div class="card-diff">
                  {#key card.filePath}
                    <InlineDiff oldContent={card.oldContent} newContent={card.newContent} language={langFromPath(card.filePath) as EditorLanguage} />
                  {/key}
                </div>
              {:else}
                <div class="hunk-no-preview">{t('git.noDiffPreview')}</div>
              {/if}
            </div>
          {/each}
        {/if}
      </div>
    {:else if selectedCommit}
      <div class="git-col-head commit-diff-head">
        <button class="back-btn" title={t('common.close') as string} on:click={clearSelectedCommit}>
          <Icon name="x" size={11}/>
        </button>
        <div class="commit-diff-info">
          <div class="commit-diff-title">
            <span class="log-hash">{selectedCommit.shortHash}</span>
            <span class="commit-diff-message">{selectedCommit.message}</span>
          </div>
          <span class="log-author">{selectedCommit.author}</span>
        </div>
        <div class="commit-diff-right">
          {#if isLoadingCommitDiff}
            <Spinner size={10} trackColor="var(--bg-3)" color="var(--fg-3)"/>
          {:else}
            <span class="log-date">{relativeTime(selectedCommit.date)}</span>
            <span class="meta-sep">·</span>
            <span class="diff-file-count">{commitDiffCards.length} {t('git.files')}</span>
            {#if totalAdded > 0 || totalRemoved > 0}
              <span class="meta-sep">·</span>
              <span class="diff-stat">
                {#if totalAdded > 0}<span class="stat-add">+{totalAdded}</span>{/if}
                {#if totalRemoved > 0}<span class="stat-remove">-{totalRemoved}</span>{/if}
              </span>
            {/if}
          {/if}
          <button
            class="revert-btn"
            disabled={isReverting || isLoadingCommitDiff}
            title={t('git.revertCommitTitle') as string}
            on:click={() => doRevert(selectedCommit!.hash)}
          >
            {#if isReverting}
              <Spinner size={10} trackColor="var(--bg-3)" color="var(--fg-2)"/>
            {:else}
              <Icon name="undo" size={11}/>
            {/if}
            {t('git.revertCommit')}
          </button>
        </div>
      </div>
      {#if revertError}
        <div class="revert-error">{revertError}</div>
      {/if}
      <div class="hunks-list">
        {#if isLoadingCommitDiff}
          <div class="empty-hint">
            <Spinner size={16} trackColor="var(--bg-3)" color="var(--fg-3)"/>
          </div>
        {:else if commitDiffCards.length === 0}
          <div class="empty-hint">{t('git.commitDiffEmpty')}</div>
        {:else}
          {#each commitDiffCards as card (card.filePath)}
            <div class="hunk-card {STATUS_CLASS[card.status] ?? ''}">
              <div class="hunk-card-head">
                <span class="file-info">
                  <span class="file-basename">{card.basename}</span>
                  {#if card.dirpath}<span class="file-dir">{card.dirpath}</span>{/if}
                </span>
                {#if card.added > 0 || card.removed > 0}
                  <span class="diff-stat">
                    {#if card.added > 0}<span class="stat-add">+{card.added}</span>{/if}
                    {#if card.removed > 0}<span class="stat-remove">-{card.removed}</span>{/if}
                  </span>
                {/if}
                {#if card.status !== 'staged-deleted'}
                  <button class="open-file-btn" title={card.filePath} on:click={() => dispatch('openFile', card.filePath)}>
                    <Icon name="external" size={12}/>
                  </button>
                {/if}
              </div>
              {#if card.hasDiff}
                <div class="card-diff">
                  {#key card.filePath}
                    <InlineDiff oldContent={card.oldContent} newContent={card.newContent} language={langFromPath(card.filePath) as EditorLanguage} />
                  {/key}
                </div>
              {:else}
                <div class="hunk-no-preview">{t('git.noDiffPreview')}</div>
              {/if}
            </div>
          {/each}
        {/if}
      </div>
    {:else}
      <div class="git-col-head">
        <Icon name="circle-dot" size={12} style="color: var(--accent)"/>
        <span>{t('git.stagedForCommit')}</span>
        <span class="count accent">{stagedCards.length} {t('git.files')}</span>
        {#if totalStagedAdded > 0 || totalStagedRemoved > 0}
          <span class="diff-stat">
            {#if totalStagedAdded > 0}<span class="stat-add">+{totalStagedAdded}</span>{/if}
            {#if totalStagedRemoved > 0}<span class="stat-remove">-{totalStagedRemoved}</span>{/if}
          </span>
        {/if}
      </div>
      <div class="hunks-list">
        {#if stagedCards.length === 0}
          <div class="empty-hint">
            {t('git.noStagedChanges')}
          </div>
        {:else}
          {#each stagedCards as h (h.filePath)}
            <div class="hunk-card {STATUS_CLASS[h.status] ?? ''}">
              <div class="hunk-card-head">
                <span class="file-info">
                  <span class="file-basename">{h.basename}</span>
                  {#if h.dirpath}<span class="file-dir">{h.dirpath}</span>{/if}
                </span>
                {#if h.added > 0 || h.removed > 0}
                  <span class="diff-stat">
                    {#if h.added > 0}<span class="stat-add">+{h.added}</span>{/if}
                    {#if h.removed > 0}<span class="stat-remove">-{h.removed}</span>{/if}
                  </span>
                {/if}
                {#if h.status !== 'staged-deleted'}
                  <button class="open-file-btn" title={h.filePath} on:click={() => dispatch('openFile', h.filePath)}>
                    <Icon name="external" size={12}/>
                  </button>
                {/if}
                <button class="unstage-btn" on:click={() => unstageFile(h.filePath)}>
                  {t('git.unstage')}
                </button>
              </div>
              {#if h.hasDiff}
                <div class="card-diff">
                  {#key h.filePath}
                    <InlineDiff oldContent={h.oldContent} newContent={h.newContent} language={langFromPath(h.filePath) as EditorLanguage} />
                  {/key}
                </div>
              {:else}
                <div class="hunk-no-preview">{t('git.noDiffPreview')}</div>
              {/if}
            </div>
          {/each}
        {/if}
      </div>

    <div class="commit-composer">
      <div class="commit-composer-head">
        <span class="commit-label">{t('git.commitMessage')}</span>
        <div class="spacer"></div>
        {#if $settings.gitProfiles.length === 0}
          <button class="profile-trigger profile-trigger-empty" on:click={goToGitSettings}>
            <Icon name="user" size={10}/>
            <span>{t('git.profileSelectorCreate')}</span>
          </button>
        {:else}
          <button
            class="profile-trigger"
            class:open={profileDropdownOpen}
            bind:this={profileTriggerEl}
            on:click={() => profileDropdownOpen = !profileDropdownOpen}
          >
            <Icon name="user" size={10}/>
            <span class="profile-trigger-label">
              {selectedProfileId
                ? ($settings.gitProfiles.find(p => p.id === selectedProfileId)?.label ?? '')
                : t('git.profileDefault')}
            </span>
            <Icon name="chev-d" size={9}/>
          </button>
          {#if profileDropdownOpen}
            <div class="profile-dropdown" bind:this={profileDropdownEl}>
              <button
                class="profile-opt"
                class:is-selected={!selectedProfileId}
                on:click={() => pickProfile('')}
              >
                <Icon name="user" size={11}/>
                <span class="profile-opt-name">{t('git.profileDefault')}</span>
                {#if !selectedProfileId}<Icon name="check" size={10}/>{/if}
              </button>
              {#each $settings.gitProfiles as p}
                <button
                  class="profile-opt"
                  class:is-selected={selectedProfileId === p.id}
                  on:click={() => pickProfile(p.id)}
                >
                  <span class="profile-avatar-sm">{p.label[0].toUpperCase()}</span>
                  <span class="profile-opt-name">{p.label}</span>
                  {#if selectedProfileId === p.id}<Icon name="check" size={10}/>{/if}
                </button>
              {/each}
              <div class="profile-dropdown-foot">
                <button class="profile-manage-btn" on:click={() => { profileDropdownOpen = false; goToGitSettingsManage(); }}>
                  <Icon name="settings" size={9}/> {t('git.manageProfiles')}
                </button>
              </div>
            </div>
          {/if}
        {/if}
        <button
          class="options-btn"
          class:active={showOptions}
          title={t('git.commitOptions') as string}
          on:click={() => showOptions = !showOptions}
        >
          <Icon name="settings" size={11}/>
          {#if hasActiveOptions}<span class="options-badge"></span>{/if}
        </button>
        <button class="ai-suggest"><Icon name="sparkles" size={11}/> {t('git.regenerateWithAi')}</button>
      </div>
      <textarea
        class="commit-msg"
        value={state.commitMessage}
        placeholder={t('git.commitPlaceholder') as string}
        on:input={(e) => setCommitMessage((e.target as HTMLTextAreaElement).value)}
      ></textarea>
      {#if showOptions}
        <div class="commit-options">
          <label class="option-item">
            <span class="option-text">
              <span class="option-label">{t('git.allowEmpty')}</span>
              <span class="option-desc">{t('git.allowEmptyDesc')}</span>
            </span>
            <label class="settings-toggle">
              <input type="checkbox" bind:checked={allowEmpty} />
              <span class="settings-toggle-track"><span class="settings-toggle-thumb"></span></span>
            </label>
          </label>
          <label class="option-item">
            <span class="option-text">
              <span class="option-label">{t('git.amendCommit')}</span>
              <span class="option-desc">{t('git.amendCommitDesc')}</span>
            </span>
            <label class="settings-toggle">
              <input type="checkbox" checked={amendMode} on:change={toggleAmend} />
              <span class="settings-toggle-track"><span class="settings-toggle-thumb"></span></span>
            </label>
          </label>
          <label class="option-item">
            <span class="option-text">
              <span class="option-label">{t('git.appendTicketId')}</span>
              <span class="option-desc">{t('git.appendTicketIdDesc')}</span>
              {#if instance?.ticket?.id}
                <span class="option-ticket-preview">{instance.ticket.id}</span>
              {/if}
            </span>
            <label class="settings-toggle">
              <input type="checkbox" bind:checked={appendTicketId} disabled={!instance?.ticket?.id} />
              <span class="settings-toggle-track"><span class="settings-toggle-thumb"></span></span>
            </label>
          </label>
          <label class="option-item">
            <span class="option-text">
              <span class="option-label">{t('git.noVerify')}</span>
              <span class="option-desc">{t('git.noVerifyDesc')}</span>
            </span>
            <label class="settings-toggle">
              <input type="checkbox" bind:checked={noVerify} />
              <span class="settings-toggle-track"><span class="settings-toggle-thumb"></span></span>
            </label>
          </label>
          <label class="option-item">
            <span class="option-text">
              <span class="option-label">{t('git.signOff')}</span>
              <span class="option-desc">{t('git.signOffDesc')}</span>
            </span>
            <label class="settings-toggle">
              <input type="checkbox" bind:checked={signOff} />
              <span class="settings-toggle-track"><span class="settings-toggle-thumb"></span></span>
            </label>
          </label>
        </div>
      {/if}
      <div class="commit-row">
        <span class="remote-label">{remoteLabel}</span>
        <div class="spacer"></div>
        <button class="btn ghost" disabled={!canCommit} on:click={doCommit}>
          <Icon name="check" size={13}/> {t('git.commit')}
        </button>
        <button class="btn primary" disabled={!canCommit} on:click={doCommitAndPush}>
          <Icon name="send" size={13}/> {t('git.commitAndPush')}
        </button>
      </div>
    </div>
    {/if}
  </div>
</div>

{#if discardTarget}
  <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
  <div
    class="modal-backdrop"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    on:click={closeDiscard}
    on:keydown={(e) => e.key === 'Escape' && closeDiscard()}
  >
    <div class="modal confirm-modal" on:click|stopPropagation role="presentation">
      <div class="modal-head">
        <div>
          <div class="step-count">GIT</div>
          <h3>{t('git.discardChanges')}</h3>
        </div>
        <button class="icon-btn close" on:click={closeDiscard}>
          <Icon name="x" size={16}/>
        </button>
      </div>
      <div class="modal-body">
        <p class="confirm-body">{(t('git.discardConfirm') as (f: string) => string)(discardTarget)}</p>
      </div>
      <div class="modal-foot">
        <div class="spacer"></div>
        <button class="btn ghost" on:click={closeDiscard}>{t('common.cancel')}</button>
        <button class="btn danger" disabled={isDiscarding} on:click={handleDiscard}>
          {#if isDiscarding}<Spinner size={12} trackColor="oklch(1 0 0 / .3)" color="var(--danger)"/>{/if}
          <Icon name="undo" size={13}/>
          {t('git.discard')}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .git-layout {
    display: flex;
    height: 100%;
    overflow: hidden;
  }

  .git-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-right: 1px solid var(--stroke-0);
  }
  .git-col:last-child { border-right: none; }

  /* Column header */
  .git-col-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--stroke-0);
    font-size: 12px;
    color: var(--fg-2);
    flex-shrink: 0;
  }

  .tab-head {
    padding: 0;
    gap: 0;
  }

  .col-tab {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 9px 14px;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--fg-3);
    font-size: 12px;
    font-family: var(--font-ui);
    cursor: pointer;
    transition: color .1s, border-color .1s;
    white-space: nowrap;
  }
  .col-tab:hover { color: var(--fg-1); }
  .col-tab.active {
    color: var(--fg-0);
    border-bottom-color: var(--accent);
  }

  .col-tab-count {
    font-size: 10px;
    color: var(--fg-4);
    background: var(--bg-3);
    border-radius: 8px;
    padding: 1px 5px;
    line-height: 1.4;
  }
  .col-tab.active .col-tab-count { color: var(--fg-2); }

  .col-tab-badge {
    font-size: 10px;
    color: white;
    background: var(--accent);
    border-radius: 8px;
    padding: 1px 5px;
    line-height: 1.4;
    font-weight: 600;
  }

  .count {
    margin-left: auto;
    font-size: 11px;
    color: var(--fg-4);
  }
  .count.accent { color: var(--accent); }

  /* Log panel */
  .log-push-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 14px;
    background: var(--accent-weak);
    border-bottom: 1px solid var(--accent-line);
    flex-shrink: 0;
  }

  .log-push-label {
    font-size: 12px;
    color: var(--accent);
    font-weight: 500;
  }

  .log-push-btn {
    padding: 4px 10px;
    font-size: 11px;
  }

  .log-filter-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--stroke-0);
    flex-shrink: 0;
  }

  .log-search {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 5px;
    background: var(--bg-0);
    border: 1px solid var(--stroke-0);
    border-radius: 4px;
    padding: 3px 7px;
    min-width: 0;
    color: var(--fg-4);
  }
  .log-search:focus-within {
    border-color: var(--accent);
    color: var(--fg-2);
  }

  .log-search-input {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    font-size: 11px;
    color: var(--fg-0);
    font-family: var(--font-ui);
    min-width: 0;
  }
  .log-search-input::placeholder { color: var(--fg-4); }

  .log-search-clear {
    background: none;
    border: none;
    padding: 0 2px;
    font-size: 13px;
    line-height: 1;
    color: var(--fg-4);
    cursor: pointer;
  }
  .log-search-clear:hover { color: var(--fg-1); }

  .log-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  .log-entry {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 9px 14px;
    border-bottom: 1px solid var(--stroke-0);
    border-left: 3px solid transparent;
    transition: background .1s;
    cursor: pointer;
  }
  .log-entry:hover { background: var(--bg-2); }
  .log-entry.is-ahead { border-left-color: var(--accent); }
  .log-entry.is-ahead .log-message { color: var(--fg-0); font-weight: 500; }
  .log-entry.is-selected { background: color-mix(in srgb, var(--accent) 12%, transparent); border-left-color: var(--accent); }
  .log-entry.is-selected .log-message { color: var(--fg-0); }

  .log-entry-main {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }

  .log-hash {
    font-size: 10px;
    font-family: var(--font-mono);
    color: var(--fg-4);
    flex-shrink: 0;
  }

  .log-message {
    font-size: 12px;
    color: var(--fg-0);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .log-entry.is-ahead .log-message { color: var(--fg-0); font-weight: 500; }

  .log-entry-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-left: 0;
  }

  .log-author {
    font-size: 11px;
    color: var(--fg-3);
  }

  .log-date {
    font-size: 11px;
    color: var(--fg-4);
    margin-left: auto;
  }

  /* Hunk list */
  .hunks-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .empty-hint {
    padding: 32px 20px;
    font-size: 12px;
    color: var(--fg-4);
    text-align: center;
  }

  /* Hunk card */
  .hunk-card {
    border: 1px solid var(--stroke-0);
    border-left-width: 3px;
    border-left-color: var(--stroke-1);
    border-radius: var(--r-sm);
    overflow: hidden;
    background: var(--bg-1);
    min-width: 0;
    flex-shrink: 0;
  }
  .hunk-card.status-modified  { border-left-color: var(--warning); }
  .hunk-card.status-added     { border-left-color: var(--success); }
  .hunk-card.status-deleted   { border-left-color: var(--danger);  }

  .hunk-card-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    font-size: 12px;
  }

  /* File info */
  .file-info {
    display: flex;
    flex-direction: column;
    gap: 1px;
    flex: 1;
    min-width: 0;
  }

  .file-basename {
    font-size: 12px;
    color: var(--fg-0);
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .file-dir {
    font-size: 10px;
    color: var(--fg-4);
    font-family: var(--font-mono);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Diff stat badge */
  .diff-stat {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    font-family: var(--font-mono);
    flex-shrink: 0;
  }

  .stat-add {
    color: var(--success);
    font-weight: 500;
  }

  .stat-remove {
    color: var(--danger);
    font-weight: 500;
  }

  /* Open file button */
  .open-file-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: 1px solid var(--stroke-1);
    border-radius: 3px;
    padding: 3px 5px;
    cursor: pointer;
    color: var(--fg-2);
    flex-shrink: 0;
  }
  .open-file-btn:hover {
    background: var(--bg-4);
    color: var(--fg-0);
    border-color: var(--stroke-2);
  }

  /* Stage / unstage buttons */
  .stage-btn, .unstage-btn {
    border-radius: 3px;
    font-size: 11px;
    padding: 3px 8px;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .stage-btn {
    background: var(--accent);
    color: white;
    border: 1px solid transparent;
  }
  .stage-btn:hover {
    background: var(--accent-hover);
  }

  .unstage-btn {
    background: none;
    border: 1px solid var(--stroke-1);
    color: var(--fg-2);
  }
  .unstage-btn:hover {
    background: var(--bg-4);
    color: var(--fg-0);
    border-color: var(--stroke-2);
  }

  /* Diff body */
  .card-diff {
    position: relative;
    background: var(--bg-0);
    border-top: 1px solid var(--stroke-0);
    min-width: 0;
  }

  .hunk-no-preview {
    padding: 10px 12px;
    font-size: 11.5px;
    color: var(--fg-4);
    font-family: var(--font-mono);
    font-style: italic;
    background: var(--bg-0);
    border-top: 1px solid var(--stroke-0);
  }

  /* Commit composer */
  .commit-composer {
    flex-shrink: 0;
    border-top: 1px solid var(--stroke-0);
    padding: 12px 14px;
    background: var(--bg-1);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .commit-composer-head {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .commit-label {
    font-size: 11px;
    color: var(--fg-3);
    font-family: var(--font-mono);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .spacer { flex: 1; }

  .options-btn {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: 1px solid var(--stroke-0);
    border-radius: 4px;
    padding: 3px 6px;
    color: var(--fg-3);
    font-size: 11px;
    cursor: pointer;
    transition: background .1s, border-color .1s, color .1s;
  }
  .options-btn:hover, .options-btn.active {
    background: var(--bg-4);
    border-color: var(--stroke-1);
    color: var(--fg-0);
  }
  .options-badge {
    position: absolute;
    top: -3px;
    right: -3px;
    width: 6px;
    height: 6px;
    background: var(--accent);
    border-radius: 50%;
  }

  .commit-options {
    display: flex;
    flex-direction: column;
    gap: 0;
    background: var(--bg-0);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-sm);
    overflow: hidden;
  }

  .option-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 12px;
    cursor: pointer;
    transition: background .1s;
  }
  .option-item:not(:last-child) {
    border-bottom: 1px solid var(--stroke-0);
  }
  .option-item:hover { background: var(--bg-2); }

  .option-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
    flex: 1;
    min-width: 0;
  }
  .option-label {
    font-size: 12px;
    color: var(--fg-1);
    font-weight: 500;
  }
  .option-desc {
    font-size: 11px;
    color: var(--fg-4);
  }

  .option-ticket-preview {
    font-size: 10px;
    color: var(--accent);
    font-family: var(--font-mono);
    margin-top: 2px;
  }

  /* Profile picker */
  .profile-trigger {
    -webkit-appearance: none;
    appearance: none;
    display: flex;
    align-items: center;
    gap: 4px;
    background: none;
    border: 1px solid var(--stroke-0);
    border-radius: 4px;
    padding: 3px 8px;
    color: var(--fg-3);
    font-size: 11px;
    cursor: pointer;
    transition: background .1s, border-color .1s, color .1s;
  }

  .profile-trigger:hover,
  .profile-trigger.open {
    background: var(--bg-4);
    border-color: var(--stroke-1);
    color: var(--fg-0);
  }

  .profile-trigger-label {
    max-width: 100px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .profile-trigger-empty {
    border-style: dashed;
  }
  .profile-trigger-empty:hover {
    border-color: var(--accent-line);
    color: var(--accent);
    background: var(--accent-weak);
  }

  .profile-avatar-sm {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--bg-4);
    color: var(--fg-1);
    font-size: 10px;
    font-weight: 600;
    flex-shrink: 0;
    line-height: 1;
  }

  /* Dropdown panel */
  .profile-dropdown {
    position: absolute;
    top: calc(100% + 5px);
    right: 0;
    min-width: 180px;
    background: var(--bg-1);
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-md);
    box-shadow: 0 6px 20px rgba(0, 0, 0, .4);
    overflow: hidden;
    z-index: 200;
  }

  .profile-opt {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 10px;
    background: none;
    border: none;
    border-bottom: 1px solid var(--stroke-0);
    color: var(--fg-1);
    font-size: 12px;
    font-family: var(--font-ui);
    cursor: pointer;
    text-align: left;
    transition: background .1s;
  }
  .profile-opt:last-of-type { border-bottom: none; }
  .profile-opt:hover { background: var(--bg-3); }
  .profile-opt.is-selected { color: var(--accent); }

  .profile-opt-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .profile-dropdown-foot {
    border-top: 1px solid var(--stroke-0);
    padding: 4px;
  }

  .profile-manage-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    width: 100%;
    padding: 5px 8px;
    background: none;
    border: none;
    border-radius: var(--r-xs);
    color: var(--fg-3);
    font-size: 11px;
    font-family: var(--font-ui);
    cursor: pointer;
    transition: background .1s, color .1s;
  }
  .profile-manage-btn:hover {
    background: var(--bg-3);
    color: var(--fg-1);
  }

  .ai-suggest {
    display: flex;
    align-items: center;
    gap: 4px;
    background: none;
    border: 1px solid var(--stroke-0);
    border-radius: 4px;
    color: var(--fg-3);
    font-size: 11px;
    padding: 3px 8px;
    cursor: pointer;
  }
  .ai-suggest:hover {
    background: var(--bg-4);
    color: var(--fg-0);
    border-color: var(--stroke-1);
  }

  .commit-msg {
    width: 100%;
    background: var(--bg-0);
    border: 1px solid var(--stroke-0);
    border-radius: 4px;
    color: var(--fg-0);
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.5;
    padding: 8px;
    resize: vertical;
    min-height: 64px;
    outline: none;
    box-sizing: border-box;
  }
  .commit-msg:focus { border-color: var(--accent); }
  .commit-msg::placeholder { color: var(--fg-4); }

  .commit-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .remote-label {
    font-size: 11px;
    color: var(--fg-4);
    font-family: var(--font-mono);
  }

  /* Commit diff panel */
  .commit-diff-head {
    gap: 10px;
  }

  .back-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: 1px solid var(--stroke-1);
    border-radius: 3px;
    padding: 5px 6px;
    cursor: pointer;
    color: var(--fg-3);
    flex-shrink: 0;
  }
  .back-btn:hover { background: var(--bg-4); color: var(--fg-0); border-color: var(--stroke-2); }

  .commit-diff-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .commit-diff-title {
    display: flex;
    align-items: baseline;
    gap: 7px;
    min-width: 0;
  }

  .commit-diff-message {
    font-size: 12px;
    font-weight: 500;
    color: var(--fg-0);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .commit-diff-right {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-shrink: 0;
  }
  .commit-diff-right .log-date { margin-left: 0; }

  .discard-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: 1px solid var(--stroke-1);
    border-radius: 3px;
    padding: 3px 5px;
    cursor: pointer;
    color: var(--fg-3);
    flex-shrink: 0;
    transition: background .1s, border-color .1s, color .1s;
  }
  .discard-btn:hover {
    background: var(--danger-weak);
    border-color: transparent;
    color: var(--danger);
  }

  .confirm-modal { width: min(400px, 92vw); }

  .confirm-body {
    font-size: 13px;
    color: var(--fg-1);
    line-height: 1.6;
    margin: 0;
    word-break: break-all;
  }

  .revert-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    background: none;
    border: 1px solid var(--stroke-1);
    border-radius: 3px;
    padding: 3px 8px;
    font-size: 11px;
    font-family: var(--font-ui);
    color: var(--fg-2);
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
    transition: background .1s, border-color .1s, color .1s;
  }
  .revert-btn:hover:not(:disabled) {
    background: var(--bg-4);
    border-color: var(--stroke-2);
    color: var(--fg-0);
  }
  .revert-btn:disabled { opacity: 0.5; cursor: default; }

  .revert-error {
    padding: 8px 14px;
    font-size: 11px;
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 10%, transparent);
    border-bottom: 1px solid color-mix(in srgb, var(--danger) 20%, transparent);
    font-family: var(--font-mono);
    white-space: pre-wrap;
    flex-shrink: 0;
  }

  .meta-sep {
    font-size: 11px;
    color: var(--fg-2);
    user-select: none;
  }

  .diff-file-count {
    font-size: 11px;
    color: var(--fg-4);
  }
</style>
