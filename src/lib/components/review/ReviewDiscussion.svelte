<script lang="ts">
  /**
   * One discussion thread of the merge request: its comments, a reply box,
   * resolve / unresolve, and the hand-off to the agent.
   */
  import { createEventDispatcher } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import { t } from '$lib/i18n';
  import type { Discussion } from '$lib/types/integrations';

  export let discussion: Discussion;
  export let renderMarkdown: (source: string) => string;
  export let isSelected = false;
  export let isReplying = false;
  export let isResolving = false;
  export let canAddress = true;

  const dispatch = createEventDispatcher<{
    reply: { body: string };
    resolve: { resolved: boolean };
    address: void;
    jump: void;
    select: void;
  }>();

  let draft = '';
  let isReplyOpen = false;

  function sendReply() {
    const body = draft.trim();
    if (!body || isReplying) return;
    dispatch('reply', { body });
    draft = '';
    isReplyOpen = false;
  }

  function relativeDate(iso: string): string {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
  }
</script>

<div
  class="discussion {isSelected ? 'selected' : ''} {discussion.resolved ? 'is-resolved' : ''}"
  role="button"
  tabindex="0"
  on:click={() => dispatch('select')}
  on:keydown={(e) => e.key === 'Enter' && dispatch('select')}
>
  <div class="discussion-head">
    {#if discussion.anchor}
      <button class="line-jump mono" on:click|stopPropagation={() => dispatch('jump')} title={discussion.anchor.path}>
        {(t('review.line') as (n: number) => string)(discussion.anchor.line)}
      </button>
    {/if}
    {#if discussion.resolved}
      <span class="resolved-pill"><Icon name="check" size={10}/> {t('review.resolved')}</span>
    {/if}
    <span class="spacer"></span>
    {#if discussion.resolvable}
      <button
        class="btn ghost tiny"
        disabled={isResolving}
        on:click|stopPropagation={() => dispatch('resolve', { resolved: !discussion.resolved })}
      >
        {#if isResolving}<Spinner size={10}/>{/if}
        {discussion.resolved ? t('review.unresolve') : t('review.resolve')}
      </button>
    {/if}
    {#if canAddress}
      <button class="btn ghost tiny" on:click|stopPropagation={() => dispatch('address')} title={t('review.addressWithAgent') as string}>
        <Icon name="agent" size={11}/> {t('review.addressWithAgent')}
      </button>
    {/if}
  </div>

  {#each discussion.comments as comment (comment.id)}
    <div class="comment {comment.isSystem ? 'system' : ''}">
      <div class="comment-meta">
        <span class="author">{comment.author.displayName || comment.author.login}</span>
        <span class="date">{relativeDate(comment.createdAt)}</span>
      </div>
      <div class="comment-body selectable">{@html renderMarkdown(comment.body)}</div>
    </div>
  {/each}

  {#if isReplyOpen}
    <div class="reply-box" on:click|stopPropagation on:keydown|stopPropagation role="presentation">
      <textarea
        class="selectable"
        rows="3"
        bind:value={draft}
        placeholder={t('review.replyPlaceholder') as string}
        on:keydown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendReply(); }}
      ></textarea>
      <div class="reply-actions">
        <button class="btn ghost tiny" on:click={() => { isReplyOpen = false; draft = ''; }}>{t('common.cancel')}</button>
        <button class="btn primary tiny" disabled={!draft.trim() || isReplying} on:click={sendReply}>
          {#if isReplying}<Spinner size={10}/>{:else}<Icon name="send" size={11}/>{/if}
          {t('review.send')}
        </button>
      </div>
    </div>
  {:else}
    <button class="btn ghost tiny reply-open" on:click|stopPropagation={() => isReplyOpen = true}>
      {t('review.reply')}
    </button>
  {/if}
</div>

<style>
  .discussion {
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-md);
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    background: var(--bg-1);
    cursor: default;
  }
  .discussion.selected { border-color: var(--accent); }
  .discussion.is-resolved { opacity: 0.72; }

  .discussion-head {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--fg-2);
    flex-wrap: wrap;
  }
  .spacer { flex: 1; }

  .line-jump {
    background: var(--bg-3);
    border: none;
    border-radius: 3px;
    padding: 1px 6px;
    font-size: 10.5px;
    color: var(--fg-1);
    cursor: pointer;
  }
  .line-jump:hover { background: var(--bg-4); color: var(--fg-0); }

  .resolved-pill {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    color: var(--success);
    font-size: 10.5px;
  }

  .comment { display: flex; flex-direction: column; gap: 2px; }
  .comment.system { opacity: 0.6; font-style: italic; }
  .comment-meta { display: flex; gap: 8px; font-size: 10.5px; color: var(--fg-3); }
  .author { color: var(--fg-1); font-weight: 600; }
  .comment-body { font-size: 12px; line-height: 1.5; color: var(--fg-0); overflow-wrap: anywhere; }
  .comment-body :global(p) { margin: 0 0 4px; }
  .comment-body :global(pre) {
    background: var(--bg-2);
    padding: 6px 8px;
    border-radius: 4px;
    font-size: 11px;
    overflow-x: auto;
  }
  .comment-body :global(code) { font-family: var(--font-mono); font-size: 11px; }

  .reply-box { display: flex; flex-direction: column; gap: 6px; }
  textarea {
    width: 100%;
    resize: vertical;
    background: var(--bg-2);
    border: 1px solid var(--stroke-0);
    border-radius: 4px;
    color: var(--fg-0);
    font: inherit;
    font-size: 12px;
    padding: 6px 8px;
  }
  .reply-actions { display: flex; justify-content: flex-end; gap: 6px; }
  .reply-open { align-self: flex-start; }

  .btn.tiny { padding: 2px 7px; font-size: 11px; height: auto; display: inline-flex; align-items: center; gap: 4px; }
</style>
