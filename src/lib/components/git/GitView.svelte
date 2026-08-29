<script lang="ts">
  /**
   * Main git workspace: staged and unstaged changes, commit box, history, graph and stashes.
   * Dispatches `openFile` with a path, `fileDiscarded`, `filesChanged`, `createInstanceFromRef`
   * with a ref, and `goGitSettings` to hand navigation back to the settings screen.
   */
  import { onMount, createEventDispatcher, tick } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import CopyButton from '$lib/components/CopyButton.svelte';
  import GitDiff from '$lib/components/git/GitDiff.svelte';
  import GraphView from '$lib/components/git/GraphView.svelte';
  import StashView from '$lib/components/git/StashView.svelte';
  import GitBranchBar from '$lib/components/git/GitBranchBar.svelte';
  import MergeRebaseView from '$lib/components/git/MergeRebaseView.svelte';
  import GitignoreView from '$lib/components/git/GitignoreView.svelte';
  import { readFile, readFilePreview, isBinaryPath } from '$lib/services/file-service';
  import { getDiffCommit, getCommitBody, checkIgnore, toGitError } from '$lib/services/git-service';
  import type { GitFileDiff, GitDiffHunk, GitError } from '$lib/services/git-service';
  import { describeGitError } from '$lib/utils/git/git-error';
  import type { GitErrorAction } from '$lib/utils/git/git-error';
  import { t } from '$lib/i18n';
  import {
    git,
    refreshStatus,
    setDiffsWanted,
    refreshLog,
    loadMoreLog,
    loadAllLog,
    refreshGraph,
    loadMoreGraph,
    loadAllGraph,
    refreshStashes,
    getStashDiff,
    getHeadCommitMessage,
    stageFile,
    stageFiles,
    unstageFile,
    unstageFiles,
    discardFile,
    discardFiles,
    commitChanges,
    amendLastCommit,
    pushBranch,
    pushStash,
    setCommitMessage,
    setCommitBody,
    revertCommit,
    clearGitError,
    recoverFromGitError,
  } from '$lib/stores/git';
  import type { GitStash } from '$lib/services/git-service';
  import { activeInstance, instances } from '$lib/stores/instance';
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { capabilities } from '$lib/stores/integrations';
  import { getRemoteUrl } from '$lib/stores/git';
  import type { WebLinkTarget } from '$lib/types/integrations';
  import { forgeLabel, forgeLink } from '$lib/utils/integrations/links';
  import { activateInstance } from '$lib/stores/project';
  import { settings } from '$lib/stores/settings';
  import { activeStep, pendingGitAction, gitLeftTab } from '$lib/stores/ui';
  import { currentProjectViewState, updateProjectViewState } from '$lib/stores/view-state';
  import { getGitCollapseState, saveGitCollapseState } from '$lib/services/git-collapse-state-service';
  import { getCommitState, saveCommitState } from '$lib/services/commit-state-service';
  import { AiAssistError, runOneShot } from '$lib/services/ai-assist-service';
  import { readOnlyPermissionMode, readOnlyTools, resolveAiFeature } from '$lib/utils/home/ai-features';
  import { aiProviders, loadAiProviders } from '$lib/stores/ai-providers';
  import { parseCommitMessage, renderCommitPrompt } from '$lib/utils/git/commit-message';

  const dispatch = createEventDispatcher<{ openFile: string; goGitSettings: void; fileDiscarded: string; filesChanged: void; createInstanceFromRef: string }>();

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
    hunks: GitDiffHunk[];
    hasDiff: boolean;
    filePath: string;
    status: string;
    added: number;
    removed: number;
    /** The diff stops short of the whole change; the card says so. */
    truncated?: boolean;
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

  /**
   * Counts added and removed lines across every hunk of a file diff, and infers the
   * working-tree status from them: removals only means deleted. One walk, no
   * intermediate copy - this runs for every file on each poll of the git store.
   */
  function statFromHunks(hunks: GitDiffHunk[]) {
    let added = 0;
    let removed = 0;
    let total = 0;
    for (const hunk of hunks) {
      for (const line of hunk.lines) {
        total++;
        if (line.kind === 'add') added++;
        else if (line.kind === 'remove') removed++;
      }
    }
    return {
      added,
      removed,
      hasDiff: total > 0,
      status: removed > 0 && added === 0 ? 'deleted' : 'modified',
    };
  }

  /** Builds the per-file card the change lists render, with its split path and line stats. */
  function makeCard(
    filePath: string,
    hunks: GitDiffHunk[],
    status: string | null,
    truncated = false,
  ): FileCard {
    const { added, removed, hasDiff, status: inferred } = statFromHunks(hunks);
    status ??= inferred;
    return {
      file: filePath,
      basename: basename(filePath),
      dirpath: dirpath(filePath),
      hunks,
      hasDiff,
      filePath,
      status,
      added,
      removed,
      truncated,
    };
  }

  /** Synthesises a whole-file addition hunk so an untracked file renders like a diff. */
  function untrackedHunks(content: string): GitDiffHunk[] {
    if (!content) return [];
    const lines = content.replace(/\n$/, '').split('\n');
    return [{
      header: `@@ -0,0 +1,${lines.length} @@`,
      lines: lines.map(l => ({ kind: 'add' as const, content: l })),
    }];
  }

  /** An untracked file past this is listed but not diffed - its content stays on disk. */
  const UNTRACKED_MAX_BYTES = 512 * 1024;

  /**
   * Published as one value: assigning the paths and their content separately
   * makes `unstagedCards` recompute between the two awaits of the scan, and the
   * search filter downstream then settles on the slice it saw mid-scan - the
   * changes search stopped filtering anything at all.
   */
  let untracked: { paths: string[]; content: Record<string, string> } = {
    paths: [],
    content: {},
  };

  $: void loadUntrackedContent(state.status, instance?.worktreePath ?? null);

  /** Reads the text of every untracked, non-ignored, non-binary file so it can be diffed. */
  async function loadUntrackedContent(
    status: typeof state.status,
    wt: string | null,
  ): Promise<void> {
    if (!wt) {
      untracked = { paths: [], content: {} };
      return;
    }
    const all = Object.entries(status)
      .filter(([, s]) => s === 'untracked')
      .map(([p]) => p);
    const ignored = new Set(await checkIgnore(wt, all).catch(() => []));
    const visible = all.filter(p => !ignored.has(p));
    const next: Record<string, string> = {};
    const readable = visible.filter(p => !isBinaryPath(p));
    // Sized before being read: an untracked build artifact would otherwise be pulled
    // into the webview whole just to render a diff nobody asked for.
    const entries = await Promise.all(
      readable.map(async p => {
        const full = `${wt}/${p}`;
        const preview = await readFilePreview(full).catch(() => null);
        if (!preview || preview.size > UNTRACKED_MAX_BYTES) return null;
        const text = await readFile(full).catch(() => '');
        return [p, text ?? ''] as const;
      }),
    );
    for (const entry of entries) {
      if (entry) next[entry[0]] = entry[1];
    }
    untracked = { paths: visible, content: next };
  }

  $: unstagedCards = (() => {
    const cards = state.unstagedDiffs.map(f =>
      makeCard(f.filePath, f.hunks, null, f.truncated),
    );
    const seen = new Set(state.unstagedDiffs.map(f => f.filePath));
    for (const p of untracked.paths) {
      if (seen.has(p)) continue;
      cards.push(makeCard(p, untrackedHunks(untracked.content[p] ?? ''), 'untracked'));
    }
    return cards.sort((a, b) => a.basename.localeCompare(b.basename));
  })();

  $: filteredUnstagedCards = $currentProjectViewState.gitChangesSearch.trim()
    ? unstagedCards.filter(h => h.filePath.toLowerCase().includes($currentProjectViewState.gitChangesSearch.toLowerCase()))
    : unstagedCards;

  $: stagedCards = state.stagedDiffs
    .map(f => makeCard(f.filePath, f.hunks, diffStatus(f.hunks), f.truncated))
    .sort((a, b) => a.basename.localeCompare(b.basename));

  $: filteredStagedCards = $currentProjectViewState.gitStagedSearch.trim()
    ? stagedCards.filter(h => h.filePath.toLowerCase().includes($currentProjectViewState.gitStagedSearch.toLowerCase()))
    : stagedCards;

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
  let selectedCommitBody = '';
  let isLoadingCommitDiff = false;
  const commitByWorktree: Record<string, SelectedCommitInfo> = {};
  /**
   * The commit being written, per worktree. The git store holds a single
   * message for the whole app, so switching instance would otherwise carry the
   * message - generated or typed - into a worktree it has nothing to do with.
   */
  const draftByWorktree: Record<string, { title: string; body: string }> = {};

  let commitTitleEl: HTMLInputElement;
  let commitBodyEl: HTMLTextAreaElement;
  $: if (commitTitleEl && document.activeElement !== commitTitleEl && commitTitleEl.value !== state.commitMessage) {
    commitTitleEl.value = state.commitMessage;
  }
  $: if (commitBodyEl && document.activeElement !== commitBodyEl && commitBodyEl.value !== state.commitBody) {
    commitBodyEl.value = state.commitBody;
    resizeCommitBody();
  }

  /** Classifies a staged file as added, deleted or modified from the kinds of lines it carries. */
  function diffStatus(hunks: GitDiffHunk[]): string {
    const changed = hunks.flatMap(h => h.lines).filter(l => l.kind !== 'context');
    const hasAdd = changed.some(l => l.kind === 'add');
    const hasRemove = changed.some(l => l.kind === 'remove');
    if (hasAdd && !hasRemove) return 'staged-added';
    if (!hasAdd && hasRemove) return 'staged-deleted';
    return 'staged-modified';
  }

  $: commitDiffCards = selectedCommitDiff.map(f => {
    const { added, removed, hasDiff } = statFromHunks(f.hunks);
    return {
      filePath: f.filePath,
      file: f.filePath,
      basename: basename(f.filePath),
      dirpath: dirpath(f.filePath),
      hunks: f.hunks,
      hasDiff,
      status: diffStatus(f.hunks),
      added,
      removed,
    };
  });

  let commitFilesSearch = '';
  $: filteredCommitDiffCards = commitFilesSearch.trim()
    ? commitDiffCards.filter(c => c.filePath.toLowerCase().includes(commitFilesSearch.toLowerCase()))
    : commitDiffCards;

  $: totalAdded          = commitDiffCards.reduce((s, c) => s + c.added,   0);
  $: totalRemoved        = commitDiffCards.reduce((s, c) => s + c.removed, 0);
  $: totalStagedAdded   = stagedCards.reduce((s, c) => s + c.added,   0);
  $: totalStagedRemoved = stagedCards.reduce((s, c) => s + c.removed, 0);

  /** Loads the diff and the body of a commit in parallel and fills the detail pane. */
  async function fetchCommitDetail(commit: SelectedCommitInfo) {
    if (!instance?.worktreePath) return;
    const worktreePath = instance.worktreePath;
    selectedCommit = commit;
    selectedCommitDiff = [];
    selectedCommitBody = '';
    commitFilesSearch = '';
    isLoadingCommitDiff = true;
    try {
      const [diff, body] = await Promise.all([
        getDiffCommit(worktreePath, commit.hash),
        getCommitBody(worktreePath, commit.hash).catch(() => ''),
      ]);
      selectedCommitDiff = diff;
      selectedCommitBody = body;
    } catch {
      selectedCommitDiff = [];
      selectedCommitBody = '';
    } finally {
      isLoadingCommitDiff = false;
    }
  }

  /** Toggles the commit detail, remembering the selection per worktree. */
  async function selectCommit(commit: SelectedCommitInfo) {
    if (!instance?.worktreePath) return;
    if (selectedCommit?.hash === commit.hash) {
      clearSelectedCommit();
      return;
    }
    commitByWorktree[instance.worktreePath] = commit;
    await fetchCommitDetail(commit);
  }

  function clearSelectedCommit() {
    if (instance?.worktreePath) delete commitByWorktree[instance.worktreePath];
    selectedCommit = null;
    selectedCommitDiff = [];
    selectedCommitBody = '';
    isLoadingCommitDiff = false;
    revertError = null;
  }

  let errorDetailsOpen = false;
  let isRecovering = false;

  async function doRecover(action: GitErrorAction) {
    isRecovering = true;
    try {
      await recoverFromGitError(action);
    } catch {
      // The failure replaces the banner through the store; nothing to add here.
    } finally {
      isRecovering = false;
    }
  }

  let isReverting = false;
  let revertError: GitError | null = null;

  /** Reverts a commit and keeps its own error separate from the global git banner. */
  async function doRevert(hash: string) {
    isReverting = true;
    revertError = null;
    try {
      await revertCommit(hash);
      clearSelectedCommit();
    } catch (e) {
      revertError = toGitError(e);
    } finally {
      isReverting = false;
    }
  }

  let discardTarget: string | null = null;
  let discardTargetIsNew = false;
  let isDiscarding = false;

  function openDiscard(filePath: string, isNew = false) {
    discardTarget = filePath;
    discardTargetIsNew = isNew;
  }

  function closeDiscard() {
    discardTarget = null;
    discardTargetIsNew = false;
  }

  /** Discards the pending file and tells the editor so it can drop its buffer. */
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

  // --- Multi-select ---
  let selectedFilePaths = new Set<string>();
  let selectAllCb: HTMLInputElement | null = null;

  // Auto-prune: remove from selection files that no longer exist (staged/discarded)
  $: {
    const valid = new Set(unstagedCards.map(c => c.filePath));
    const pruned = [...selectedFilePaths].filter(p => valid.has(p));
    if (pruned.length !== selectedFilePaths.size) selectedFilePaths = new Set(pruned);
  }

  $: selectedCount = selectedFilePaths.size;
  $: visibleSelected = filteredUnstagedCards.filter(c => selectedFilePaths.has(c.filePath)).length;
  $: allVisibleSelected = filteredUnstagedCards.length > 0 && visibleSelected === filteredUnstagedCards.length;
  $: someVisibleSelected = visibleSelected > 0 && !allVisibleSelected;
  $: if (selectAllCb) selectAllCb.indeterminate = someVisibleSelected;

  function toggleFileSelection(filePath: string) {
    const next = new Set(selectedFilePaths);
    if (next.has(filePath)) next.delete(filePath);
    else next.add(filePath);
    selectedFilePaths = next;
  }

  /** Selects or clears only the cards the search filter currently shows. */
  function toggleSelectAll() {
    const next = new Set(selectedFilePaths);
    if (allVisibleSelected) {
      filteredUnstagedCards.forEach(c => next.delete(c.filePath));
    } else {
      filteredUnstagedCards.forEach(c => next.add(c.filePath));
    }
    selectedFilePaths = next;
  }

  async function stageSelected() {
    await stageFiles([...selectedFilePaths]);
  }

  // --- Stash selection modal ---
  let stashSelectionOpen = false;
  let stashSelectionMessage = '';
  let stashSelectionIncludeUntracked = true;
  let stashSelectionKeepIndex = false;
  let isStashingSelection = false;
  let stashSelectionMsgInput: HTMLInputElement;

  async function openStashSelection() {
    stashSelectionMessage = '';
    stashSelectionIncludeUntracked = true;
    stashSelectionKeepIndex = false;
    stashSelectionOpen = true;
    await tick();
    stashSelectionMsgInput?.focus();
  }

  function closeStashSelection() {
    stashSelectionOpen = false;
  }

  /** Stashes only the selected paths rather than the whole worktree. */
  async function handleStashSelection() {
    isStashingSelection = true;
    try {
      await pushStash(stashSelectionMessage, stashSelectionIncludeUntracked, stashSelectionKeepIndex, [...selectedFilePaths]);
      stashSelectionOpen = false;
    } finally {
      isStashingSelection = false;
    }
  }

  // --- Discard multiple ---
  let discardMultipleActive = false;
  let isDiscardingMultiple = false;

  function openDiscardMultiple() {
    discardMultipleActive = true;
  }

  function closeDiscardMultiple() {
    discardMultipleActive = false;
  }

  /** Discards every selected file and notifies the editor once per path. */
  async function handleDiscardMultiple() {
    isDiscardingMultiple = true;
    const paths = [...selectedFilePaths];
    try {
      await discardFiles(paths);
      for (const path of paths) dispatch('fileDiscarded', path);
      discardMultipleActive = false;
    } finally {
      isDiscardingMultiple = false;
    }
  }

  // --- Staged multi-select ---
  let selectedStagedFilePaths = new Set<string>();
  let selectAllStagedCb: HTMLInputElement | null = null;

  $: {
    const valid = new Set(stagedCards.map(c => c.filePath));
    const pruned = [...selectedStagedFilePaths].filter(p => valid.has(p));
    if (pruned.length !== selectedStagedFilePaths.size) selectedStagedFilePaths = new Set(pruned);
  }

  $: selectedStagedCount = selectedStagedFilePaths.size;
  $: visibleStagedSelected = filteredStagedCards.filter(c => selectedStagedFilePaths.has(c.filePath)).length;
  $: allStagedSelected = filteredStagedCards.length > 0 && visibleStagedSelected === filteredStagedCards.length;
  $: someStagedSelected = visibleStagedSelected > 0 && !allStagedSelected;
  $: if (selectAllStagedCb) selectAllStagedCb.indeterminate = someStagedSelected;

  function toggleStagedFileSelection(filePath: string) {
    const next = new Set(selectedStagedFilePaths);
    if (next.has(filePath)) next.delete(filePath);
    else next.add(filePath);
    selectedStagedFilePaths = next;
  }

  /** Selects or clears only the staged cards the search filter currently shows. */
  function toggleSelectAllStaged() {
    const next = new Set(selectedStagedFilePaths);
    if (allStagedSelected) {
      filteredStagedCards.forEach(c => next.delete(c.filePath));
    } else {
      filteredStagedCards.forEach(c => next.add(c.filePath));
    }
    selectedStagedFilePaths = next;
  }

  async function unstageSelected() {
    await unstageFiles([...selectedStagedFilePaths]);
  }

  let selectedStash: GitStash | null = null;
  let tabHeadHeight = 0;
  let stashDiffFiles: GitFileDiff[] = [];
  let isLoadingStashDiff = false;

  $: stashDiffCards = stashDiffFiles.map(f => {
    const { added, removed, hasDiff } = statFromHunks(f.hunks);
    return {
      filePath: f.filePath,
      file: f.filePath,
      basename: basename(f.filePath),
      dirpath: dirpath(f.filePath),
      hunks: f.hunks,
      hasDiff,
      status: diffStatus(f.hunks),
      added,
      removed,
    };
  });

  /** Opens a stash in the detail pane, loading its diff from the store. */
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

  /** Switches the left tab, refreshing the data that tab owns and dropping stale selections. */
  function setLeftTab(tab: 'changes' | 'log' | 'graph' | 'stash' | 'mergerebase' | 'gitignore') {
    gitLeftTab.set(tab);
    if (tab === 'changes') { clearSelectedCommit(); selectedStash = null; }
    if (tab === 'log') { refreshLog(); selectedStash = null; }
    if (tab === 'graph') { refreshGraph(); selectedStash = null; }
    if (tab === 'stash') { clearSelectedCommit(); refreshStashes(); }
    if (tab === 'gitignore') { clearSelectedCommit(); selectedStash = null; }
  }

  /** Compact age label, falling back to an absolute date past a month. */
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

  let isLoadingMoreLog = false;
  /** Pages the log in when the scroller comes within 120px of the bottom. */
  async function handleLogScroll(e: Event) {
    if (isLoadingMoreLog || !state.logHasMore) return;
    const el = e.currentTarget as HTMLElement;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) {
      isLoadingMoreLog = true;
      try {
        await loadMoreLog();
      } finally {
        isLoadingMoreLog = false;
      }
    }
  }

  const CHANGES_PAGE = 25;
  let unstagedVisible = CHANGES_PAGE;
  let stagedVisible = CHANGES_PAGE;
  let prevChangesKey = '';
  $: {
    const key = `${instance?.id ?? ''}:${$currentProjectViewState.gitChangesSearch}`;
    if (key !== prevChangesKey) {
      prevChangesKey = key;
      unstagedVisible = CHANGES_PAGE;
      stagedVisible = CHANGES_PAGE;
    }
  }

  /** Grows the rendered slice of a change list as it is scrolled near the bottom. */
  function handleChangesScroll(e: Event, which: 'unstaged' | 'staged') {
    const el = e.currentTarget as HTMLElement;
    if (el.scrollTop + el.clientHeight < el.scrollHeight - 250) return;
    if (which === 'unstaged') unstagedVisible += CHANGES_PAGE;
    else stagedVisible += CHANGES_PAGE;
  }

  $: aheadCount = state.remoteStatus?.ahead ?? 0;
  $: aheadHashes = new Set(
    state.log.filter(c => c.onCurrentBranch).slice(0, aheadCount).map(c => c.hash),
  );

  $: reconcileSelectedStash($git.stashes);
  /** Re-finds the open stash by content after a push or drop shifted every index. */
  function reconcileSelectedStash(list: GitStash[]) {
    const sel = selectedStash;
    if (!sel) return;
    const match = list.find(
      s => s.date === sel.date && s.message === sel.message && s.branch === sel.branch,
    );
    if (!match) {
      selectedStash = null;
      stashDiffFiles = [];
    } else if (match.index !== sel.index) {
      handleSelectStash(match);
    }
  }

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
  let logSearchLoaded = false;
  let graphSearchActive = false;

  onMount(() => {
    setDiffsWanted(true);
    void loadAiProviders();
    if (instance?.worktreePath) {
      lastWorktreePath = instance.worktreePath;
      refreshStatus();
    }
    return () => setDiffsWanted(false);
  });

  $: if (instance?.worktreePath && instance.worktreePath !== lastWorktreePath) {
    const prevWorktree = lastWorktreePath;
    const nextWorktree = instance.worktreePath;
    if (prevWorktree) {
      if (selectedCommit) commitByWorktree[prevWorktree] = selectedCommit;
      else delete commitByWorktree[prevWorktree];
      draftByWorktree[prevWorktree] = { title: state.commitMessage, body: state.commitBody };
    }
    lastWorktreePath = nextWorktree;
    // The git store is global, so without this the message being written for
    // one worktree would follow the user into every other one.
    const draft = draftByWorktree[nextWorktree] ?? { title: '', body: '' };
    setCommitMessage(draft.title);
    setCommitBody(draft.body);
    const restored = commitByWorktree[nextWorktree];
    if (restored) fetchCommitDetail(restored);
    else clearSelectedCommit();
    refreshStatus();
    refreshLog();
  }

  $: if ($activeStep === 'git' && instance?.worktreePath) {
    refreshStatus();
    if (!logSearchLoaded) refreshLog();
    if ($gitLeftTab === 'graph' && !graphSearchActive) refreshGraph();
  }

  $: syncLogSearchMode($currentProjectViewState.gitLogSearch);
  /** Searching needs the whole log, so entering search loads it all and leaving it pages again. */
  function syncLogSearchMode(q: string) {
    const active = q.trim().length > 0;
    if (active && !logSearchLoaded) { logSearchLoaded = true; loadAllLog(); }
    else if (!active && logSearchLoaded) { logSearchLoaded = false; refreshLog(); }
  }

  /** Same trade for the graph: search over the full history, otherwise back to the paged view. */
  function handleGraphSearchToggle(active: boolean) {
    graphSearchActive = active;
    if (active) loadAllGraph();
    else refreshGraph();
  }

  $: stagedCount = stagedCards.length;
  $: canCommit = (stagedCount > 0 || amendMode || allowEmpty) && state.commitMessage.trim().length > 0;

  /**
   * Grows the body with its content up to the CSS max-height, past which it
   * scrolls. Called on input and whenever the value changes from elsewhere -
   * a generated message, or switching worktree - since neither fires `input`.
   */
  function resizeCommitBody() {
    if (!commitBodyEl) return;
    commitBodyEl.style.height = 'auto';
    commitBodyEl.style.height = `${commitBodyEl.scrollHeight}px`;
  }

  let generating = false;
  let generateError = '';
  let generateAbort: AbortController | null = null;
  /**
   * What a screen reader is told about the generation. The animation is
   * decorative and hidden from the tree, so this is the only thing announcing
   * that the run started - and, just as important, that it finished and the
   * fields now hold something.
   */
  let aiStatusMessage = '';

  $: resolvedCommitFeature = resolveAiFeature('commitMessage', $settings.aiFeatures, $aiProviders);
  $: canGenerate = (stagedCount > 0 || amendMode) && !resolvedCommitFeature.unavailable;

  /**
   * Fills the two commit fields from what is staged. The provider is a CLI, so
   * it reads the diff itself rather than being handed one; the run is read-only
   * and belongs to no conversation, so nothing lands in the history panel.
   */
  async function generateCommitMessage() {
    if (!instance?.worktreePath || generating) return;
    const feature = resolvedCommitFeature;
    if (feature.unavailable) return;

    generating = true;
    generateError = '';
    generateAbort = new AbortController();
    aiStatusMessage = t('git.aiGenerating') as string;

    try {
      const answer = await runOneShot(
        renderCommitPrompt(feature.promptTemplate, appendTicketId ? (instance.ticket?.id ?? '') : '', instance.ticket ?? {}),
        instance.worktreePath,
        feature.providerId,
        {
          model: feature.model || undefined,
          permissionMode: readOnlyPermissionMode(feature.providerId) || undefined,
          allowedTools: readOnlyTools(feature.providerId),
          signal: generateAbort.signal,
        },
      );
      const parsed = parseCommitMessage(answer);
      // A failed generation never clobbers what the user already typed.
      if (parsed.title) {
        setCommitMessage(parsed.title);
        setCommitBody(parsed.body);
        aiStatusMessage = t('git.aiGenerated') as string;
      } else {
        generateError = t('git.aiEmpty') as string;
      }
    } catch (e) {
      if (e instanceof AiAssistError) {
        if (e.kind !== 'cancelled') generateError = aiErrorMessage(e);
      } else {
        generateError = String(e);
      }
    } finally {
      // An error is announced by its own alert, a cancel by the button coming
      // back: leaving the busy message up would outlive what it describes.
      if (aiStatusMessage !== (t('git.aiGenerated') as string)) aiStatusMessage = '';
      generating = false;
      generateAbort = null;
    }
  }

  /** Each failure the user can act on gets its own wording, never a bare "error". */
  function aiErrorMessage(e: AiAssistError): string {
    const base = t(
      e.kind === 'unavailable' ? 'git.aiUnavailable'
      : e.kind === 'notAuthenticated' ? 'git.aiNotAuthenticated'
      : 'git.aiFailed',
    ) as string;
    return e.detail ? `${base} - ${e.detail}` : base;
  }

  function cancelGenerate() {
    generateAbort?.abort();
  }

  let showOptions = false;
  let collapsedUnstaged = new Set<string>();
  let expandedStaged = new Set<string>();
  let profileDropdownOpen = false;

  function toggleUnstagedCollapse(path: string) {
    if (collapsedUnstaged.has(path)) collapsedUnstaged.delete(path);
    else collapsedUnstaged.add(path);
    collapsedUnstaged = collapsedUnstaged;
  }
  function toggleStagedCollapse(path: string) {
    if (expandedStaged.has(path)) expandedStaged.delete(path);
    else expandedStaged.add(path);
    expandedStaged = expandedStaged;
  }
  /** Collapses every unstaged card that actually has a diff to show. */
  function collapseAllUnstaged() {
    collapsedUnstaged = new Set(unstagedCards.filter(c => c.hasDiff).map(c => c.filePath));
  }
  function collapseAllStaged() {
    expandedStaged = new Set();
  }
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

  let forgeRemoteUrl = '';
  let forgeRemoteWorktree = '';
  $: if (instance?.worktreePath && instance.worktreePath !== forgeRemoteWorktree) {
    forgeRemoteWorktree = instance.worktreePath;
    forgeRemoteUrl = '';
    void getRemoteUrl().then((url) => { if (instance?.worktreePath === forgeRemoteWorktree) forgeRemoteUrl = url; });
  }
  $: openOnForgeLabel = forgeLabel($capabilities.forge, forgeRemoteUrl);

  let forgeMenu: { x: number; y: number; target: WebLinkTarget } | null = null;

  function openForgeMenu(e: MouseEvent, target: WebLinkTarget) {
    if (!openOnForgeLabel) return;
    e.preventDefault();
    const pad = 8;
    const x = Math.min(e.clientX, window.innerWidth - 240 - pad);
    const y = Math.min(e.clientY, window.innerHeight - 40 - pad);
    forgeMenu = { x, y, target };
  }

  async function openTargetOnForge(target: WebLinkTarget) {
    if (!instance) return;
    const url = await forgeLink(instance.projectId, forgeRemoteUrl, target);
    if (url) await openUrl(url);
  }

  function openOnForge() {
    const menu = forgeMenu;
    forgeMenu = null;
    if (menu) void openTargetOnForge(menu.target);
  }

  function handleWindowPointerdown(e: PointerEvent) {
    if (forgeMenu && !(e.target as Element | null)?.closest('.forge-menu')) forgeMenu = null;
    if (!profileDropdownOpen) return;
    const target = e.target as Node;
    if (!profileTriggerEl?.contains(target) && !profileDropdownEl?.contains(target)) {
      profileDropdownOpen = false;
    }
  }

  $: hasActiveOptions = noVerify || signOff || allowEmpty || amendMode || appendTicketId;

  let commitStateLoaded = false;
  let collapseStateLoaded = false;
  let prevInstanceId = '';

  $: {
    const iid = instance?.id ?? '';
    if (iid && iid !== prevInstanceId) {
      prevInstanceId = iid;
      commitStateLoaded = false;
      collapseStateLoaded = false;
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
      getGitCollapseState(instance!.projectId, iid).then((s) => {
        collapsedUnstaged = new Set(s?.collapsedUnstaged ?? []);
        expandedStaged = new Set(s?.expandedStaged ?? []);
        collapseStateLoaded = true;
      });
    }
  }

  $: if (commitStateLoaded && instance) {
    saveCommitState(instance.projectId, instance.id, {
      noVerify, signOff, allowEmpty, selectedProfileId, appendTicketId,
    });
  }

  $: if (collapseStateLoaded && instance) {
    saveGitCollapseState(instance.projectId, instance.id, {
      collapsedUnstaged: [...collapsedUnstaged],
      collapsedStaged: [],
      expandedStaged: [...expandedStaged],
    });
  }

  /** Entering amend mode splits the HEAD message back into the title and body inputs. */
  async function toggleAmend() {
    amendMode = !amendMode;
    if (amendMode) {
      const full = await getHeadCommitMessage();
      if (full) {
        const nl = full.indexOf('\n');
        if (nl === -1) {
          setCommitMessage(full);
          setCommitBody('');
        } else {
          setCommitMessage(full.slice(0, nl));
          setCommitBody(full.slice(nl + 1).replace(/^\n+/, ''));
        }
      }
    }
  }

  /** Collects the commit flags, resolving the selected git profile into an author override. */
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

  /** Joins title and body, appending the instance ticket id to the subject when asked. */
  function buildCommitMessage(): string {
    let title = state.commitMessage;
    const ticketId = instance?.ticket?.id;
    if (appendTicketId && ticketId) {
      title = `${title}, ${ticketId}`;
    }
    const body = state.commitBody.trim();
    return body ? `${title}\n\n${body}` : title;
  }

  /** Commits or amends with the assembled message and options. */
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

  /** Waits two frames so the spinner is painted before the push blocks. */
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

{#if forgeMenu && openOnForgeLabel}
  <div class="ctx-menu forge-menu" style="left:{forgeMenu.x}px;top:{forgeMenu.y}px" role="menu">
    <button role="menuitem" on:click={openOnForge}>
      <Icon name="external" size={12}/>
      {(t('integrations.openOn') as (s: string) => string)(openOnForgeLabel)}
    </button>
  </div>
{/if}

<svelte:window on:pointerdown={handleWindowPointerdown} on:keydown={(e) => {
  if (e.key === 'Escape') {
    if (forgeMenu) forgeMenu = null;
    else if (discardTarget) closeDiscard();
    else if (discardMultipleActive) closeDiscardMultiple();
    else if (stashSelectionOpen) closeStashSelection();
  }
}}/>

<div class="git-root">
{#if state.error}
  {@const described = describeGitError(state.error)}
  <div class="git-error-banner" role="alert">
    <Icon name="alert" size={13}/>
    <div class="git-error-body">
      <span class="git-error-title">{described.title}</span>
      {#if described.hint}<span class="git-error-hint">{described.hint}</span>{/if}
      <div class="git-error-tools">
        {#if described.action}
          {@const action = described.action}
          <button class="git-error-action" on:click={() => doRecover(action)} disabled={isRecovering}>
            {#if isRecovering}
              <Spinner size={10}/>
            {:else}
              {t(`git.errors.actions.${described.action}`) as string}
            {/if}
          </button>
        {/if}
        <button class="git-error-toggle" on:click={() => (errorDetailsOpen = !errorDetailsOpen)}>
          {(errorDetailsOpen ? t('git.errors.hideDetails') : t('git.errors.showDetails')) as string}
        </button>
      </div>
      {#if errorDetailsOpen}
        <pre class="git-error-raw selectable">{described.raw}</pre>
      {/if}
    </div>
    <button class="git-error-dismiss" on:click={clearGitError} aria-label={t('common.close') as string}>
      <Icon name="x" size={12}/>
    </button>
  </div>
{/if}

<GitBranchBar on:openMergeRebase={() => setLeftTab('mergerebase')} on:filesChanged={() => dispatch('filesChanged')} />

{#if state.isGitRepo}
<div class="git-layout">
  <!-- Left column: changes / log tabs -->
  <div class="git-col">
    <div class="git-col-head tab-head" bind:offsetHeight={tabHeadHeight}>
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
      <button
        class="col-tab"
        class:active={$gitLeftTab === 'mergerebase'}
        on:click={() => setLeftTab('mergerebase')}
      >
        {t('git.mergeRebaseTab')}
        {#if (state.operationState?.kind ?? 'none') !== 'none'}
          <span class="col-tab-dot" title={t('git.rebaseInProgress') as string}></span>
        {/if}
      </button>
      <button
        class="col-tab"
        class:active={$gitLeftTab === 'gitignore'}
        on:click={() => setLeftTab('gitignore')}
      >
        {t('git.gitignoreTab')}
      </button>
    </div>

    {#if $gitLeftTab === 'changes'}
      <div class="log-filter-bar">
        {#if filteredUnstagedCards.length > 0 || selectedCount > 0}
          <input
            type="checkbox"
            class="select-all-cb"
            bind:this={selectAllCb}
            checked={allVisibleSelected}
            title={t('git.stageAll') as string}
            on:change={toggleSelectAll}
          />
          {#if selectedCount > 0}
            <span class="selection-count">{selectedCount}</span>
          {/if}
        {/if}
        {#if selectedCount > 0}
          <button class="bulk-btn bulk-btn-primary" on:click={stageSelected}>{t('git.stage')}</button>
          <button class="bulk-btn" on:click={openStashSelection}>{t('git.stashTab')}</button>
          <button class="bulk-btn bulk-btn-danger" on:click={openDiscardMultiple}>{t('git.discard')}</button>
        {/if}
        {#if unstagedCards.length > 0}
          <button class="collapse-toggle-btn" title={t('git.collapseAll') as string} on:click={collapseAllUnstaged}>
            <Icon name="collapse-all" size={13}/>
          </button>
        {/if}
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
      <div class="hunks-list" on:scroll={(e) => handleChangesScroll(e, 'unstaged')}>
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
          {#each filteredUnstagedCards.slice(0, unstagedVisible) as h (h.filePath)}
            <div class="hunk-card {STATUS_CLASS[h.status] ?? ''}" class:collapsed={collapsedUnstaged.has(h.filePath)}>
              <div class="hunk-card-head" role="group" on:contextmenu={(e) => openForgeMenu(e, { type: 'file', path: h.filePath, ref: state.currentBranch })}>
                {#if h.hasDiff}
                  <button class="card-collapse-btn" title={(collapsedUnstaged.has(h.filePath) ? t('git.expandFile') : t('git.collapseFile')) as string} on:click={() => toggleUnstagedCollapse(h.filePath)}>
                    <Icon name={collapsedUnstaged.has(h.filePath) ? 'chev-r' : 'chev-d'} size={12}/>
                  </button>
                {/if}
                <input
                  type="checkbox"
                  class="file-select-cb"
                  checked={selectedFilePaths.has(h.filePath)}
                  on:change={() => toggleFileSelection(h.filePath)}
                />
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
                <button
                  class="discard-btn"
                  title={(h.status === 'untracked' ? t('git.discardNewTitle') : t('git.discardTitle')) as string}
                  on:click={() => openDiscard(h.filePath, h.status === 'untracked')}
                >
                  <Icon name="undo" size={12}/>
                </button>
                <button class="stage-btn" on:click={() => stageFile(h.filePath)}>
                  {t('git.stage')}
                </button>
              </div>
              {#if h.hasDiff}
                {#if !collapsedUnstaged.has(h.filePath)}
                  <div class="card-diff">
                    <GitDiff hunks={h.hunks} filePath={h.filePath} />
                    {#if h.truncated}
                      <div class="hunk-truncated">{t('git.diffTruncated')}</div>
                    {/if}
                  </div>
                {/if}
              {:else}
                <div class="hunk-no-preview">{t('git.noDiffPreview')}</div>
              {/if}
            </div>
          {/each}
          {#if filteredUnstagedCards.length > unstagedVisible}
            <button
              class="load-more-cards"
              on:click={() => (unstagedVisible += CHANGES_PAGE)}
            >
              {(t('git.showMoreFiles') as (n: number) => string)(
                filteredUnstagedCards.length - unstagedVisible,
              )}
            </button>
          {/if}
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
        <button class="log-refresh-btn" title={t('git.refresh') as string} on:click={() => refreshLog()}>
          <Icon name="refresh" size={13}/>
        </button>
      </div>
      <div class="log-list" on:scroll={handleLogScroll}>
        {#if state.log.length === 0}
          <div class="empty-hint">{t('git.noHistory')}</div>
        {:else if filteredLog.length === 0}
          <div class="empty-hint">{t('git.logNoResults')}</div>
        {:else}
          {#each filteredLog as commit (commit.hash)}
            <div
              class="log-entry"
              class:is-ahead={aheadHashes.has(commit.hash)}
              class:is-selected={selectedCommit?.hash === commit.hash}
              role="button"
              tabindex="0"
              on:click={() => selectCommit(commit)}
              on:keydown={(e) => e.key === 'Enter' && selectCommit(commit)}
              on:contextmenu={(e) => openForgeMenu(e, { type: 'commit', sha: commit.hash })}
            >
              <div class="log-entry-main">
                <span class="log-hash selectable">{commit.shortHash}</span>
                <span class="log-message">{commit.message}</span>
              </div>
              <div class="log-entry-meta">
                <span class="log-author">{commit.author}</span>
                <span class="log-date">{relativeTime(commit.date)}</span>
              </div>
            </div>
          {/each}
          {#if state.logHasMore && !$currentProjectViewState.gitLogSearch.trim()}
            <div class="log-loading-more">
              <Spinner size={12} trackColor="var(--bg-3)" color="var(--fg-3)"/>
            </div>
          {/if}
        {/if}
      </div>
    {:else if $gitLeftTab === 'graph'}
      <GraphView
        commits={state.graph}
        currentBranch={state.currentBranch}
        instances={projectInstances}
        selectedHash={selectedCommit?.hash ?? ''}
        hasMore={state.graphHasMore}
        on:loadMore={loadMoreGraph}
        on:searchToggle={(e) => handleGraphSearchToggle(e.detail)}
        on:switchInstance={(e) => instance && activateInstance(instance.projectId, e.detail.id)}
        on:createInstanceFromRef={(e) => dispatch('createInstanceFromRef', e.detail)}
        on:selectCommit={(e) => selectCommit(e.detail)}
        on:refresh={() => refreshGraph()}
      />
    {:else if $gitLeftTab === 'stash'}
      <StashView
        selectedStashIndex={selectedStash?.index ?? null}
        on:selectStash={(e) => handleSelectStash(e.detail)}
      />
    {:else if $gitLeftTab === 'mergerebase'}
      <MergeRebaseView
        on:openFile={(e) => dispatch('openFile', e.detail)}
        on:filesChanged={() => dispatch('filesChanged')}
      />
    {:else if $gitLeftTab === 'gitignore'}
      <GitignoreView />
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
            <span class="log-hash selectable">{selectedStash.name}</span>
            <CopyButton value={selectedStash.name}/>
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
                  <GitDiff hunks={card.hunks} filePath={card.filePath} />
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
            <span class="log-hash selectable">{selectedCommit.shortHash}</span>
            <CopyButton value={selectedCommit.hash}/>
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
            <span class="revert-sep"></span>
          {/if}
          {#if openOnForgeLabel}
            <button
              class="revert-btn"
              title={(t('integrations.openOn') as (s: string) => string)(openOnForgeLabel)}
              on:click={() => openTargetOnForge({ type: 'commit', sha: selectedCommit!.hash })}
            >
              <Icon name="external" size={11}/>
            </button>
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
        {@const describedRevert = describeGitError(revertError)}
        <div class="revert-error">
          <span>{describedRevert.title}</span>
          {#if describedRevert.hint}<span class="revert-error-hint">{describedRevert.hint}</span>{/if}
          <pre class="revert-error-raw selectable">{describedRevert.raw}</pre>
        </div>
      {/if}
      {#if selectedCommitBody}
        <div class="commit-body-detail">{selectedCommitBody}</div>
      {/if}
      {#if !isLoadingCommitDiff && commitDiffCards.length > 0}
        <div class="commit-files-search-row">
          <div class="log-search">
            <Icon name="search" size={11}/>
            <input
              class="log-search-input"
              bind:value={commitFilesSearch}
              placeholder={t('git.commitFilesSearchPlaceholder') as string}
            />
            {#if commitFilesSearch}
              <button class="log-search-clear" on:click={() => commitFilesSearch = ''}>
                <Icon name="x" size={10}/>
              </button>
            {/if}
          </div>
        </div>
      {/if}
      <div class="hunks-list">
        {#if isLoadingCommitDiff}
          <div class="empty-hint">
            <Spinner size={16} trackColor="var(--bg-3)" color="var(--fg-3)"/>
          </div>
        {:else if commitDiffCards.length === 0}
          <div class="empty-hint">{t('git.commitDiffEmpty')}</div>
        {:else if filteredCommitDiffCards.length === 0}
          <div class="empty-hint">{t('git.commitFilesNoResults')}</div>
        {:else}
          {#each filteredCommitDiffCards as card (card.filePath)}
            <div class="hunk-card {STATUS_CLASS[card.status] ?? ''}">
              <div class="hunk-card-head" role="group" on:contextmenu={(e) => selectedCommit && openForgeMenu(e, { type: 'file', path: card.filePath, ref: selectedCommit.hash })}>
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
                  <GitDiff hunks={card.hunks} filePath={card.filePath} />
                </div>
              {:else}
                <div class="hunk-no-preview">{t('git.noDiffPreview')}</div>
              {/if}
            </div>
          {/each}
        {/if}
      </div>
    {:else}
      <div class="git-col-head" style="height: {tabHeadHeight}px; padding-top: 0; padding-bottom: 0; box-sizing: border-box;">
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
      {#if stagedCards.length > 0}
        <div class="log-filter-bar">
          <input
            type="checkbox"
            class="select-all-cb"
            bind:this={selectAllStagedCb}
            checked={allStagedSelected}
            on:change={toggleSelectAllStaged}
          />
          {#if selectedStagedCount > 0}
            <span class="selection-count">{selectedStagedCount}</span>
            <button class="bulk-btn" on:click={unstageSelected}>{t('git.unstage')}</button>
          {/if}
          <button class="collapse-toggle-btn" title={t('git.collapseAll') as string} on:click={collapseAllStaged}>
            <Icon name="collapse-all" size={13}/>
          </button>
          <div class="log-search">
            <Icon name="search" size={11}/>
            <input
              class="log-search-input"
              value={$currentProjectViewState.gitStagedSearch}
              on:input={(e) => updateProjectViewState({ gitStagedSearch: e.currentTarget.value })}
              placeholder={t('git.changesSearchPlaceholder') as string}
            />
            {#if $currentProjectViewState.gitStagedSearch}
              <button class="log-search-clear" on:click={() => updateProjectViewState({ gitStagedSearch: '' })}>×</button>
            {/if}
          </div>
        </div>
      {/if}
      <div class="hunks-list" on:scroll={(e) => handleChangesScroll(e, 'staged')}>
        {#if stagedCards.length === 0}
          <div class="empty-hint">
            {t('git.noStagedChanges')}
          </div>
        {:else if filteredStagedCards.length === 0}
          <div class="empty-hint">{t('git.changesNoResults')}</div>
        {:else}
          {#each filteredStagedCards.slice(0, stagedVisible) as h (h.filePath)}
            <div class="hunk-card {STATUS_CLASS[h.status] ?? ''}" class:collapsed={!expandedStaged.has(h.filePath)}>
              <div class="hunk-card-head" role="group" on:contextmenu={(e) => openForgeMenu(e, { type: 'file', path: h.filePath, ref: state.currentBranch })}>
                {#if h.hasDiff}
                  <button class="card-collapse-btn" title={(expandedStaged.has(h.filePath) ? t('git.collapseFile') : t('git.expandFile')) as string} on:click={() => toggleStagedCollapse(h.filePath)}>
                    <Icon name={expandedStaged.has(h.filePath) ? 'chev-d' : 'chev-r'} size={12}/>
                  </button>
                {/if}
                <input
                  type="checkbox"
                  class="file-select-cb"
                  checked={selectedStagedFilePaths.has(h.filePath)}
                  on:change={() => toggleStagedFileSelection(h.filePath)}
                />
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
                {#if expandedStaged.has(h.filePath)}
                  <div class="card-diff">
                    <GitDiff hunks={h.hunks} filePath={h.filePath} />
                    {#if h.truncated}
                      <div class="hunk-truncated">{t('git.diffTruncated')}</div>
                    {/if}
                  </div>
                {/if}
              {:else}
                <div class="hunk-no-preview">{t('git.noDiffPreview')}</div>
              {/if}
            </div>
          {/each}
          {#if filteredStagedCards.length > stagedVisible}
            <button
              class="load-more-cards"
              on:click={() => (stagedVisible += CHANGES_PAGE)}
            >
              {(t('git.showMoreFiles') as (n: number) => string)(
                filteredStagedCards.length - stagedVisible,
              )}
            </button>
          {/if}
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
        {#if generating}
          <button
            class="ai-suggest ai-btn is-busy"
            title={t('git.aiCancel') as string}
            aria-label={t('git.aiCancel') as string}
            on:click={cancelGenerate}
          >
            <Icon name="sparkles" size={11}/> {t('git.aiCancel')}
          </button>
        {:else}
          <button
            class="ai-suggest ai-btn"
            disabled={!canGenerate}
            title={resolvedCommitFeature.unavailable
              ? (t('home.features.noProvider') as string)
              : (t('git.generateWithAi') as string)}
            on:click={generateCommitMessage}
          >
            <Icon name="sparkles" size={11}/> {t('git.generateWithAi')}
          </button>
        {/if}
      </div>
      <!--
        One live region for the pair: a reader is told once that generation
        started and once that it landed, instead of twice for two fields, and
        the fields themselves stay ordinary labelled controls.
      -->
      <span class="sr-only" role="status" aria-live="polite">{aiStatusMessage}</span>
      <div class="ai-field" class:is-generating={generating}>
        <input
          class="commit-title"
          type="text"
          bind:this={commitTitleEl}
          aria-label={t('git.commitMessage') as string}
          placeholder={generating ? '' : (t('git.commitPlaceholder') as string)}
          disabled={generating}
          aria-busy={generating}
          on:input={(e) => setCommitMessage((e.target as HTMLInputElement).value)}
        />
        {#if generating}
          <span class="ai-sweep" aria-hidden="true"></span>
          {#if !state.commitMessage}
            <span class="ai-ghost" aria-hidden="true"><i style="width: 62%"></i></span>
          {/if}
        {/if}
      </div>
      <div class="ai-field ai-field-body" class:is-generating={generating}>
        <textarea
          class="commit-msg"
          bind:this={commitBodyEl}
          aria-label={t('git.commitBodyLabel') as string}
          placeholder={generating ? '' : (t('git.commitBodyPlaceholder') as string)}
          disabled={generating}
          aria-busy={generating}
          on:input={(e) => { setCommitBody((e.target as HTMLTextAreaElement).value); resizeCommitBody(); }}
        ></textarea>
        {#if generating}
          <span class="ai-sweep" aria-hidden="true"></span>
          {#if !state.commitBody}
            <span class="ai-ghost" aria-hidden="true"><i style="width: 88%"></i><i style="width: 74%"></i><i style="width: 46%"></i></span>
          {/if}
        {/if}
      </div>
      {#if generateError}
        <div class="ai-error" role="alert">
          <Icon name="alert" size={12}/>
          <span class="selectable">{generateError}</span>
          <button class="ai-error-close" on:click={() => (generateError = '')} aria-label={t('git.aiDismiss') as string}>
            <Icon name="x" size={11}/>
          </button>
        </div>
      {/if}
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
{:else}
  <div class="git-nonrepo">
    <div class="git-nonrepo-icon"><Icon name="git" size={44}/></div>
    <h3 class="git-nonrepo-title">{t('git.notARepoTitle')}</h3>
    <p class="git-nonrepo-text">{t('git.notARepoBody')}</p>
  </div>
{/if}
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
        <p class="confirm-body">
          {(t(discardTargetIsNew ? 'git.discardNewConfirm' : 'git.discardConfirm') as (f: string) => string)(discardTarget)}
        </p>
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

{#if discardMultipleActive}
  <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
  <div
    class="modal-backdrop"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    on:click={closeDiscardMultiple}
    on:keydown={(e) => e.key === 'Escape' && closeDiscardMultiple()}
  >
    <div class="modal confirm-modal" on:click|stopPropagation role="presentation">
      <div class="modal-head">
        <div>
          <div class="step-count">GIT</div>
          <h3>{t('git.discardChanges')}</h3>
        </div>
        <button class="icon-btn close" on:click={closeDiscardMultiple}>
          <Icon name="x" size={16}/>
        </button>
      </div>
      <div class="modal-body">
        <p class="confirm-body">{(t('git.discardMultipleConfirm') as (n: number) => string)(selectedCount)}</p>
      </div>
      <div class="modal-foot">
        <div class="spacer"></div>
        <button class="btn ghost" on:click={closeDiscardMultiple}>{t('common.cancel')}</button>
        <button class="btn danger" disabled={isDiscardingMultiple} on:click={handleDiscardMultiple}>
          {#if isDiscardingMultiple}<Spinner size={12} trackColor="oklch(1 0 0 / .3)" color="var(--danger)"/>{/if}
          <Icon name="undo" size={13}/>
          {t('git.discard')}
        </button>
      </div>
    </div>
  </div>
{/if}

{#if stashSelectionOpen}
  <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
  <div
    class="modal-backdrop"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    on:click={closeStashSelection}
    on:keydown={(e) => e.key === 'Escape' && closeStashSelection()}
  >
    <div class="modal stash-sel-modal" on:click|stopPropagation role="presentation">
      <div class="modal-head">
        <div>
          <div class="step-count">GIT</div>
          <h3>{t('git.stashSelectedTitle')}</h3>
        </div>
        <button class="icon-btn close" on:click={closeStashSelection}>
          <Icon name="x" size={16}/>
        </button>
      </div>
      <div class="modal-body">
        <div class="stash-field">
          <label class="stash-field-label" for="stash-sel-msg">{t('git.stashMessageLabel')}</label>
          <input
            id="stash-sel-msg"
            class="stash-modal-input"
            bind:this={stashSelectionMsgInput}
            bind:value={stashSelectionMessage}
            placeholder={t('git.stashMessagePlaceholder') as string}
            on:keydown={(e) => e.key === 'Enter' && !isStashingSelection && handleStashSelection()}
          />
        </div>
        <div class="stash-options">
          <label class="stash-option">
            <div class="stash-option-text">
              <span class="stash-option-label">{t('git.stashIncludeUntracked')}</span>
              <span class="stash-option-desc">{t('git.stashIncludeUntrackedDesc')}</span>
            </div>
            <label class="settings-toggle">
              <input type="checkbox" bind:checked={stashSelectionIncludeUntracked}/>
              <span class="settings-toggle-track"><span class="settings-toggle-thumb"></span></span>
            </label>
          </label>
          <label class="stash-option">
            <div class="stash-option-text">
              <span class="stash-option-label">{t('git.stashKeepIndex')}</span>
              <span class="stash-option-desc">{t('git.stashKeepIndexDesc')}</span>
            </div>
            <label class="settings-toggle">
              <input type="checkbox" bind:checked={stashSelectionKeepIndex}/>
              <span class="settings-toggle-track"><span class="settings-toggle-thumb"></span></span>
            </label>
          </label>
        </div>
      </div>
      <div class="modal-foot">
        <div class="spacer"></div>
        <button class="btn ghost" on:click={closeStashSelection}>{t('common.cancel')}</button>
        <button class="btn primary" disabled={isStashingSelection} on:click={handleStashSelection}>
          {#if isStashingSelection}<Spinner size={12} trackColor="oklch(1 0 0 / .3)" color="white"/>{/if}
          {t('git.stashPush')}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .git-root {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .git-layout {
    flex: 1;
    display: flex;
    min-height: 0;
    overflow: hidden;
  }

  .git-nonrepo {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    width: 100%;
    height: 100%;
    padding: 24px;
    text-align: center;
  }
  .git-nonrepo-icon {
    color: var(--fg-4);
    opacity: 0.6;
  }
  .git-nonrepo-title {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: var(--fg-1);
  }
  .git-nonrepo-text {
    margin: 0;
    max-width: 380px;
    font-size: 13px;
    line-height: 1.5;
    color: var(--fg-3);
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
    line-height: 1;
    color: var(--fg-2);
    flex-shrink: 0;
  }

  .collapse-toggle-btn {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    background: none;
    border: none;
    border-radius: var(--r-sm);
    color: var(--fg-3);
    cursor: pointer;
    transition: background .12s, color .12s;
  }
  .collapse-toggle-btn:hover { background: var(--bg-4); color: var(--fg-0); }

  .card-collapse-btn {
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    padding: 0;
    flex-shrink: 0;
    background: none;
    border: none;
    border-radius: var(--r-xs);
    color: var(--fg-3);
    cursor: pointer;
    transition: color .12s;
  }
  .card-collapse-btn:hover { color: var(--fg-0); }

  .tab-head {
    padding: 0;
    gap: 0;
  }

  .col-tab {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 10px 14px;
    margin: 0;
    background: none;
    border: none;
    color: var(--fg-3);
    font-size: 12px;
    line-height: 1;
    font-family: var(--font-ui);
    cursor: pointer;
    transition: color .1s;
    white-space: nowrap;
  }
  .col-tab:hover { color: var(--fg-1); }
  .col-tab.active {
    color: var(--fg-0);
    box-shadow: inset 0 -2px 0 0 var(--accent);
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

  .col-tab-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--danger);
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

  .commit-files-search-row {
    display: flex;
    padding: 6px 10px;
    border-bottom: 1px solid var(--stroke-0);
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

  .log-refresh-btn {
    flex-shrink: 0;
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border: 1px solid var(--stroke-0);
    border-radius: 4px;
    background: var(--bg-0);
    color: var(--fg-3);
    cursor: pointer;
    transition: color .12s, border-color .12s, background .12s;
  }
  .log-refresh-btn:hover { color: var(--fg-0); border-color: var(--stroke-1); background: var(--bg-1); }

  .log-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  .log-loading-more {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 12px;
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

  .load-more-cards {
    width: 100%;
    padding: 8px;
    border: 1px dashed var(--stroke-0);
    border-radius: 6px;
    background: transparent;
    color: var(--fg-3);
    font-size: 12px;
    cursor: pointer;
  }
  .load-more-cards:hover {
    background: var(--bg-2);
    color: var(--fg-1);
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

  .hunk-truncated {
    padding: 8px 12px;
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
  .ai-suggest.is-busy:hover {
    transform: none;
  }
  .ai-suggest:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .ai-error {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
    padding: 6px 8px;
    border: 1px solid var(--stroke-0);
    border-radius: 4px;
    color: var(--danger);
    font-size: 11px;
    line-height: 1.4;
  }
  .ai-error span {
    flex: 1;
    min-width: 0;
  }
  .ai-error-close {
    display: flex;
    align-items: center;
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    padding: 0;
  }

  .commit-title {
    width: 100%;
    background: var(--bg-0);
    border: 1px solid var(--stroke-0);
    border-radius: 4px;
    color: var(--fg-0);
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.5;
    padding: 8px;
    outline: none;
    box-sizing: border-box;
    display: block;
  }
  .commit-title:focus { border-color: var(--accent); }
  .commit-title::placeholder { color: var(--fg-4); }

  /** Announced, never shown: the animation itself is hidden from the tree. */
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
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
    /* Height follows the content, so the user never drags it themselves. */
    resize: none;
    min-height: 52px;
    max-height: 220px;
    overflow-y: auto;
    outline: none;
    box-sizing: border-box;
    display: block;
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

  .revert-sep {
    width: 1px;
    align-self: stretch;
    margin: 2px 2px;
    background: var(--stroke-1);
    flex-shrink: 0;
  }

  .commit-body-detail {
    padding: 8px 14px;
    font-size: 12px;
    line-height: 1.6;
    color: var(--fg-2);
    white-space: pre-wrap;
    word-break: break-word;
    border-bottom: 1px solid var(--stroke-0);
    flex-shrink: 0;
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
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 14px;
    font-size: 11px;
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 10%, transparent);
    border-bottom: 1px solid color-mix(in srgb, var(--danger) 20%, transparent);
    flex-shrink: 0;
  }

  .revert-error-hint {
    opacity: 0.85;
  }

  .revert-error-raw {
    margin: 0;
    max-height: 120px;
    overflow: auto;
    font-family: var(--font-mono);
    white-space: pre-wrap;
    word-break: break-word;
    opacity: 0.9;
  }

  .git-error-banner {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 8px 14px;
    font-size: 11px;
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 10%, transparent);
    border-bottom: 1px solid color-mix(in srgb, var(--danger) 20%, transparent);
    font-family: var(--font-mono);
    flex-shrink: 0;
  }

  .git-error-body {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .git-error-title {
    font-family: var(--font-sans);
    font-weight: 600;
    word-break: break-word;
  }

  .git-error-hint {
    font-family: var(--font-sans);
    opacity: 0.85;
    word-break: break-word;
  }

  .git-error-tools {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .git-error-action,
  .git-error-toggle {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px;
    font-family: var(--font-sans);
    font-size: 11px;
    color: var(--danger);
    background: transparent;
    border: 1px solid color-mix(in srgb, var(--danger) 35%, transparent);
    border-radius: 4px;
    cursor: pointer;
  }

  .git-error-action:hover:not(:disabled),
  .git-error-toggle:hover {
    background: color-mix(in srgb, var(--danger) 12%, transparent);
  }

  .git-error-action:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .git-error-toggle {
    border-color: transparent;
    opacity: 0.8;
  }

  .git-error-raw {
    margin: 0;
    max-height: 160px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
    opacity: 0.9;
  }

  .git-error-dismiss {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 2px;
    color: var(--danger);
    background: transparent;
    border: none;
    cursor: pointer;
    opacity: 0.7;
    transition: opacity 0.1s;
  }

  .git-error-dismiss:hover {
    opacity: 1;
  }

  .meta-sep {
    font-size: 11px;
    color: var(--fg-2);
  }

  .diff-file-count {
    font-size: 11px;
    color: var(--fg-4);
  }

  /* Multi-select checkboxes */
  .select-all-cb,
  .file-select-cb {
    -webkit-appearance: none;
    appearance: none;
    flex-shrink: 0;
    width: 13px;
    height: 13px;
    border: 1.5px solid var(--stroke-2);
    border-radius: 3px;
    background: var(--bg-2);
    cursor: pointer;
    position: relative;
    transition: background .12s, border-color .12s;
  }
  .select-all-cb:hover,
  .file-select-cb:hover {
    border-color: var(--accent);
  }
  .select-all-cb:checked,
  .file-select-cb:checked,
  .select-all-cb:indeterminate {
    background: var(--accent);
    border-color: var(--accent);
  }
  .select-all-cb:checked::after,
  .file-select-cb:checked::after {
    content: '';
    position: absolute;
    left: 2px;
    top: 0px;
    width: 5px;
    height: 8px;
    border-right: 1.5px solid white;
    border-bottom: 1.5px solid white;
    transform: rotate(45deg) translateY(-1px);
  }
  .select-all-cb:indeterminate::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 50%;
    width: 7px;
    height: 1.5px;
    background: white;
    border-radius: 1px;
    transform: translate(-50%, -50%);
  }

  .selection-count {
    font-size: 10px;
    font-weight: 600;
    color: var(--accent);
    background: var(--accent-weak);
    border-radius: 6px;
    padding: 1px 5px;
    line-height: 1.4;
    flex-shrink: 0;
  }

  .bulk-btn {
    display: flex;
    align-items: center;
    padding: 3px 8px;
    border-radius: 3px;
    font-size: 11px;
    font-family: var(--font-ui);
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
    background: var(--bg-3);
    border: 1px solid var(--stroke-0);
    color: var(--fg-2);
    transition: background .1s, border-color .1s, color .1s;
  }
  .bulk-btn:hover {
    background: var(--bg-4);
    border-color: var(--stroke-1);
    color: var(--fg-0);
  }
  .bulk-btn-danger:hover {
    background: var(--danger-weak);
    border-color: transparent;
    color: var(--danger);
  }
  .bulk-btn-primary {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }
  .bulk-btn-primary:hover {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
    filter: brightness(1.08);
  }

  /* Stash selection modal */
  .stash-sel-modal { width: min(420px, 92vw); }

  .stash-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 20px;
  }
  .stash-field-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--fg-2);
  }
  .stash-modal-input {
    background: var(--bg-0);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-sm);
    color: var(--fg-0);
    font-family: var(--font-ui);
    font-size: 13px;
    padding: 8px 10px;
    outline: none;
    transition: border-color .12s;
    width: 100%;
    box-sizing: border-box;
  }
  .stash-modal-input:focus { border-color: var(--accent); }
  .stash-modal-input::placeholder { color: var(--fg-4); }

  .stash-options {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .stash-option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 0;
    border-top: 1px solid var(--stroke-0);
    cursor: pointer;
    gap: 12px;
  }
  .stash-option-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .stash-option-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--fg-1);
  }
  .stash-option-desc {
    font-size: 11px;
    color: var(--fg-3);
  }

  .forge-menu {
    position: fixed;
    z-index: 9999;
    min-width: 200px;
    padding: 4px;
    background: var(--bg-2);
    border: 1px solid var(--stroke-1);
    border-radius: 8px;
    box-shadow: 0 8px 32px oklch(0 0 0 / 0.4), 0 2px 8px oklch(0 0 0 / 0.2);
    font-size: 12.5px;
    color: var(--fg-1);
  }
  .forge-menu button {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 5px 10px;
    background: none;
    border: none;
    border-radius: 4px;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .forge-menu button:hover { background: var(--bg-4); color: var(--fg-0); }
</style>
