<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import CopyButton from '$lib/components/CopyButton.svelte';
  import { t } from '$lib/i18n';
  import { gitLineHistory, type LineHistoryEntry } from '$lib/services/file-service';
  import { clickOutside } from '$lib/utils/click-outside';

  export let worktreePath: string | null;
  export let relPath: string;
  export let line: number;
  export let onClose: () => void;

  /** A commit that rewrote the whole block drags its entire hunk in; only the
      lines around the tracked one are worth showing. */
  const MAX_CHANGES = 12;

  let entries: LineHistoryEntry[] = [];
  let loading = true;
  let error = '';
  let token = 0;

  $: void load(worktreePath, relPath, line);

  async function load(root: string | null, path: string, at: number) {
    const mine = ++token;
    if (!root || !path || at < 1) {
      entries = [];
      loading = false;
      return;
    }
    loading = true;
    error = '';
    try {
      const result = await gitLineHistory(root, path, at);
      if (mine !== token) return;
      entries = result;
    } catch (e) {
      if (mine !== token) return;
      entries = [];
      error = e instanceof Error ? e.message : String(e);
    } finally {
      if (mine === token) loading = false;
    }
  }

  function formatDate(timestamp: number): string {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
</script>

<div class="line-history" use:clickOutside={onClose}>
  <div class="lh-header">
    <Icon name="clock" size={12}/>
    <span class="lh-title">{t('files.lineHistory.title')}</span>
    <span class="lh-loc selectable">{relPath}:{line}</span>
    <button type="button" class="lh-close" on:click={onClose} aria-label={t('common.close') as string}>
      <Icon name="x" size={13}/>
    </button>
  </div>

  <div class="lh-body">
    {#if loading}
      <div class="lh-skeleton"><Skeleton lines={5} height={13} gap={9}/></div>
    {:else if error}
      <div class="lh-note error">{error}</div>
    {:else if entries.length === 0}
      <div class="lh-note dimmed">{t('files.lineHistory.empty')}</div>
    {:else}
      {#each entries as entry (entry.hash)}
        <div class="lh-entry">
          <div class="lh-meta">
            <span class="lh-hash selectable">{entry.shortHash}</span>
            <CopyButton value={entry.hash} size={10}/>
            <span class="lh-subject" title={entry.subject}>{entry.subject}</span>
          </div>
          <div class="lh-sub">
            <span class="lh-author" title={entry.email}>{entry.author}</span>
            <span class="lh-date">{formatDate(entry.timestamp)}</span>
          </div>
          {#if entry.changes.length > 0}
            <div class="lh-changes">
              {#each entry.changes.slice(0, MAX_CHANGES) as change}
                <div class="lh-change lh-change-{change.type === '+' ? 'add' : 'del'}">
                  <span class="lh-sign">{change.type}</span>
                  <span class="lh-code selectable">{change.content}</span>
                </div>
              {/each}
              {#if entry.changes.length > MAX_CHANGES}
                <div class="lh-more">{(t('files.lineHistory.moreLines') as (n: number) => string)(entry.changes.length - MAX_CHANGES)}</div>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .line-history {
    position: absolute;
    right: 8px;
    bottom: 26px;
    z-index: 20;
    width: 460px;
    max-width: calc(100% - 16px);
    display: flex;
    flex-direction: column;
    background: var(--bg-1);
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-sm);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    overflow: hidden;
  }

  .lh-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 6px 6px 10px;
    border-bottom: 1px solid var(--stroke-0);
    font-size: 10px;
    font-family: var(--font-mono);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--fg-3);
    flex-shrink: 0;
  }
  .lh-title { flex-shrink: 0; }
  .lh-loc {
    flex: 1;
    min-width: 0;
    text-transform: none;
    letter-spacing: 0;
    color: var(--fg-4);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    direction: rtl;
    text-align: left;
  }
  .lh-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border: none;
    background: none;
    border-radius: 3px;
    cursor: pointer;
    color: var(--fg-3);
    padding: 0;
    flex-shrink: 0;
  }
  .lh-close:hover { background: var(--bg-4); color: var(--fg-0); }

  .lh-body {
    overflow-y: auto;
    max-height: 320px;
  }
  .lh-body::-webkit-scrollbar { width: 6px; }
  .lh-body::-webkit-scrollbar-track { background: transparent; }
  .lh-body::-webkit-scrollbar-thumb { background: var(--bg-4); border-radius: 3px; }

  .lh-skeleton { padding: 10px; }
  .lh-note { padding: 10px; font-size: 11px; font-family: var(--font-mono); }
  .lh-note.dimmed { color: var(--fg-4); }
  .lh-note.error { color: var(--danger); }

  .lh-entry {
    padding: 7px 10px 8px;
    border-bottom: 1px solid var(--stroke-0);
  }
  .lh-entry:last-child { border-bottom: none; }

  .lh-meta {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
  }
  .lh-hash {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--accent);
    flex-shrink: 0;
  }
  .lh-subject {
    flex: 1;
    min-width: 0;
    font-size: 12px;
    color: var(--fg-0);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .lh-sub {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-top: 2px;
    font-size: 10.5px;
    color: var(--fg-4);
    font-family: var(--font-mono);
  }
  .lh-author {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 55%;
  }

  .lh-changes {
    margin-top: 6px;
    border-radius: 3px;
    overflow: hidden;
  }
  .lh-change {
    display: flex;
    gap: 6px;
    padding: 1px 6px;
    font-family: var(--font-mono);
    font-size: 11px;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .lh-change-add { background: var(--git-add-bg); color: var(--fg-1); }
  .lh-change-del { background: var(--git-remove-bg); color: var(--fg-2); }
  .lh-more {
    padding: 2px 6px;
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--fg-4);
  }
  .lh-sign { flex-shrink: 0; color: var(--fg-4); }
  .lh-code { flex: 1; min-width: 0; }
</style>
