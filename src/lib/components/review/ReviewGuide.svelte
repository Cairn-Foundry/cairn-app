<script lang="ts">
  /**
   * The guide: the way into the branch. Left, the table of contents and the
   * progress; centre, the current extract in the diff editor with the remark
   * anchored on it; right, the comments waiting to be sent. The reviewer reads
   * chapter by chapter rather than file by file.
   */
  import { createEventDispatcher } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import { t, type TranslationKey } from '$lib/i18n';
  import { langFromPath } from '$lib/services/file-service';
  import { getDiffFileBetween, type GitFileBetween } from '$lib/services/git-service';
  import {
    addComment,
    cancelGuide,
    deleteComment,
    dismissRemark,
    cancelCommentDraft,
    draftCommentFor,
    editComment,
    generateGuide,
    guideGenerating,
    markChapterSeen,
    reviewErrors,
    setCurrentPosition,
    type ReviewScope,
  } from '$lib/stores/review';
  import { settings } from '$lib/stores/settings';
  import { activeShortcuts, bindingToLabels } from '$lib/stores/shortcuts';
  import type {
    GuideChapter,
    GuideRemark,
    ReviewComment,
    ReviewHunk,
    ReviewState,
  } from '$lib/types/review';
  import type { EditorLanguage } from '$lib/utils/editor/editor-theme';
  import { basename } from '$lib/utils/files/files-tree';
  import { excerptAround, guideMarkersFor } from '$lib/utils/review/diff-markers';
  import { renderRemoteMarkdown } from '$lib/utils/integrations/markdown';
  import { anchorLabel, guideProgress, isGuideStale } from '$lib/utils/review/review-guide';
  import { resolveAiFeature } from '$lib/utils/home/ai-features';
  import { isAssistCliInstalled } from '$lib/stores/cli-providers';
  import DiffEditor from './DiffEditor.svelte';
  import RegenerateGuideModal from './RegenerateGuideModal.svelte';
  import ReviewSummary from './ReviewSummary.svelte';

  export let scope: ReviewScope;
  export let base = '';
  export let head = '';
  export let state: ReviewState;
  export let hunks: ReviewHunk[] = [];
  export let mrTitle = '';
  export let mrDescription = '';
  export let ticket: { key: string; title: string } | null = null;
  export let hasMergeRequest = false;

  const dispatch = createEventDispatcher<{
    openInDiff: { path: string; line: number; side: 'old' | 'new' };
  }>();

  $: scopeKey = `${scope.projectId}:${scope.instanceId}`;
  $: generatingRunId = $guideGenerating[scopeKey] ?? '';
  $: isGenerating = generatingRunId !== '';
  $: error = $reviewErrors[scopeKey] ?? '';
  $: guide = state.guide;
  $: chapters = guide?.chapters ?? [];
  $: progress = guideProgress(state, hunks);
  $: isStale = isGuideStale(guide, head);

  /**
   * The guide opens on its overview rather than dropping the reader into the
   * first extract: the branch has to be explained before its code means
   * anything. `currentChapterId` is empty until a chapter is picked, so it is
   * also the record of whether the reading has started - no extra state.
   */
  $: isAtOverview = state.currentChapterId === '';

  function startReading() {
    const first = chapters[0];
    if (first) setCurrentPosition(scope, first.id, 0);
  }

  function backToOverview() {
    setCurrentPosition(scope, '', 0);
  }

  /** Totals for the opening page, so the reader knows the size of the job. */
  $: totalRemarks = chapters.reduce((n, c) => n + c.remarks.length, 0);
  $: openRemarks = chapters.reduce(
    (n, c) => n + c.remarks.filter(r => r.status === 'open').length,
    0,
  );

  /**
   * The model is asked for markdown and writes it: paths and symbols come back
   * in backticks, lists as lists. Rendered through the same sanitiser the forge
   * discussions use, since both are text this app did not write.
   */
  const md = renderRemoteMarkdown;

  /** A tooltip carrying the action and the keys that trigger it. */
  function hintTitle(key: string, shortcut: string): string {
    const keys = keysOf(shortcut);
    const label = t(key as TranslationKey) as string;
    return keys ? `${label}  ${keys}` : label;
  }

  /** The shortcut of an action, as the keys to press; empty when unbound. */
  function keysOf(id: string): string {
    return bindingToLabels($activeShortcuts[id as keyof typeof $activeShortcuts] ?? null).join('');
  }

  /** Which kinds of remark the reading pane lists. */
  const REMARK_KINDS = ['issue', 'question', 'refactor', 'note'] as const;
  let remarkKind: 'all' | (typeof REMARK_KINDS)[number] = 'all';

  $: currentChapter =
    chapters.find(c => c.id === state.currentChapterId) ?? chapters[0] ?? null;
  $: excerptIndex = Math.min(
    state.currentExcerptIndex,
    Math.max(0, (currentChapter?.excerpts.length ?? 1) - 1),
  );
  $: currentExcerpt = currentChapter?.excerpts[excerptIndex] ?? null;

  /** The remarks that fall inside the extract on screen. */
  $: excerptRemarks = (currentChapter?.remarks ?? []).filter(
    r => currentExcerpt
      && r.path === currentExcerpt.path
      && r.line >= currentExcerpt.from
      && r.line <= currentExcerpt.to,
  );
  $: currentRemarks = excerptRemarks.filter(
    r => remarkKind === 'all' || r.kind === remarkKind,
  );
  /** Counts describe the extract, not the filtered view. */
  $: kindCount = (k: 'all' | (typeof REMARK_KINDS)[number]) =>
    k === 'all'
      ? excerptRemarks.length
      : excerptRemarks.filter(r => r.kind === k).length;

  $: guideFeature = resolveAiFeature('reviewGuide', $settings.aiFeatures, $isAssistCliInstalled);
  $: commentFeature = resolveAiFeature('reviewComment', $settings.aiFeatures, $isAssistCliInstalled);

  let confirmingRegenerate = false;

  /**
   * Regenerating throws the current guide away, so it is asked for rather than
   * taken. The first generation has nothing to lose and goes straight through.
   */
  function askRegenerate() {
    confirmingRegenerate = true;
  }

  async function confirmRegenerate() {
    confirmingRegenerate = false;
    await generate({ resetProgress: true });
  }

  async function generate({ resetProgress = false } = {}) {
    await generateGuide(scope, {
      resetProgress,
      base,
      head,
      baseSha: base,
      headSha: head,
      mrTitle,
      mrDescription,
      ticket,
      assignments: $settings.aiFeatures,
      provider: guideFeature.providerId,
      model: guideFeature.model || undefined,
    });
  }

  function selectChapter(chapter: GuideChapter) {
    setCurrentPosition(scope, chapter.id, 0);
  }

  function step(delta: number) {
    if (!currentChapter) return;
    const next = excerptIndex + delta;
    if (next >= 0 && next < currentChapter.excerpts.length) {
      setCurrentPosition(scope, currentChapter.id, next);
      return;
    }
    // Running off the end of a chapter carries on into the next one, so the
    // whole guide reads with a single key.
    const position = chapters.indexOf(currentChapter);
    const target = chapters[position + (delta > 0 ? 1 : -1)];
    // Running off the top of the first chapter goes back to the overview, the
    // same way running off the end walks into the next chapter.
    if (!target) {
      if (delta < 0 && position === 0) backToOverview();
      return;
    }
    setCurrentPosition(scope, target.id, delta > 0 ? 0 : Math.max(0, target.excerpts.length - 1));
  }

  function stepChapter(delta: number) {
    if (!currentChapter) return;
    const target = chapters[chapters.indexOf(currentChapter) + delta];
    if (target) setCurrentPosition(scope, target.id, 0);
  }

  function toggleSeen() {
    if (!currentChapter) return;
    const isSeen = !currentChapter.isSeen;
    markChapterSeen(scope, currentChapter.id, isSeen);
    // Marking carries the reader on; unmarking must not throw them forward.
    if (isSeen) stepChapter(1);
  }

  /** Every action the review shortcuts can reach; the palette calls the same. */
  export function executeAction(id: string): boolean {
    // On the opening page there is no chapter under the reader yet: a
    // navigation key enters the reading rather than acting on a chapter they
    // cannot see.
    if (isAtOverview) {
      if (id === 'reviewNextExcerpt' || id === 'reviewNextChapter') {
        startReading();
        return true;
      }
      // Everything else acts on a chapter or a remark that is not on screen.
      return true;
    }
    switch (id) {
      case 'reviewNextExcerpt': step(1); return true;
      case 'reviewPrevExcerpt': step(-1); return true;
      case 'reviewNextChapter': stepChapter(1); return true;
      case 'reviewPrevChapter': stepChapter(-1); return true;
      case 'reviewMarkSeen': toggleSeen(); return true;
      case 'reviewComment':
        if (currentRemarks[0]) startComment(currentRemarks[0]);
        return true;
      case 'reviewDismiss':
        if (currentRemarks[0]) dismissRemark(scope, currentRemarks[0].id);
        return true;
      default: return false;
    }
  }

  let fileContent: GitFileBetween | null = null;
  let isFileLoading = false;
  let fileLoadedFor = '';
  $: fileKey = currentExcerpt ? `${scope.worktreePath}|${base}|${head}|${currentExcerpt.path}` : '';
  $: if (fileKey && fileLoadedFor !== fileKey) {
    fileLoadedFor = fileKey;
    void loadFile(fileKey, currentExcerpt!.path);
  }

  async function loadFile(key: string, path: string) {
    isFileLoading = true;
    try {
      const next = await getDiffFileBetween(scope.worktreePath, base, head, path);
      if (key !== fileKey) return;
      fileContent = next;
    } catch {
      if (key === fileKey) fileContent = null;
    } finally {
      if (key === fileKey) isFileLoading = false;
    }
  }

  let diffEditor: DiffEditor | null = null;
  $: language = (currentExcerpt ? langFromPath(currentExcerpt.path) : 'text') as EditorLanguage;
  // Every remark of the extract is marked in the gutter, including one the kind
  // filter is hiding: the filter narrows the list, not the code.
  $: markers = currentExcerpt
    ? guideMarkersFor(excerptRemarks, state.comments, currentExcerpt.path, [])
    : [];

  // Every change of extract scrolls the editor onto it rather than leaving the
  // reviewer at the top of a file they have to find their way down.
  let scrolledTo = '';
  $: if (currentExcerpt && fileContent && !isFileLoading) {
    const key = `${fileKey}|${currentExcerpt.from}`;
    if (scrolledTo !== key) {
      scrolledTo = key;
      const { from, side } = currentExcerpt;
      requestAnimationFrame(() => diffEditor?.scrollToLine(from, side));
    }
  }

  let commentDraft = '';
  let commentFor: GuideRemark | null = null;
  let commentLine: { path: string; side: 'old' | 'new'; line: number; startLine?: number } | null = null;
  let isDrafting = false;
  let editingId = '';

  function sourceFor(side: 'old' | 'new'): string {
    return (side === 'old' ? fileContent?.oldContent : fileContent?.newContent) ?? '';
  }

  function startComment(remark: GuideRemark) {
    commentFor = remark;
    commentLine = { path: remark.path, side: remark.side, line: remark.line };
    commentDraft = '';
    focusedRemarkId = remark.id;
    // The composer opens at the top of a column the reader may have scrolled
    // away from, so it is brought to them rather than left to be found.
    revealComposer();
  }

  /** Scrolls the pending-comment column onto the open composer and focuses it. */
  function revealComposer() {
    requestAnimationFrame(() => {
      const box = document.getElementById('guide-composer');
      box?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      box?.querySelector('textarea')?.focus();
    });
  }

  /**
   * A comment is about a line: picking its card points the diff at that line,
   * and brings forward the remark it came from when it had one.
   */
  function goToComment(comment: ReviewComment) {
    const remark = comment.remarkId
      ? (currentChapter?.remarks ?? []).find(r => r.id === comment.remarkId)
      : undefined;
    if (remark) focusedRemarkId = remark.id;
    if (comment.path === currentExcerpt?.path) {
      requestAnimationFrame(() => diffEditor?.scrollToLine(comment.line, comment.side));
      return;
    }
    // The guide can show the line itself when a chapter covers it; only a
    // comment outside the guide's extracts needs the raw diff.
    for (const chapter of chapters) {
      const index = chapter.excerpts.findIndex(
        e => e.path === comment.path && comment.line >= e.from && comment.line <= e.to,
      );
      if (index !== -1) {
        setCurrentPosition(scope, chapter.id, index);
        requestAnimationFrame(() => diffEditor?.scrollToLine(comment.line, comment.side));
        return;
      }
    }
    dispatch('openInDiff', { path: comment.path, line: comment.line, side: comment.side });
  }

  let selectedCommentId = '';

  /** Brings the card of the comment sitting on that line forward. */
  function selectCommentAt(path: string, line: number, side: 'old' | 'new'): boolean {
    const hit = state.comments.find(c => c.path === path && c.line === line && c.side === side);
    if (!hit) return false;
    selectedCommentId = hit.id;
    requestAnimationFrame(() =>
      document.getElementById(`guide-comment-${hit.id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
    );
    return true;
  }

  async function draft() {
    if (!commentFor || isDrafting) return;
    isDrafting = true;
    try {
      commentDraft = await draftCommentFor(
        scope,
        commentFor,
        excerptAround(sourceFor(commentFor.side), commentFor.line),
        {
          assignments: $settings.aiFeatures,
          provider: commentFeature.providerId,
          model: commentFeature.model || undefined,
        },
      );
    } catch {
      // A failed draft leaves the box as it was: the reviewer writes it.
    } finally {
      isDrafting = false;
    }
  }

  function saveComment() {
    if (!commentLine || commentDraft.trim() === '') return;
    addComment(scope, { ...commentLine, body: commentDraft.trim(), remarkId: commentFor?.id });
    diffEditor?.clearLineSelection();
    cancelComment();
  }

  function cancelComment() {
    commentFor = null;
    commentLine = null;
    commentDraft = '';
    diffEditor?.clearLineSelection();
  }

  function onLineSelect(e: CustomEvent<{ side: 'old' | 'new'; from: number; to: number }>) {
    if (!currentExcerpt) return;
    commentFor = null;
    commentLine = {
      path: currentExcerpt.path,
      side: e.detail.side,
      line: e.detail.to,
      startLine: e.detail.from < e.detail.to ? e.detail.from : undefined,
    };
    revealComposer();
  }

  function onMarkerClick(e: CustomEvent<{ line: number; side: 'old' | 'new' }>) {
    // A marker stands for a remark: clicking it brings that remark forward
    // rather than skipping past it into a comment box. Every remark of the
    // extract is a candidate, including one the kind filter is hiding.
    const remark = excerptRemarks.find(
      r => r.line === e.detail.line && r.side === e.detail.side,
    );
    if (remark) {
      if (remarkKind !== 'all' && remark.kind !== remarkKind) remarkKind = 'all';
      revealRemark(remark);
      return;
    }
    if (!currentExcerpt) return;
    if (selectCommentAt(currentExcerpt.path, e.detail.line, e.detail.side)) return;
    commentFor = null;
    commentLine = { path: currentExcerpt.path, side: e.detail.side, line: e.detail.line };
    commentDraft = '';
  }

  /**
   * The remark the reader is on. It ties the two panes together: picking a card
   * scrolls the code to its line, and clicking the marker on that line brings
   * the card forward. Cleared whenever the extract changes, since a remark only
   * means something against the code it points at.
   */
  let focusedRemarkId = '';
  let focusScopedTo = '';
  $: {
    const key = currentExcerpt
      ? `${currentChapter?.id}|${currentExcerpt.path}|${currentExcerpt.from}`
      : '';
    if (focusScopedTo !== key) {
      focusScopedTo = key;
      focusedRemarkId = '';
    }
  }

  /** Picking a remark card points the diff at the line it is about. */
  function focusRemark(remark: GuideRemark) {
    focusedRemarkId = remark.id;
    requestAnimationFrame(() => diffEditor?.scrollToLine(remark.line, remark.side));
  }

  /** Brings a remark card forward and into view. */
  function revealRemark(remark: GuideRemark) {
    focusedRemarkId = remark.id;
    // The card may sit below the fold of a long remark list.
    requestAnimationFrame(() => {
      document
        .getElementById(`guide-remark-${remark.id}`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  let isSummaryOpen = false;
  $: isEverythingSeen = chapters.length > 0 && chapters.every(c => c.isSeen);
  /**
   * The review is only offered once the guide has been read through: submitting
   * halfway would send an opinion on code the reviewer has not looked at. The
   * button says why it is inert rather than just sitting greyed out.
   */
  $: canSubmit = isEverythingSeen;
  $: submitHint = canSubmit
    ? ''
    : (t('review.submitBlocked') as (n: number, total: number) => string)(
        progress.seenChapters,
        chapters.length,
      );
</script>

{#if isGenerating}
  <div class="guide-center">
    <Spinner size={22}/>
    <p class="note">{t('review.generating')}</p>
    <button class="btn small" on:click={() => cancelGuide(scope)}>{t('review.cancel')}</button>
  </div>
{:else if !guide}
  <div class="guide-center">
    <Icon name="review" size={28} style="color: var(--fg-3)"/>
    <h3>{t('review.generateGuide')}</h3>
    <p class="note">{t('review.generateGuideBody')}</p>
    {#if error}<p class="note error">{error}</p>{/if}
    <button class="btn primary small" on:click={() => void generate()} disabled={!base}>
      <Icon name="sparkles" size={12}/> {t('review.generateGuide')}
    </button>
  </div>
{:else}
  {#if isStale}
    <div class="banner">
      <Icon name="info" size={12}/>
      <span>{t('review.guideStale')}</span>
      <button class="btn small" on:click={askRegenerate}>{t('review.regenerate')}</button>
    </div>
  {/if}
  {#if error}
    <div class="banner error"><Icon name="alert" size={12}/><span>{error}</span></div>
  {/if}

  <div class="guide-layout">
    <aside class="toc">
      <button
        class="chapter overview-link"
        class:active={isAtOverview}
        on:click={backToOverview}
      >
        <Icon name="book" size={11}/>
        <span class="chapter-title">{t('review.overview')}</span>
      </button>
      <div class="section-title">{t('review.chapters')}</div>
      {#each chapters as chapter (chapter.id)}
        {@const openCount = chapter.remarks.filter(r => r.status === 'open').length}
        <button
          class="chapter"
          class:active={!isAtOverview && chapter.id === currentChapter?.id}
          class:seen={chapter.isSeen}
          on:click={() => selectChapter(chapter)}
        >
          {#if chapter.isSeen}
            <Icon name="check" size={11} style="color: var(--success); flex-shrink: 0"/>
          {:else}
            <span class="dot"></span>
          {/if}
          <span class="chapter-title">{chapter.title}</span>
          {#if openCount > 0}<span class="count">{openCount}</span>{/if}
        </button>
      {/each}
      <div class="progress">
        <div class="bar"><div class="fill" style="width: {Math.round(progress.ratio * 100)}%"></div></div>
        <span class="dim">{(t('review.hunkProgress') as (s: number, n: number) => string)(progress.seenHunks, progress.totalHunks)}</span>
        <button
          class="btn primary small submit-review"
          disabled={!canSubmit}
          title={submitHint}
          on:click={() => (isSummaryOpen = true)}
        >
          {hasMergeRequest ? t('review.submitReview') : t('review.copyReview')}
        </button>
      </div>
    </aside>

    <div class="reading">
      {#if isAtOverview}
        <div class="opening">
          <div class="opening-inner">
            <div class="opening-eyebrow">{t('review.guide')}</div>
            <h2>{t('review.whatThisBranchDoes')}</h2>
            <div class="opening-text md">{@html md(guide.overview)}</div>
            <div class="opening-stats">
              <span><b>{chapters.length}</b> {t('review.chapters')}</span>
              <span class="sep-dot">·</span>
              <span><b>{totalRemarks}</b> {t('review.remarksWord')}</span>
              <span class="sep-dot">·</span>
              <span><b>{progress.totalHunks}</b> {t('review.hunksWord')}</span>
            </div>
            <button class="btn primary" on:click={startReading} disabled={chapters.length === 0}>
              {progress.seenChapters > 0 ? t('review.continueReading') : t('review.startReading')}
              <Icon name="chev-r" size={13}/>
            </button>
          </div>
        </div>
      {:else if currentChapter}
        {@const chapterIndex = chapters.indexOf(currentChapter) + 1}
        <div class="chapter-head">
          <div class="chapter-heading">
            <div class="chapter-step">
              {(t('review.chapterOf') as (i: number, n: number) => string)(chapterIndex, chapters.length)}
            </div>
            <h3>{currentChapter.title}</h3>
          </div>
          <span class="spacer"></span>
          {#if currentChapter.excerpts.length > 1}
            <span class="dim small">
              {(t('review.excerptOf') as (i: number, n: number) => string)(excerptIndex + 1, currentChapter.excerpts.length)}
            </span>
          {/if}
          <button class="btn ghost tiny" on:click={() => step(-1)} title={hintTitle('review.previousExcerpt', 'reviewPrevExcerpt')} aria-label={t('review.previousExcerpt') as string}>
            <Icon name="chev-r" size={12} style="transform: rotate(180deg)"/>
          </button>
          <button class="btn ghost tiny" on:click={() => step(1)} title={hintTitle('review.nextExcerpt', 'reviewNextExcerpt')} aria-label={t('review.nextExcerpt') as string}>
            <Icon name="chev-r" size={12}/>
          </button>
          <button class="btn ghost tiny" on:click={askRegenerate} title={t('review.regenerate') as string} aria-label={t('review.regenerate') as string}>
            <Icon name="refresh" size={12}/>
          </button>
          <button class="btn small" class:primary={!currentChapter.isSeen} on:click={toggleSeen} title={hintTitle('review.markSeen', 'reviewMarkSeen')}>
            <Icon name="check" size={12}/>
            {currentChapter.isSeen ? t('review.markUnseen') : t('review.markSeen')}
            {#if keysOf('reviewMarkSeen')}<kbd>{keysOf('reviewMarkSeen')}</kbd>{/if}
          </button>
        </div>

        <!-- Progress lives here rather than only in the sidebar: the reader
             should know how far in they are without looking away from the code. -->
        <div class="chapter-progress">
          <div class="bar"><div class="fill" style="width: {Math.round(progress.ratio * 100)}%"></div></div>
          <span class="dim small">
            {(t('review.hunkProgress') as (s: number, n: number) => string)(progress.seenHunks, progress.totalHunks)}
          </span>
        </div>

        <div class="summary md">{@html md(currentChapter.summary)}</div>

        {#if currentExcerpt}
          <div class="excerpt-bar">
            <Icon name="file" size={12} style="color: var(--fg-2)"/>
            <span class="path selectable mono">{basename(currentExcerpt.path)}</span>
            <span class="dim mono small">{currentExcerpt.from}-{currentExcerpt.to}</span>
            <span class="spacer"></span>
            <button
              class="btn ghost tiny"
              on:click={() => dispatch('openInDiff', { path: currentExcerpt.path, line: currentExcerpt.from, side: currentExcerpt.side })}
            >
              <Icon name="external" size={11}/> {t('review.diff')}
            </button>
          </div>
          <div class="editor-wrap">
            {#if isFileLoading && !fileContent}
              <div class="center-pad"><Spinner size={14}/></div>
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
            {:else}
              <div class="empty-note">{t('review.noHunkForExcerpt')}</div>
            {/if}
          </div>
        {/if}

      {/if}
    </div>

    <aside class="comments">
      <!-- Remarks sit beside the code rather than under it: stacked below, four
           of them pushed the diff out of view, which is the thing they are
           about. -->
      {#if !isAtOverview && excerptRemarks.length > 0}
        <div class="section-title">{t('review.remarksWord')}</div>
        <div class="kind-filters" role="tablist">
          {#each ['all', ...REMARK_KINDS] as k (k)}
            {@const n = kindCount(k as 'all' | (typeof REMARK_KINDS)[number])}
            {#if k === 'all' || n > 0}
              <button
                class="kind-filter"
                class:active={remarkKind === k}
                role="tab"
                aria-selected={remarkKind === k}
                on:click={() => (remarkKind = k as typeof remarkKind)}
              >
                {k === 'all' ? t('review.filter.all') : t(`review.remark.${k}` as TranslationKey)}
                <span class="kind-filter-count">{n}</span>
              </button>
            {/if}
          {/each}
        </div>
        <div class="remarks">
          {#each currentRemarks as remark (remark.id)}
            <!-- The card is the target: picking it points the diff at its
                 line. The buttons inside stop the click from reaching it. -->
            <div
              id={`guide-remark-${remark.id}`}
              class="remark kind-{remark.kind}"
              class:dismissed={remark.status === 'dismissed'}
              class:focused={remark.id === focusedRemarkId}
              role="button"
              tabindex="0"
              on:click={() => focusRemark(remark)}
              on:keydown={(e) => e.key === 'Enter' && focusRemark(remark)}
            >
              <div class="remark-head">
                <span class="kind-pill kind-{remark.kind}">{t(`review.remark.${remark.kind}` as TranslationKey)}</span>
                <span class="dim mono small">{basename(remark.path)}:{remark.line}</span>
              </div>
              <b class="remark-title">{remark.title}</b>
              <div class="remark-body md">{@html md(remark.body)}</div>
              <div class="remark-actions">
                <button class="btn ghost tiny" on:click|stopPropagation={() => dismissRemark(scope, remark.id)} title={hintTitle('review.dismiss', 'reviewDismiss')}>
                  {remark.status === 'dismissed' ? t('review.undismiss') : t('review.dismiss')}
                </button>
                {#if remark.status !== 'commented'}
                  <button class="btn ghost tiny" on:click|stopPropagation={() => startComment(remark)} title={hintTitle('review.comment', 'reviewComment')}>
                    <Icon name="review" size={11}/> {t('review.comment')}
                  </button>
                {/if}
              </div>
            </div>
          {/each}
          {#if currentRemarks.length === 0}
            <div class="empty-note">{t('review.noRemarkOfKind')}</div>
          {/if}
        </div>
      {/if}

      <div class="section-title">{t('review.pendingComments')}</div>
      {#if commentLine}
        <div class="composer" id="guide-composer">
          <div class="dim mono small">{anchorLabel({ ...commentLine, path: basename(commentLine.path) })}</div>
          <!-- Same pending treatment as the merge request assist: the field
               itself shows the work, the button becomes the way to stop it. -->
          <div class="ai-field" class:is-generating={isDrafting}>
            <textarea
              class="selectable"
              bind:value={commentDraft}
              placeholder={isDrafting ? '' : (t('review.commentPlaceholder') as string)}
              rows="5"
              disabled={isDrafting}
              aria-busy={isDrafting}
            ></textarea>
            {#if isDrafting}
              <span class="ai-sweep" aria-hidden="true"></span>
              {#if !commentDraft}
                <span class="ai-ghost" aria-hidden="true">
                  <i style="width: 84%"></i><i style="width: 68%"></i><i style="width: 42%"></i>
                </span>
              {/if}
            {/if}
          </div>
          <div class="composer-actions">
            {#if commentFor}
              {#if isDrafting}
                <button class="btn ghost tiny ai-btn" on:click={() => cancelCommentDraft(scope)}>
                  <Spinner size={10} trackColor="var(--bg-3)" color="var(--fg-3)"/>
                  {t('review.cancel')}
                </button>
              {:else}
                <button class="btn ghost tiny ai-btn" on:click={draft}>
                  <Icon name="sparkles" size={11}/>
                  {t('review.draftComment')}
                </button>
              {/if}
            {/if}
            <span class="spacer"></span>
            <button class="btn ghost tiny" on:click={cancelComment} disabled={isDrafting}>{t('review.cancel')}</button>
            <button class="btn primary tiny" on:click={saveComment} disabled={isDrafting || commentDraft.trim() === ''}>
              {t('review.save')}
            </button>
          </div>
        </div>
      {/if}
      {#if state.comments.length === 0 && !commentLine}
        <div class="empty-note">{t('review.noPendingComments')}</div>
      {:else}
        {#each state.comments as comment (comment.id)}
          <!-- The card points at the line it is about; its own buttons stop
               the click from reaching it. -->
          <div
            class="comment"
            id="guide-comment-{comment.id}"
            class:selected={selectedCommentId === comment.id}
            class:published={!!comment.publishedAs}
            role="button"
            tabindex="0"
            on:click={() => goToComment(comment)}
            on:keydown={(e) => e.key === 'Enter' && goToComment(comment)}
          >
            <div class="comment-head">
              <span class="dim mono small">{anchorLabel({ ...comment, path: basename(comment.path) })}</span>
              <span class="spacer"></span>
              {#if !comment.publishedAs}
                <button class="btn ghost tiny" on:click|stopPropagation={() => (editingId = editingId === comment.id ? '' : comment.id)}>
                  {t('review.edit')}
                </button>
                <button class="btn ghost tiny" on:click|stopPropagation={() => deleteComment(scope, comment.id)}>
                  {t('review.delete')}
                </button>
              {/if}
            </div>
            {#if editingId === comment.id}
              <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
              <textarea
                class="selectable"
                rows="4"
                value={comment.body}
                on:click|stopPropagation
                on:input={(e) => editComment(scope, comment.id, e.currentTarget.value)}
              ></textarea>
            {:else}
              <p class="comment-body selectable">{comment.body}</p>
            {/if}
          </div>
        {/each}
      {/if}
      <div class="comments-foot">
        <button
          class="btn primary small"
          disabled={!canSubmit}
          title={submitHint}
          on:click={() => (isSummaryOpen = true)}
        >
          {hasMergeRequest ? t('review.submitReview') : t('review.copyReview')}
        </button>
      </div>
    </aside>
  </div>
{/if}

{#if isSummaryOpen && guide}
  <ReviewSummary
    {scope}
    {state}
    {hasMergeRequest}
    on:close={() => (isSummaryOpen = false)}
  />
{/if}

{#if confirmingRegenerate}
  <RegenerateGuideModal
    seenHunks={progress.seenHunks}
    on:confirm={() => void confirmRegenerate()}
    on:close={() => (confirmingRegenerate = false)}
  />
{/if}

<style>
  .guide-center {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 24px;
    min-height: 0;
    text-align: center;
  }
  .guide-center h3 { margin: 0; font-size: 14px; color: var(--fg-0); }
  .note { margin: 0; max-width: 420px; font-size: 12px; color: var(--fg-3); line-height: 1.5; }
  .note.error { color: var(--danger); }

  .banner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    font-size: 11.5px;
    color: var(--fg-1);
    background: var(--bg-2);
    border-bottom: 1px solid var(--stroke-0);
    flex-shrink: 0;
  }
  .banner.error { color: var(--danger); background: var(--danger-weak); }
  .banner span { flex: 1; }

  .guide-layout {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .toc {
    width: 240px;
    flex-shrink: 0;
    border-right: 1px solid var(--stroke-0);
    overflow-y: auto;
    padding: 8px 0;
    display: flex;
    flex-direction: column;
  }
  .section-title {
    padding: 4px 16px;
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--fg-3);
  }
  .overview { margin: 0; padding: 4px 16px 10px; font-size: 12px; line-height: 1.5; color: var(--fg-2); }

  .chapter {
    display: flex;
    align-items: center;
    gap: 7px;
    width: calc(100% - 8px);
    margin: 0 4px;
    padding: 6px 10px;
    border: 0;
    background: transparent;
    border-radius: 4px;
    cursor: pointer;
    text-align: left;
    font-size: 12px;
    color: var(--fg-1);
  }
  .chapter:hover { background: var(--bg-3); }
  .chapter.active { background: var(--bg-4); color: var(--fg-0); }
  .chapter.seen .chapter-title { color: var(--fg-3); }
  .chapter-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--fg-3);
    flex-shrink: 0;
    margin: 0 2.5px;
  }
  .count {
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
  }

  .submit-review { width: 100%; justify-content: center; margin-top: 2px; }
  .progress {
    margin-top: auto;
    padding: 10px 16px 4px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 11px;
  }
  .bar { height: 4px; border-radius: 2px; background: var(--bg-3); overflow: hidden; }
  .fill { height: 100%; background: var(--success); transition: width 160ms ease; }

  .reading {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .chapter-head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 14px 4px;
  }
  .chapter-head h3 { margin: 0; font-size: 13.5px; color: var(--fg-0); }
  .summary { padding: 2px 14px 10px; font-size: 12px; line-height: 1.55; color: var(--fg-2); }

  /*
   * What the renderer emits. The model writes prose with inline code for paths
   * and symbols, the occasional list, and nothing heavier - so this styles that
   * much and lets anything rarer inherit rather than go unstyled.
   */
  .md :global(p) { margin: 0 0 0.7em; }
  .md :global(p:last-child) { margin-bottom: 0; }
  .md :global(code) {
    font-family: var(--font-mono);
    font-size: 0.92em;
    padding: 1px 4px;
    border-radius: 3px;
    background: var(--bg-3);
    color: var(--fg-0);
  }
  .md :global(pre) {
    margin: 0 0 0.7em;
    padding: 8px 10px;
    border-radius: 4px;
    background: var(--bg-2);
    overflow-x: auto;
  }
  .md :global(pre code) { padding: 0; background: none; }
  .md :global(ul),
  .md :global(ol) { margin: 0 0 0.7em; padding-left: 1.3em; }
  .md :global(li) { margin: 0.15em 0; }
  .md :global(a) { color: var(--accent); text-decoration: none; }
  .md :global(a:hover) { text-decoration: underline; }
  .md :global(strong) { color: var(--fg-0); font-weight: 600; }
  .md :global(blockquote) {
    margin: 0 0 0.7em;
    padding-left: 10px;
    border-left: 2px solid var(--stroke-1);
    color: var(--fg-3);
  }
  .md :global(h1),
  .md :global(h2),
  .md :global(h3),
  .md :global(h4) {
    margin: 0.6em 0 0.35em;
    font-size: 1.05em;
    color: var(--fg-0);
  }

  .excerpt-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 14px;
    height: 30px;
    border-top: 1px solid var(--stroke-0);
    border-bottom: 1px solid var(--stroke-0);
    font-size: 12px;
    color: var(--fg-2);
    flex-shrink: 0;
  }
  .editor-wrap { flex: 1; position: relative; overflow: hidden; min-height: 120px; }
  .center-pad { display: flex; align-items: center; justify-content: center; padding: 24px; }

  /* The opening page: one column at a readable measure, centred, so the
     overview is prose rather than a squeezed strip in the sidebar. */
  .opening {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px 24px;
  }
  .opening-inner { max-width: 620px; width: 100%; }
  .opening-eyebrow {
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fg-3);
  }
  .opening h2 {
    margin: 6px 0 14px;
    font-size: 20px;
    line-height: 1.25;
    color: var(--fg-0);
  }
  .opening-text {
    margin: 0 0 18px;
    font-size: 13.5px;
    line-height: 1.65;
    color: var(--fg-1);
  }
  .opening-stats {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-bottom: 20px;
    font-size: 12px;
    color: var(--fg-3);
  }
  .opening-stats b { color: var(--fg-1); font-weight: 600; }
  .sep-dot { opacity: 0.5; }
  .opening .btn { display: inline-flex; align-items: center; gap: 6px; }

  .overview-link { margin-bottom: 4px; }

  .chapter-heading { min-width: 0; }
  .chapter-step {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--fg-3);
  }
  .chapter-progress {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 14px 8px;
  }
  .chapter-progress .bar { flex: 1; }
  kbd {
    font-family: var(--font-mono);
    font-size: 9.5px;
    padding: 1px 4px;
    border-radius: 3px;
    background: var(--bg-0);
    color: var(--fg-3);
    opacity: 0.85;
  }

  /* Remarks now live in the side column, one card per remark. */
  .kind-filters {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    padding: 2px 10px 6px;
  }
  .kind-filter {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 7px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--fg-3);
    font-size: 10.5px;
    cursor: pointer;
  }
  .kind-filter:hover { background: var(--bg-3); color: var(--fg-1); }
  .kind-filter.active { background: var(--bg-4); color: var(--fg-0); }
  .kind-filter-count { font-size: 9.5px; opacity: 0.7; font-variant-numeric: tabular-nums; }

  .remarks {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 0 10px 12px;
  }
  .remark {
    border: 1px solid var(--stroke-0);
    border-left-width: 3px;
    border-radius: 5px;
    padding: 8px 10px;
    background: var(--bg-1);
  }
  .remark { cursor: pointer; }
  .remark:hover { border-color: var(--stroke-1); }
  .remark.dismissed { opacity: 0.5; }
  .remark.focused {
    border-color: var(--accent);
    background: var(--bg-2);
  }
  .remark.kind-issue { border-left-color: var(--danger); }
  .remark.kind-question { border-left-color: oklch(0.82 0.14 60); }
  .remark.kind-refactor { border-left-color: oklch(0.7 0.14 280); }
  .remark.kind-note { border-left-color: var(--fg-3); }
  .remark-head { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
  .remark-title { display: block; font-size: 12.5px; color: var(--fg-0); }
  .remark-body {
    margin: 4px 0 8px;
    font-size: 11.5px;
    line-height: 1.55;
    color: var(--fg-2);
  }
  .remark-actions { display: flex; gap: 4px; }
  .kind-pill {
    font-size: 9.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--bg-3);
    color: var(--fg-2);
  }
  .kind-pill.kind-issue { color: var(--danger); }
  .kind-pill.kind-question { color: oklch(0.82 0.14 60); }
  .kind-pill.kind-refactor { color: oklch(0.7 0.14 280); }

  .comments {
    width: 330px;
    flex-shrink: 0;
    border-left: 1px solid var(--stroke-0);
    overflow-y: auto;
    padding: 8px 0;
    display: flex;
    flex-direction: column;
  }
  /* Restores the gap the textarea's own margin used to provide. */
  .composer .ai-field { margin: 6px 0; }
  .comment textarea { margin: 6px 0; }

  .composer, .comment {
    margin: 4px 10px;
    padding: 8px;
    border: 1px solid var(--stroke-0);
    border-radius: 5px;
    background: var(--bg-1);
  }
  .comment { cursor: pointer; }
  .comment:hover { border-color: var(--stroke-1); }
  .comment.selected { border-color: var(--accent); }
  .comment.published { opacity: 0.6; }
  .comment-head, .composer-actions { display: flex; align-items: center; gap: 4px; }
  .comment-body { margin: 4px 0 0; font-size: 12px; line-height: 1.5; color: var(--fg-1); white-space: pre-wrap; }
  textarea {
    width: 100%;
    /* The wrapper owns the spacing: `.ai-field` draws its glow tight to the
       field, so a margin here would leave the ring floating off it. */
    margin: 0;
    padding: 6px;
    font-family: inherit;
    font-size: 12px;
    line-height: 1.5;
    color: var(--fg-0);
    background: var(--bg-0);
    border: 1px solid var(--stroke-0);
    border-radius: 4px;
    resize: vertical;
  }
  .comments-foot { margin-top: auto; padding: 10px; }
  .comments-foot .btn { width: 100%; justify-content: center; }

  .empty-note { padding: 8px 16px; font-size: 11.5px; color: var(--fg-3); }
  .dim { color: var(--fg-3); }
  .small { font-size: 11px; }
  .spacer { flex: 1; }
  .btn.small { padding: 3px 8px; font-size: 11.5px; display: inline-flex; align-items: center; gap: 5px; }
  .btn.tiny { padding: 2px 6px; font-size: 11px; display: inline-flex; align-items: center; gap: 4px; }
</style>
