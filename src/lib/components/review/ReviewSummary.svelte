<script lang="ts">
  /**
   * The end of the reading: what the remarks became, what is waiting to be sent,
   * and the verdict. With a forge it submits the whole review in one go; without
   * one it hands the reviewer the markdown to paste wherever they want.
   */
  import { writeText } from '@tauri-apps/plugin-clipboard-manager';
  import { createEventDispatcher } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import { t } from '$lib/i18n';
  import { publishReview, reviewMarkdown, type ReviewScope } from '$lib/stores/review';
  import type { ReviewState, ReviewVerdict } from '$lib/types/review';

  export let scope: ReviewScope;
  export let state: ReviewState;
  export let hasMergeRequest = false;

  const dispatch = createEventDispatcher<{ close: void }>();

  let verdict: ReviewVerdict = 'comment';
  let body = '';
  let isSubmitting = false;
  let error = '';
  let isPartial = false;
  let isCopied = false;

  $: remarks = (state.guide?.chapters ?? []).flatMap(c => c.remarks);
  $: handled = remarks.filter(r => r.status === 'commented').length;
  $: dismissed = remarks.filter(r => r.status === 'dismissed').length;
  $: open = remarks.filter(r => r.status === 'open').length;
  $: pending = state.comments.filter(c => !c.publishedAs);

  async function submit() {
    if (isSubmitting) return;
    isSubmitting = true;
    error = '';
    try {
      const result = await publishReview(scope, verdict, body);
      // Anything already on the forge stays marked as such, so a second attempt
      // only sends what did not make it the first time.
      isPartial = result.failed > 0;
      if (!isPartial) dispatch('close');
      else error = t('review.publishPartial') as string;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      isSubmitting = false;
    }
  }

  async function copy() {
    await writeText(reviewMarkdown(scope, verdict, body));
    isCopied = true;
    setTimeout(() => (isCopied = false), 1600);
  }
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
  <div class="modal summary-modal" on:click|stopPropagation role="presentation">
    <div class="modal-head">
      <h3>{t('review.summaryTitle')}</h3>
      <button class="icon-btn close" on:click={() => dispatch('close')} aria-label={t('review.cancel') as string}>
        <Icon name="x" size={16}/>
      </button>
    </div>
    <div class="modal-body">
      <div class="tallies">
        <span class="tally ok">{(t('review.remarksHandled') as (n: number) => string)(handled)}</span>
        <span class="tally">{(t('review.remarksDismissed') as (n: number) => string)(dismissed)}</span>
        <span class="tally warn">{(t('review.remarksOpen') as (n: number) => string)(open)}</span>
      </div>

      <div class="section-title">{t('review.pendingComments')}</div>
      {#if pending.length === 0}
        <p class="empty-note">{t('review.noPendingComments')}</p>
      {:else}
        <ul class="pending">
          {#each pending as comment (comment.id)}
            <li>
              <span class="mono dim">{comment.path}:{comment.line}</span>
              <span class="preview">{comment.body}</span>
            </li>
          {/each}
        </ul>
      {/if}

      <div class="section-title">{t('review.verdict.comment')}</div>
      <div class="verdicts">
        {#each ['approve', 'changes', 'comment'] as const as option}
          <label class="verdict" class:active={verdict === option}>
            <input type="radio" bind:group={verdict} value={option}/>
            {t(`review.verdict.${option}`)}
          </label>
        {/each}
      </div>

      <textarea
        class="selectable"
        rows="4"
        bind:value={body}
        placeholder={t('review.summaryBody') as string}
      ></textarea>

      {#if error}<p class="error-note">{error}</p>{/if}
    </div>
    <div class="modal-foot">
      {#if hasMergeRequest}
        <button class="btn primary" on:click={submit} disabled={isSubmitting}>
          {#if isSubmitting}<Spinner size={12}/>{/if}
          {t('review.submitReview')}
        </button>
      {:else}
        <button class="btn primary" on:click={copy}>
          <Icon name={isCopied ? 'check' : 'copy'} size={12}/>
          {isCopied ? t('review.copied') : t('review.copyReview')}
        </button>
      {/if}
    </div>
  </div>
</div>

<style>
  .summary-modal { width: min(560px, 92vw); }
  .modal-head { display: flex; align-items: center; }
  .modal-head h3 { margin: 0; flex: 1; font-size: 14px; }
  .modal-body { display: flex; flex-direction: column; gap: 4px; }

  .tallies { display: flex; gap: 6px; margin-bottom: 6px; }
  .tally {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--bg-3);
    color: var(--fg-2);
  }
  .tally.ok { color: var(--success); }
  .tally.warn { color: oklch(0.82 0.14 60); }

  .section-title {
    padding: 8px 0 2px;
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--fg-3);
  }
  .pending { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 5px; max-height: 160px; overflow-y: auto; }
  .pending li { display: flex; gap: 8px; font-size: 12px; align-items: baseline; }
  .preview { color: var(--fg-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dim { color: var(--fg-3); }
  .empty-note { margin: 0; font-size: 11.5px; color: var(--fg-3); }

  .verdicts { display: flex; gap: 6px; }
  .verdict {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
    border: 1px solid var(--stroke-0);
    border-radius: 5px;
    font-size: 12px;
    cursor: pointer;
    color: var(--fg-1);
  }
  .verdict.active { border-color: var(--accent); color: var(--fg-0); }
  .verdict input { margin: 0; }

  textarea {
    width: 100%;
    margin-top: 8px;
    padding: 7px;
    font-family: inherit;
    font-size: 12px;
    line-height: 1.5;
    color: var(--fg-0);
    background: var(--bg-0);
    border: 1px solid var(--stroke-0);
    border-radius: 4px;
    resize: vertical;
  }
  .error-note { margin: 6px 0 0; font-size: 11.5px; color: var(--danger); }
  .modal-foot { display: flex; justify-content: flex-end; padding-top: 10px; }
</style>
