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
  import type {
    GuideChapter,
    GuideRemark,
    ReviewHunk,
    ReviewState,
  } from '$lib/types/review';
  import type { EditorLanguage } from '$lib/utils/editor/editor-theme';
  import { basename } from '$lib/utils/files/files-tree';
  import { excerptAround } from '$lib/utils/review/diff-markers';
  import { guideProgress, isGuideStale } from '$lib/utils/review/review-guide';
  import DiffEditor from './DiffEditor.svelte';
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

  $: currentChapter =
    chapters.find(c => c.id === state.currentChapterId) ?? chapters[0] ?? null;
  $: excerptIndex = Math.min(
    state.currentExcerptIndex,
    Math.max(0, (currentChapter?.excerpts.length ?? 1) - 1),
  );
  $: currentExcerpt = currentChapter?.excerpts[excerptIndex] ?? null;

  /** The remarks that fall inside the extract on screen. */
  $: currentRemarks = (currentChapter?.remarks ?? []).filter(
    r => currentExcerpt
      && r.path === currentExcerpt.path
      && r.line >= currentExcerpt.from
      && r.line <= currentExcerpt.to,
  );

  async function generate() {
    await generateGuide(scope, {
      base,
      head,
      baseSha: base,
      headSha: head,
      mrTitle,
      mrDescription,
      ticket,
      assignments: $settings.aiFeatures,
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
    if (!target) return;
    setCurrentPosition(scope, target.id, delta > 0 ? 0 : Math.max(0, target.excerpts.length - 1));
  }

  function stepChapter(delta: number) {
    if (!currentChapter) return;
    const target = chapters[chapters.indexOf(currentChapter) + delta];
    if (target) setCurrentPosition(scope, target.id, 0);
  }

  function toggleSeen() {
    if (currentChapter) markChapterSeen(scope, currentChapter.id, !currentChapter.isSeen);
  }

  /** Every action the review shortcuts can reach; the palette calls the same. */
  export function executeAction(id: string): boolean {
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
  $: markers = currentRemarks.map(r => ({
    line: r.line,
    side: r.side,
    count: 1,
    isResolved: r.status === 'dismissed',
    kind: r.kind,
  }));

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
  let commentLine: { path: string; side: 'old' | 'new'; line: number } | null = null;
  let isDrafting = false;
  let editingId = '';

  function sourceFor(side: 'old' | 'new'): string {
    return (side === 'old' ? fileContent?.oldContent : fileContent?.newContent) ?? '';
  }

  function startComment(remark: GuideRemark) {
    commentFor = remark;
    commentLine = { path: remark.path, side: remark.side, line: remark.line };
    commentDraft = '';
  }

  async function draft() {
    if (!commentFor || isDrafting) return;
    isDrafting = true;
    try {
      commentDraft = await draftCommentFor(
        scope,
        commentFor,
        excerptAround(sourceFor(commentFor.side), commentFor.line),
        { assignments: $settings.aiFeatures },
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
    cancelComment();
  }

  function cancelComment() {
    commentFor = null;
    commentLine = null;
    commentDraft = '';
  }

  function onMarkerClick(e: CustomEvent<{ line: number; side: 'old' | 'new' }>) {
    const remark = currentRemarks.find(r => r.line === e.detail.line && r.side === e.detail.side);
    if (remark) {
      startComment(remark);
      return;
    }
    if (!currentExcerpt) return;
    commentFor = null;
    commentLine = { path: currentExcerpt.path, side: e.detail.side, line: e.detail.line };
    commentDraft = '';
  }

  let isSummaryOpen = false;
  $: isEverythingSeen = chapters.length > 0 && chapters.every(c => c.isSeen);
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
    <button class="btn primary small" on:click={generate} disabled={!base}>
      <Icon name="sparkles" size={12}/> {t('review.generateGuide')}
    </button>
  </div>
{:else}
  {#if isStale}
    <div class="banner">
      <Icon name="info" size={12}/>
      <span>{t('review.guideStale')}</span>
      <button class="btn small" on:click={generate}>{t('review.regenerate')}</button>
    </div>
  {/if}
  {#if error}
    <div class="banner error"><Icon name="alert" size={12}/><span>{error}</span></div>
  {/if}

  <div class="guide-layout">
    <aside class="toc">
      <div class="section-title">{t('review.overview')}</div>
      <p class="overview">{guide.overview}</p>
      <div class="section-title">{t('review.chapters')}</div>
      {#each chapters as chapter (chapter.id)}
        {@const openCount = chapter.remarks.filter(r => r.status === 'open').length}
        <button
          class="chapter"
          class:active={chapter.id === currentChapter?.id}
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
        <button class="btn ghost tiny" on:click={() => (isSummaryOpen = true)}>
          {t('review.summaryTitle')}
        </button>
      </div>
    </aside>

    <div class="reading">
      {#if currentChapter}
        <div class="chapter-head">
          <h3>{currentChapter.title}</h3>
          <span class="spacer"></span>
          {#if currentChapter.excerpts.length > 1}
            <span class="dim small">
              {(t('review.excerptOf') as (i: number, n: number) => string)(excerptIndex + 1, currentChapter.excerpts.length)}
            </span>
          {/if}
          <button class="btn ghost tiny" on:click={() => step(-1)} title={t('review.previousExcerpt') as string} aria-label={t('review.previousExcerpt') as string}>
            <Icon name="chev-r" size={12} style="transform: rotate(180deg)"/>
          </button>
          <button class="btn ghost tiny" on:click={() => step(1)} title={t('review.nextExcerpt') as string} aria-label={t('review.nextExcerpt') as string}>
            <Icon name="chev-r" size={12}/>
          </button>
          <button class="btn small" class:primary={!currentChapter.isSeen} on:click={toggleSeen}>
            <Icon name="check" size={12}/>
            {currentChapter.isSeen ? t('review.markUnseen') : t('review.markSeen')}
          </button>
        </div>
        <p class="summary">{currentChapter.summary}</p>

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
                />
              {/key}
            {:else}
              <div class="empty-note">{t('review.noHunkForExcerpt')}</div>
            {/if}
          </div>
        {/if}

        {#if currentRemarks.length > 0}
          <div class="remarks">
            {#each currentRemarks as remark (remark.id)}
              <div class="remark kind-{remark.kind}" class:dismissed={remark.status === 'dismissed'}>
                <div class="remark-head">
                  <span class="kind-pill kind-{remark.kind}">{t(`review.remark.${remark.kind}` as TranslationKey)}</span>
                  <b class="remark-title">{remark.title}</b>
                  <span class="dim mono small">{basename(remark.path)}:{remark.line}</span>
                  <span class="spacer"></span>
                  <button class="btn ghost tiny" on:click={() => dismissRemark(scope, remark.id)}>
                    {remark.status === 'dismissed' ? t('review.undismiss') : t('review.dismiss')}
                  </button>
                  {#if remark.status !== 'commented'}
                    <button class="btn ghost tiny" on:click={() => startComment(remark)}>
                      <Icon name="review" size={11}/> {t('review.comment')}
                    </button>
                  {/if}
                </div>
                <p class="remark-body">{remark.body}</p>
              </div>
            {/each}
          </div>
        {/if}
      {/if}
    </div>

    <aside class="comments">
      <div class="section-title">{t('review.pendingComments')}</div>
      {#if commentLine}
        <div class="composer">
          <div class="dim mono small">{basename(commentLine.path)}:{commentLine.line}</div>
          <textarea
            class="selectable"
            bind:value={commentDraft}
            placeholder={t('review.commentPlaceholder') as string}
            rows="5"
          ></textarea>
          <div class="composer-actions">
            {#if commentFor}
              <button class="btn ghost tiny" on:click={draft} disabled={isDrafting}>
                {#if isDrafting}<Spinner size={10}/>{:else}<Icon name="sparkles" size={11}/>{/if}
                {t('review.draftComment')}
              </button>
            {/if}
            <span class="spacer"></span>
            <button class="btn ghost tiny" on:click={cancelComment}>{t('review.cancel')}</button>
            <button class="btn primary tiny" on:click={saveComment} disabled={commentDraft.trim() === ''}>
              {t('review.save')}
            </button>
          </div>
        </div>
      {/if}
      {#if state.comments.length === 0 && !commentLine}
        <div class="empty-note">{t('review.noPendingComments')}</div>
      {:else}
        {#each state.comments as comment (comment.id)}
          <div class="comment" class:published={!!comment.publishedAs}>
            <div class="comment-head">
              <span class="dim mono small">{basename(comment.path)}:{comment.line}</span>
              <span class="spacer"></span>
              {#if !comment.publishedAs}
                <button class="btn ghost tiny" on:click={() => (editingId = editingId === comment.id ? '' : comment.id)}>
                  {t('review.edit')}
                </button>
                <button class="btn ghost tiny" on:click={() => deleteComment(scope, comment.id)}>
                  {t('review.delete')}
                </button>
              {/if}
            </div>
            {#if editingId === comment.id}
              <textarea
                class="selectable"
                rows="4"
                value={comment.body}
                on:input={(e) => editComment(scope, comment.id, e.currentTarget.value)}
              ></textarea>
            {:else}
              <p class="comment-body selectable">{comment.body}</p>
            {/if}
          </div>
        {/each}
      {/if}
      <div class="comments-foot">
        <button class="btn primary small" on:click={() => (isSummaryOpen = true)} disabled={state.comments.length === 0 && !isEverythingSeen}>
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
  .summary { margin: 0; padding: 2px 14px 10px; font-size: 12px; line-height: 1.55; color: var(--fg-2); }

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

  .remarks {
    flex-shrink: 0;
    max-height: 38%;
    overflow-y: auto;
    border-top: 1px solid var(--stroke-0);
    padding: 8px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .remark {
    border: 1px solid var(--stroke-0);
    border-left-width: 3px;
    border-radius: 5px;
    padding: 7px 10px;
    background: var(--bg-1);
  }
  .remark.dismissed { opacity: 0.55; }
  .remark.kind-issue { border-left-color: var(--danger); }
  .remark.kind-question { border-left-color: oklch(0.82 0.14 60); }
  .remark.kind-refactor { border-left-color: oklch(0.7 0.14 280); }
  .remark.kind-note { border-left-color: var(--fg-3); }
  .remark-head { display: flex; align-items: center; gap: 6px; }
  .remark-title { font-size: 12.5px; color: var(--fg-0); }
  .remark-body { margin: 4px 0 0; font-size: 12px; line-height: 1.5; color: var(--fg-2); white-space: pre-wrap; }
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
    width: 290px;
    flex-shrink: 0;
    border-left: 1px solid var(--stroke-0);
    overflow-y: auto;
    padding: 8px 0;
    display: flex;
    flex-direction: column;
  }
  .composer, .comment {
    margin: 4px 10px;
    padding: 8px;
    border: 1px solid var(--stroke-0);
    border-radius: 5px;
    background: var(--bg-1);
  }
  .comment.published { opacity: 0.6; }
  .comment-head, .composer-actions { display: flex; align-items: center; gap: 4px; }
  .comment-body { margin: 4px 0 0; font-size: 12px; line-height: 1.5; color: var(--fg-1); white-space: pre-wrap; }
  textarea {
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
