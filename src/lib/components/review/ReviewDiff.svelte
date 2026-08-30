<script lang="ts">
  /**
   * The raw diff of the branch: file list, the selected file in the diff editor,
   * and the discussions of the merge request in the same gutter. It is the
   * secondary mode of the Review step - the guide is the way in - and the whole
   * step when no guide has been generated.
   */
  import { createEventDispatcher, onDestroy } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import { t, type TranslationKey } from '$lib/i18n';
  import { langFromPath } from '$lib/services/file-service';
  import {
    getDiffFileBetween,
    getDiffFilesBetween,
    toGitError,
    type GitChangedFile,
    type GitFileBetween,
  } from '$lib/services/git-service';
  import type { Discussion } from '$lib/types/integrations';
  import type { GuideRemark, ReviewComment, ReviewHunk } from '$lib/types/review';
  import type { EditorLanguage } from '$lib/utils/editor/editor-theme';
  import { basename, parentPathOf } from '$lib/utils/files/files-tree';
  import { anchorLabel } from '$lib/utils/review/review-guide';
  import { describeGitError } from '$lib/utils/git/git-error';
  import { fileMtimes } from '$lib/services/file-service';
  import { SKELETON_DELAY_MS } from '$lib/utils/timing';
  import {
    diffMarkersFor,
    discussionsForFile,
    normalizeAnchorPath,
    guideMarkersFor,
    openDiscussionCount,
  } from '$lib/utils/review/diff-markers';
  import DiffEditor from './DiffEditor.svelte';
  import ReviewDiscussion from './ReviewDiscussion.svelte';

  export let worktreePath = '';
  export let base = '';
  export let head = '';
  /** Blocks every read while the head commit is not in the worktree yet. */
  export let isHeadMissing = false;
  export let hasMergeRequest = false;
  export let discussions: Discussion[] = [];
  export let selectedDiscussionId = '';
  export let areDiscussionsLoaded = true;
  export let replyingIds: Set<string> = new Set();
  export let resolvingIds: Set<string> = new Set();
  export let renderMarkdown: (markdown: string) => string;
  /** The guide's remarks, shown in the gutter beside the discussions. */
  export let remarks: GuideRemark[] = [];
  export let comments: ReviewComment[] = [];
  export let hunks: ReviewHunk[] = [];
  export let seenHunks: string[] = [];
  /** Reload counter: bumping it re-reads the file list and the current file. */
  export let refreshToken = 0;
  /**
   * The discussion panel is collapsible so the reviewer can give the diff the
   * full width when reading, and bring the threads back when answering them.
   */
  export let isDiscussionsOpen = true;
  /** The file to reopen on, remembered from the last visit. */
  export let initialPath = '';

  /**
   * Ragged line widths for the loading diff. Fixed rather than random so the
   * placeholder does not reshuffle on every render.
   */
  const SKELETON_ROWS = [
    68, 42, 88, 55, 74, 33, 61, 80, 47, 92, 58, 71, 39, 84, 63, 50, 77, 44, 86, 66,
    52, 79, 41, 90, 60, 73, 36, 82,
  ];

  /** Which threads the panel lists; the counts always report the whole set. */
  type DiscussionFilter = 'all' | 'open' | 'resolved' | 'activity';
  const FILTERS: DiscussionFilter[] = ['all', 'open', 'resolved', 'activity'];

  /** The filter as it was left; an empty or unknown value falls back to all. */
  export let initialFilter = '';

  let discussionFilter: DiscussionFilter = 'all';
  /**
   * The stored filter arrives once the state is read, which is after the first
   * render and again on every instance switch. Keying the restore on the value
   * and the worktree together picks it up whenever either moves, without
   * fighting a choice the reviewer makes afterwards.
   */
  let filterRestoredFor = '\u0000';
  $: {
    const key = `${worktreePath}|${initialFilter}`;
    if (filterRestoredFor !== key) {
      filterRestoredFor = key;
      discussionFilter = FILTERS.includes(initialFilter as DiscussionFilter)
        ? (initialFilter as DiscussionFilter)
        : 'all';
    }
  }

  function pickFilter(f: DiscussionFilter) {
    discussionFilter = f;
    dispatch('filterChange', { filter: f });
  }
  $: filterCount = (f: DiscussionFilter) =>
    f === 'all'
      ? discussions.length
      : f === 'open'
        ? unresolvedCount
        : f === 'resolved'
          ? resolvedCount
          : activityCount;

  const dispatch = createEventDispatcher<{
    error: { message: string };
    loading: { isLoading: boolean };
    selectDiscussion: { id: string };
    reply: { discussion: Discussion; body: string };
    resolve: { discussion: Discussion; resolved: boolean };
    commentLine: { path: string; side: 'old' | 'new'; line: number };
    addComment: { path: string; side: 'old' | 'new'; line: number; startLine?: number; body: string };
    deleteComment: { id: string };
    editComment: { id: string; body: string };
    openRemark: { remarkId: string };
    openFile: string;
    discussionsToggle: { isOpen: boolean };
    selectPath: { path: string };
    filterChange: { filter: string };
  }>();

  let files: GitChangedFile[] = [];
  let areFilesLoading = false;
  let filesLoadedFor = '';
  let selectedPath = '';

  $: filesKey = `${worktreePath}|${base}|${head}|${isHeadMissing}|${refreshToken}`;
  $: if (worktreePath && base && !isHeadMissing && filesLoadedFor !== filesKey) {
    filesLoadedFor = filesKey;
    void loadFiles(worktreePath, base, head);
  }

  async function loadFiles(path: string, from: string, to: string) {
    areFilesLoading = true;
    dispatch('loading', { isLoading: true });
    dispatch('error', { message: '' });
    const key = filesKey;
    try {
      const next = await getDiffFilesBetween(path, from, to);
      if (key !== filesKey) return;
      files = next;
      if (!files.some(f => f.filePath === selectedPath)) {
        // The file left open last time wins, as long as the branch still
        // changes it; otherwise the first of the listing stands in.
        const remembered = files.some(f => f.filePath === initialPath) ? initialPath : '';
        selectedPath = remembered || files[0]?.filePath || '';
      }
    } catch (err) {
      if (key !== filesKey) return;
      files = [];
      dispatch('error', { message: describeGitError(toGitError(err)).title });
    } finally {
      if (key === filesKey) {
        areFilesLoading = false;
        dispatch('loading', { isLoading: false });
      }
    }
  }

  let fileContent: GitFileBetween | null = null;
  let isFileLoading = false;
  let fileLoadedFor = '';
  /**
   * The component survives an instance switch, so the file being read has to be
   * dropped when the worktree changes. Left alone it would leak across
   * instances whenever both diffs happen to touch the same path, and would then
   * be saved onto the instance the reviewer just arrived at.
   */
  let scopedTo = '';
  $: if (worktreePath !== scopedTo) {
    scopedTo = worktreePath;
    selectedPath = '';
    reportedPath = '';
  }

  // Only a deliberate change is remembered; the restore itself must not
  // overwrite the very value it just read.
  let reportedPath = '';
  $: if (selectedPath && selectedPath !== reportedPath) {
    reportedPath = selectedPath;
    if (selectedPath !== initialPath) dispatch('selectPath', { path: selectedPath });
  }

  $: fileKey = `${filesKey}|${selectedPath}`;
  $: if (worktreePath && selectedPath && !isHeadMissing && fileLoadedFor !== fileKey) {
    fileLoadedFor = fileKey;
    void loadFile(worktreePath, base, head, selectedPath, fileKey);
  }

  /**
   * A read that returns quickly - a cached file, a small one - would otherwise
   * flash the placeholder for a frame or two. The skeleton is armed on a timer
   * and only shows if the read is still running when it fires.
   */
  let showFileSkeleton = false;
  let skeletonTimer: ReturnType<typeof setTimeout> | undefined;

  function armSkeleton() {
    clearTimeout(skeletonTimer);
    skeletonTimer = setTimeout(() => {
      if (isFileLoading) showFileSkeleton = true;
    }, SKELETON_DELAY_MS);
  }

  function disarmSkeleton() {
    clearTimeout(skeletonTimer);
    skeletonTimer = undefined;
    showFileSkeleton = false;
  }

  onDestroy(disarmSkeleton);

  async function loadFile(path: string, from: string, to: string, filePath: string, key: string) {
    isFileLoading = true;
    armSkeleton();
    try {
      const next = await getDiffFileBetween(path, from, to, filePath);
      if (key !== fileKey) return;
      fileContent = next;
    } catch (err) {
      fileContent = null;
      dispatch('error', { message: describeGitError(toGitError(err)).title });
    } finally {
      if (key === fileKey) {
        isFileLoading = false;
        disarmSkeleton();
      }
    }
  }

  /** Jumps to the file and line of a discussion or a remark. */
  /**
   * A jump asked for before the target file is on screen: the content arrives
   * from an async read, so the line is remembered and applied once the editor
   * holds that file. Applying it straight away would land on the previous
   * file's document and then be undone when the new one replaces it.
   */
  let pendingJump: { path: string; line: number; side: 'old' | 'new' } | null = null;

  export function goTo(path: string, line: number, side: 'old' | 'new') {
    if (path !== selectedPath) {
      if (!files.some(f => f.filePath === path)) return;
      pendingJump = { path, line, side };
      selectedPath = path;
      return;
    }
    requestAnimationFrame(() => diffEditor?.scrollToLine(line, side));
  }

  // Fires once the awaited file is the one loaded, so the jump lands on it.
  $: if (pendingJump && !isFileLoading && fileContent && selectedPath === pendingJump.path) {
    const { line, side } = pendingJump;
    pendingJump = null;
    requestAnimationFrame(() => diffEditor?.scrollToLine(line, side));
  }

  let diffEditor: DiffEditor | null = null;

  $: selectedFile = files.find(f => f.filePath === selectedPath) ?? null;
  $: language = (selectedPath ? langFromPath(selectedPath) : 'text') as EditorLanguage;
  /**
   * The filter applies once, at the source, so the three groups below - this
   * file, elsewhere, general - all honour it without repeating the rule.
   */
  $: shownDiscussions = discussions.filter(d => {
    if (discussionFilter === 'all') return true;
    if (discussionFilter === 'activity') return !isConversation(d);
    if (!isConversation(d)) return false;
    return discussionFilter === 'open' ? !d.resolved : d.resolved;
  });

  $: anchoredDiscussions = selectedPath ? discussionsForFile(shownDiscussions, selectedPath) : [];
  /**
   * Every thread on this file, whatever the filter: the label above the diff
   * describes the file, so it must not change with the lens the panel is set to.
   */
  $: fileDiscussionCount = selectedPath
    ? discussionsForFile(discussions, selectedPath).length
    : 0;
  $: generalDiscussions = shownDiscussions.filter(d => d.anchor === null);
  /** Anchored somewhere other than the file on screen; selecting one goes there. */
  $: elsewhereDiscussions = shownDiscussions.filter(
    d => d.anchor !== null && !anchoredDiscussions.includes(d),
  );
  /** Unresolved threads across the whole merge request, for the panel badge. */
  /**
   * The forge reports its own record - a label changed, a pipeline ran - as a
   * discussion that can never be resolved. Counting those as open would show a
   * reviewer work that does not exist and never reaches zero, so they are
   * counted and filtered on their own.
   */
  $: conversations = discussions.filter(isConversation);
  $: unresolvedCount = conversations.filter(d => !d.resolved).length;
  $: resolvedCount = conversations.length - unresolvedCount;
  $: activityCount = discussions.length - conversations.length;
  $: discussionMarkers = selectedPath ? diffMarkersFor(discussions, selectedPath) : [];

  /**
   * The gutter carries three things at once: the merge request's discussions,
   * the guide's remarks coloured by kind, and the reviewer's own pending
   * comments. A discussion always wins the line it is on.
   */
  $: markers = [
    ...discussionMarkers,
    ...guideMarkersFor(remarks, comments, selectedPath, discussionMarkers),
  ];

  /**
   * What the guide already marked as read, per file. Nothing in this view sets
   * it: the reading is driven from the guide, and the diff only reflects it as
   * a tick on a file whose hunks are all covered.
   */
  $: seenSet = new Set(seenHunks);
  function seenCountOf(path: string): { seen: number; total: number } {
    const own = hunks.filter(h => h.path === path);
    return { seen: own.filter(h => seenSet.has(h.hunkHash)).length, total: own.length };
  }

  /**
   * Whether the selected file is still on disk. A deleted file has nothing to
   * open, and a branch reviewed from another worktree may not carry it either,
   * so the answer comes from the filesystem rather than from the diff alone.
   */
  let existsOnDisk = false;
  let existenceCheckedFor = '';
  $: if (selectedPath && worktreePath) {
    const key = `${worktreePath}|${selectedPath}`;
    if (existenceCheckedFor !== key) {
      existenceCheckedFor = key;
      existsOnDisk = false;
      void checkExists(key, `${worktreePath}/${selectedPath}`);
    }
  } else {
    existsOnDisk = false;
  }

  async function checkExists(key: string, absolute: string) {
    try {
      const found = await fileMtimes([absolute]);
      if (existenceCheckedFor !== key) return;
      existsOnDisk = Object.keys(found ?? {}).length > 0;
    } catch {
      if (existenceCheckedFor === key) existsOnDisk = false;
    }
  }

  /**
   * A thread someone can answer, as opposed to the forge's own activity log.
   * `resolvable` is what the forges use to tell the two apart: a system note -
   * a label change, a pipeline result - is never resolvable.
   */
  function isConversation(d: Discussion): boolean {
    return d.resolvable || d.comments.some(c => !c.isSystem);
  }

  function badgeClass(status: GitChangedFile['status']): string {
    if (status === 'A') return 'add';
    if (status === 'D') return 'del';
    return 'mod';
  }

  function onMarkerClick(e: CustomEvent<{ line: number; side: 'old' | 'new' }>) {
    const remark = remarks.find(
      r => r.path === selectedPath && r.line === e.detail.line && r.side === e.detail.side && r.status !== 'dismissed',
    );
    if (remark) {
      dispatch('openRemark', { remarkId: remark.id });
      return;
    }
    const comment = comments.find(c => c.path === selectedPath && c.line === e.detail.line && c.side === e.detail.side);
    if (comment) {
      selectedCommentId = comment.id;
      requestAnimationFrame(() =>
        document.getElementById(`diff-comment-${comment.id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
      );
      return;
    }
    const hit = anchoredDiscussions.find(d => d.anchor?.line === e.detail.line && d.anchor?.side === e.detail.side);
    if (hit) {
      dispatch('selectDiscussion', { id: hit.id });
      document.getElementById(`review-discussion-${hit.id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return;
    }
    dispatch('commentLine', { path: selectedPath, side: e.detail.side, line: e.detail.line });
  }

  let commentLine: { path: string; side: 'old' | 'new'; line: number; startLine?: number } | null = null;
  let commentDraft = '';
  let editingId = '';
  let selectedCommentId = '';

  function onLineSelect(e: CustomEvent<{ side: 'old' | 'new'; from: number; to: number }>) {
    commentLine = {
      path: selectedPath,
      side: e.detail.side,
      line: e.detail.to,
      startLine: e.detail.from < e.detail.to ? e.detail.from : undefined,
    };
    if (!isDiscussionsOpen) dispatch('discussionsToggle', { isOpen: true });
    requestAnimationFrame(() => {
      const box = document.getElementById('diff-composer');
      box?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      box?.querySelector('textarea')?.focus();
    });
  }

  function cancelComment() {
    commentLine = null;
    commentDraft = '';
    diffEditor?.clearLineSelection();
  }

  function saveComment() {
    if (!commentLine || commentDraft.trim() === '') return;
    dispatch('addComment', { ...commentLine, body: commentDraft.trim() });
    cancelComment();
  }

  function jumpTo(discussion: Discussion) {
    if (!discussion.anchor) return;
    goTo(normalizeAnchorPath(discussion.anchor.path), discussion.anchor.line, discussion.anchor.side);
    dispatch('selectDiscussion', { id: discussion.id });
  }
</script>

<div class="review-layout">
  <aside class="files-list">
    <div class="files-section-title">{(t('review.changedFiles') as (n: number) => string)(files.length)}</div>
    {#if areFilesLoading && files.length === 0}
      <div class="files-skeleton"><Skeleton lines={6} height={12} gap={10}/></div>
    {:else if files.length === 0}
      <div class="empty-note">{base ? (t('review.noChanges') as (b: string) => string)(base) : ''}</div>
    {:else}
      {#each files as f (f.filePath)}
        {@const openCount = hasMergeRequest ? openDiscussionCount(discussions, f.filePath) : 0}
        {@const read = seenCountOf(f.filePath)}
        <div
          class="file-item {f.filePath === selectedPath ? 'active' : ''}"
          on:click={() => selectedPath = f.filePath}
          role="button"
          tabindex="0"
          on:keydown={(e) => e.key === 'Enter' && (selectedPath = f.filePath)}
          title={f.filePath}
        >
          <span class="badge {badgeClass(f.status)}">{f.status}</span>
          <span class="fname">{f.filePath}</span>
          {#if read.total > 0 && read.seen === read.total}
            <Icon name="check" size={11} style="color: var(--success); flex-shrink: 0"/>
          {/if}
          {#if openCount > 0}
            <span class="disc-count" title={(t('review.openDiscussions') as (n: number) => string)(openCount)}>{openCount}</span>
          {/if}
          <span class="dim mono stat-mini">
            <span class="plus">+{f.additions}</span>
            {#if f.deletions > 0}
              <span class="minus"> -{f.deletions}</span>
            {/if}
          </span>
        </div>
      {/each}
    {/if}
  </aside>

  <div class="diff-pane">
    {#if selectedFile}
      <div class="diff-filebar">
        <Icon name="file" size={14} style="color: var(--fg-2)"/>
        <div class="fp selectable">
          {#if parentPathOf(selectedFile.filePath)}<span class="dir">{parentPathOf(selectedFile.filePath)}/</span>{/if}<b>{basename(selectedFile.filePath)}</b>
        </div>
        <div class="stat">
          <span class="plus">+{selectedFile.additions}</span>
          {#if selectedFile.deletions > 0}
            <span class="minus"> -{selectedFile.deletions}</span>
          {/if}
        </div>
        {#if hasMergeRequest && fileDiscussionCount > 0}
          <span class="dim anchored-count">{(t('review.anchoredDiscussions') as (n: number) => string)(fileDiscussionCount)}</span>
        {/if}
        <button
          class="open-file-btn"
          disabled={!existsOnDisk}
          title={existsOnDisk
            ? (t('review.openFile') as string)
            : (t('review.openFileGone') as string)}
          on:click={() => dispatch('openFile', selectedPath)}
        >
          <Icon name="external" size={11}/>
          {t('review.openFile')}
        </button>
      </div>

      <div class="diff-editor-wrap">
        {#if isFileLoading && !fileContent && showFileSkeleton}
          <!--
            Shaped like the diff it becomes - two panes with their gutters,
            filling the height - so the editor does not appear to jump in from a
            single narrow column of lines.
          -->
          <div class="diff-skeleton" aria-hidden="true">
            {#each ['old', 'new'] as side (side)}
              <div class="dsk-pane">
                {#each SKELETON_ROWS as w, i (i)}
                  <div class="dsk-row" style="animation-delay: {i * 40}ms">
                    <span class="dsk-gutter"></span>
                    <span class="dsk-code" style="width: {w}%"></span>
                  </div>
                {/each}
              </div>
            {/each}
          </div>
        {:else if fileContent && (fileContent.oldContent !== null || fileContent.newContent !== null)}
          {#key fileKey}
            <DiffEditor
              bind:this={diffEditor}
              oldContent={fileContent.oldContent ?? ''}
              newContent={fileContent.newContent ?? ''}
              {language}
              {markers}
              on:markerClick={onMarkerClick}
              on:lineSelect={onLineSelect}
            />
          {/key}
        {:else if isFileLoading}
          <!-- Below the skeleton's threshold: hold the pane blank rather than
               claim the file has nothing to show. -->
          <div class="diff-quiet"></div>
        {:else}
          <div class="empty-note">{t('review.noContent')}</div>
        {/if}
      </div>

    {:else if !areFilesLoading}
      <div class="empty-note center">{files.length === 0 ? '' : t('review.selectFile')}</div>
    {/if}
  </div>

  {#if hasMergeRequest}
    {#if isDiscussionsOpen}
      <aside class="disc-panel">
        <div class="disc-head">
          <span class="disc-title">{t('review.discussions')}</span>
          {#if unresolvedCount > 0}<span class="disc-count">{unresolvedCount}</span>{/if}
          <span class="spacer"></span>
          <button
            class="disc-toggle"
            title={t('review.hideDiscussions') as string}
            aria-label={t('review.hideDiscussions') as string}
            on:click={() => dispatch('discussionsToggle', { isOpen: false })}
          >
            <Icon name="x" size={13}/>
          </button>
        </div>

        {#if commentLine}
          <div class="composer" id="diff-composer">
            <div class="dim mono small">{anchorLabel({ ...commentLine, path: basename(commentLine.path) })}</div>
            <textarea class="selectable" bind:value={commentDraft} placeholder={t('review.commentPlaceholder') as string} rows="4"></textarea>
            <div class="composer-actions">
              <span class="spacer"></span>
              <button class="btn ghost tiny" on:click={cancelComment}>{t('review.cancel')}</button>
              <button class="btn primary tiny" on:click={saveComment} disabled={commentDraft.trim() === ''}>{t('review.save')}</button>
            </div>
          </div>
        {/if}

        {#if comments.length > 0}
          <div class="disc-head">
            <span class="disc-title">{t('review.pendingComments')}</span>
            <span class="disc-count">{comments.length}</span>
          </div>
          <div class="pending-list">
            {#each comments as comment (comment.id)}
              <div
                class="comment"
                id="diff-comment-{comment.id}"
                class:selected={selectedCommentId === comment.id}
                class:published={!!comment.publishedAs}
                role="button"
                tabindex="0"
                on:click={() => goTo(comment.path, comment.line, comment.side)}
                on:keydown={(e) => e.key === 'Enter' && goTo(comment.path, comment.line, comment.side)}
              >
                <div class="composer-actions">
                  <span class="dim mono small">{anchorLabel({ ...comment, path: basename(comment.path) })}</span>
                  <span class="spacer"></span>
                  {#if !comment.publishedAs}
                    <button class="btn ghost tiny" on:click|stopPropagation={() => (editingId = editingId === comment.id ? '' : comment.id)}>{t('review.edit')}</button>
                    <button class="btn ghost tiny" on:click|stopPropagation={() => dispatch('deleteComment', { id: comment.id })}>{t('review.delete')}</button>
                  {/if}
                </div>
                {#if editingId === comment.id}
                  <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
                  <textarea
                    class="selectable"
                    rows="4"
                    value={comment.body}
                    on:click|stopPropagation
                    on:input={(e) => dispatch('editComment', { id: comment.id, body: e.currentTarget.value })}
                  ></textarea>
                {:else}
                  <p class="comment-body selectable">{comment.body}</p>
                {/if}
              </div>
            {/each}
          </div>
        {/if}

        <div class="disc-filters" role="tablist">
          {#each FILTERS as f (f)}
            <button
              class="disc-filter"
              class:active={discussionFilter === f}
              role="tab"
              aria-selected={discussionFilter === f}
              on:click={() => pickFilter(f)}
            >
              {t(`review.filter.${f}` as TranslationKey)}
              <span class="disc-filter-count">{filterCount(f)}</span>
            </button>
          {/each}
        </div>

        {#if !areDiscussionsLoaded}
          <div class="files-skeleton"><Skeleton lines={4} height={12} gap={10}/></div>
        {:else if discussions.length === 0}
          <div class="empty-note">{t('review.noDiscussions')}</div>
        {:else if shownDiscussions.length === 0}
          <div class="empty-note">
            {discussionFilter === 'open'
              ? t('review.noOpenDiscussions')
              : discussionFilter === 'resolved'
                ? t('review.noResolvedDiscussions')
                : t('review.noActivity')}
          </div>
        {:else}
          <div class="disc-list">
            <!-- An anchored thread is about a line: picking the card goes
                 there, not only its line tag. -->
            {#each anchoredDiscussions as d (d.id)}
              <div id={`review-discussion-${d.id}`}>
                <ReviewDiscussion
                  discussion={d}
                  {renderMarkdown}
                  isSelected={d.id === selectedDiscussionId}
                  isReplying={replyingIds.has(d.id)}
                  isResolving={resolvingIds.has(d.id)}
                  on:select={() => jumpTo(d)}
                  on:jump={() => jumpTo(d)}
                  on:reply={(e) => dispatch('reply', { discussion: d, body: e.detail.body })}
                  on:resolve={(e) => dispatch('resolve', { discussion: d, resolved: e.detail.resolved })}
                />
              </div>
            {/each}

            <!--
              A thread anchored in another file is still the reviewer's to
              answer, so it stays listed; picking it moves the diff onto its
              file rather than hiding it until that file is opened.
            -->
            {#each elsewhereDiscussions as d (d.id)}
              <div id={`review-discussion-${d.id}`} class="disc-elsewhere">
                <button
                  class="disc-where"
                  title={d.anchor ? normalizeAnchorPath(d.anchor.path) : ''}
                  on:click={() => jumpTo(d)}
                >
                  <Icon name="file" size={10}/>
                  <span>{d.anchor ? basename(normalizeAnchorPath(d.anchor.path)) : ''}</span>
                </button>
                <ReviewDiscussion
                  discussion={d}
                  {renderMarkdown}
                  isSelected={d.id === selectedDiscussionId}
                  isReplying={replyingIds.has(d.id)}
                  isResolving={resolvingIds.has(d.id)}
                  on:select={() => jumpTo(d)}
                  on:jump={() => jumpTo(d)}
                  on:reply={(e) => dispatch('reply', { discussion: d, body: e.detail.body })}
                  on:resolve={(e) => dispatch('resolve', { discussion: d, resolved: e.detail.resolved })}
                />
              </div>
            {/each}

            {#each generalDiscussions as d (d.id)}
              <ReviewDiscussion
                discussion={d}
                {renderMarkdown}
                isSelected={d.id === selectedDiscussionId}
                isReplying={replyingIds.has(d.id)}
                isResolving={resolvingIds.has(d.id)}
                on:select={() => dispatch('selectDiscussion', { id: d.id })}
                on:reply={(e) => dispatch('reply', { discussion: d, body: e.detail.body })}
                on:resolve={(e) => dispatch('resolve', { discussion: d, resolved: e.detail.resolved })}
              />
            {/each}
          </div>
        {/if}
      </aside>
    {:else}
      <button
        class="disc-rail"
        title={t('review.showDiscussions') as string}
        aria-label={t('review.showDiscussions') as string}
        on:click={() => dispatch('discussionsToggle', { isOpen: true })}
      >
        <Icon name="review" size={13}/>
        {#if unresolvedCount > 0}<span class="disc-count">{unresolvedCount}</span>{/if}
      </button>
    {/if}
  {/if}
</div>

<style>
  .review-layout {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .files-list {
    width: 240px;
    flex-shrink: 0;
    border-right: 1px solid var(--stroke-0);
    overflow-y: auto;
    padding-top: 8px;
  }

  .files-section-title {
    padding: 4px 16px;
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--fg-3);
  }

  .files-skeleton { padding: 8px 16px; }
  .diff-quiet { position: absolute; inset: 0; }
  .diff-skeleton {
    position: absolute;
    inset: 0;
    display: flex;
    gap: 1px;
    overflow: hidden;
    background: var(--stroke-0);
  }
  .dsk-pane {
    flex: 1 1 0%;
    min-width: 0;
    padding: 6px 0;
    background: var(--bg-0);
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .dsk-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 10px;
    animation: dsk-pulse 1.6s ease-in-out infinite;
  }
  .dsk-gutter {
    width: 16px;
    height: 9px;
    flex-shrink: 0;
    border-radius: 2px;
    background: var(--bg-3);
  }
  .dsk-code {
    height: 9px;
    border-radius: 2px;
    background: var(--bg-3);
  }
  @keyframes dsk-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.45; }
  }
  @media (prefers-reduced-motion: reduce) {
    .dsk-row { animation: none; }
  }
  .empty-note { padding: 8px 16px; font-size: 11.5px; color: var(--fg-3); }
  .empty-note.center { display: flex; align-items: center; justify-content: center; flex: 1; }
  .dim { color: var(--fg-3); }
  .plus { color: var(--success); }
  .minus { color: var(--danger); }

  /* Full-bleed rows: the selection spans the whole list rather than sitting as
     an inset pill, so the eye follows one straight edge down the column. */
  .file-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 12px;
    cursor: pointer;
    font-size: 12px;
    color: var(--fg-1);
  }
  .file-item:hover { background: var(--bg-3); }
  .file-item.active { background: var(--bg-4); color: var(--fg-0); }

  .badge {
    font-size: 10px;
    font-weight: 700;
    width: 14px;
    height: 14px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 3px;
    flex-shrink: 0;
  }
  .badge.add { background: oklch(0.78 0.14 135 / 0.18); color: oklch(0.78 0.14 135); }
  .badge.mod { background: oklch(0.82 0.14 60 / 0.18); color: oklch(0.82 0.14 60); }
  .badge.del { background: oklch(0.70 0.18 15 / 0.18); color: oklch(0.70 0.18 15); }

  .fname {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: 11.5px;
    direction: rtl;
    text-align: left;
  }
  .disc-count {
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 8px;
    background: var(--accent);
    color: var(--bg-0);
    font-size: 10px;
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .stat-mini { font-size: 10px; flex-shrink: 0; }

  .diff-pane {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 0;
  }

  .diff-filebar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 12px;
    height: 36px;
    flex-shrink: 0;
    border-bottom: 1px solid var(--stroke-0);
    font-size: 12.5px;
    color: var(--fg-2);
  }
  .fp { flex: 1; font-family: var(--font-mono); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dir { color: var(--fg-3); }
  .stat { display: flex; gap: 4px; font-size: 11.5px; font-family: var(--font-mono); }
  .anchored-count { font-size: 11px; margin-left: 8px; }

  .open-file-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    padding: 2px 7px;
    border: 1px solid var(--stroke-0);
    border-radius: 4px;
    background: transparent;
    color: var(--fg-2);
    font-size: 11px;
    cursor: pointer;
  }
  .open-file-btn:hover:not(:disabled) { background: var(--bg-3); color: var(--fg-0); }
  .open-file-btn:disabled { opacity: 0.45; cursor: default; }

  .diff-editor-wrap {
    flex: 1;
    position: relative;
    overflow: hidden;
    min-height: 120px;
  }

  .disc-panel {
    width: 320px;
    flex-shrink: 0;
    border-left: 1px solid var(--stroke-0);
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--bg-0);
  }
  .composer {
    margin: 4px 10px;
    padding: 8px;
    border: 1px solid var(--stroke-0);
    border-radius: 5px;
    background: var(--bg-1);
  }
  .composer .small, .comment .small { font-size: 11px; }
  .pending-list { max-height: 40%; overflow-y: auto; flex-shrink: 0; }
  .comment {
    margin: 4px 10px;
    padding: 8px;
    border: 1px solid var(--stroke-0);
    border-radius: 5px;
    background: var(--bg-1);
    cursor: pointer;
  }
  .comment:hover { border-color: var(--stroke-1); }
  .comment.selected { border-color: var(--accent); }
  .comment.published { opacity: 0.6; }
  .comment-body { margin: 4px 0 0; font-size: 12px; line-height: 1.5; color: var(--fg-1); white-space: pre-wrap; }
  .composer textarea, .comment textarea {
    width: 100%;
    margin: 6px 0;
    padding: 6px;
    font-family: inherit;
    font-size: 12px;
    line-height: 1.5;
    color: var(--fg-0);
    background: var(--bg-0);
    border: 1px solid var(--stroke-0);
    border-radius: 4px;
    outline: none;
    resize: vertical;
  }
  .composer textarea:focus, .comment textarea:focus { border-color: var(--accent); }
  .composer-actions { display: flex; align-items: center; gap: 4px; }
  .disc-head {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 36px;
    padding: 0 8px 0 14px;
    flex-shrink: 0;
    border-bottom: 1px solid var(--stroke-0);
  }
  .disc-title {
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--fg-3);
  }
  .disc-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--fg-3);
    cursor: pointer;
  }
  .disc-toggle:hover { background: var(--bg-3); color: var(--fg-1); }
  .disc-filters {
    display: flex;
    gap: 2px;
    padding: 6px 10px;
    flex-shrink: 0;
    border-bottom: 1px solid var(--stroke-0);
  }
  .disc-filter {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--fg-3);
    font-size: 11px;
    cursor: pointer;
  }
  .disc-filter:hover { background: var(--bg-3); color: var(--fg-1); }
  .disc-filter.active { background: var(--bg-4); color: var(--fg-0); }
  .disc-filter-count {
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    opacity: 0.7;
  }

  .disc-list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px 12px;
  }

  /* A thread on another file is dimmed until its file is the one on screen. */
  .disc-elsewhere { opacity: 0.72; }
  .disc-elsewhere:hover { opacity: 1; }
  .disc-where {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 3px;
    padding: 1px 6px;
    border: 0;
    border-radius: 3px;
    background: var(--bg-3);
    color: var(--fg-3);
    font-family: var(--font-mono);
    font-size: 10px;
    cursor: pointer;
    max-width: 100%;
  }
  .disc-where:hover { color: var(--fg-0); }
  .disc-where span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Collapsed, the panel leaves a rail wide enough to say a thread is waiting. */
  .disc-rail {
    width: 32px;
    flex-shrink: 0;
    border: 0;
    border-left: 1px solid var(--stroke-0);
    background: transparent;
    color: var(--fg-3);
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding-top: 10px;
  }
  .disc-rail:hover { background: var(--bg-2); color: var(--fg-1); }
  .spacer { flex: 1; }
</style>
