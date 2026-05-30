<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n';
  import {
    git,
    refreshStatus,
    stageFile,
    unstageFile,
    commitChanges,
    pushBranch,
    setCommitMessage,
  } from '$lib/stores/git';
  import { activeInstance } from '$lib/stores/instance';

  $: state = $git;
  $: instance = $activeInstance;

  type HunkCard = {
    file: string;
    basename: string;
    dirpath: string;
    hunk: string;
    lines: { kind: string; content: string }[];
    filePath: string;
    status: string;
  };

  const STATUS_LABEL: Record<string, string> = {
    modified:        'modified',
    untracked:       'new file',
    deleted:         'deleted',
    'staged-modified': 'modified',
    'staged-added':    'new file',
    'staged-deleted':  'deleted',
    'staged-renamed':  'renamed',
    'staged-copied':   'copied',
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

  function buildCards(
    statusEntries: [string, string][],
    diffs: typeof state.unstagedDiffs,
  ): HunkCard[] {
    const byPath = new Map(diffs.map(f => [f.filePath, f]));
    const cards: HunkCard[] = [];
    for (const [filePath, status] of statusEntries) {
      const diff = byPath.get(filePath);
      if (diff && diff.hunks.length > 0) {
        for (const h of diff.hunks) {
          cards.push({
            file: filePath,
            basename: basename(filePath),
            dirpath: dirpath(filePath),
            hunk: h.header,
            lines: h.lines,
            filePath,
            status,
          });
        }
      } else {
        cards.push({
          file: filePath,
          basename: basename(filePath),
          dirpath: dirpath(filePath),
          hunk: '',
          lines: [],
          filePath,
          status,
        });
      }
    }
    return cards;
  }

  // Count unique files (not hunks) for the column header
  function uniqueFiles(cards: HunkCard[]): number {
    return new Set(cards.map(c => c.filePath)).size;
  }

  const isStaged = (s: string) => s.startsWith('staged-');

  $: unstagedHunks = buildCards(
    Object.entries(state.status).filter(([, s]) => !isStaged(s)),
    state.unstagedDiffs,
  );
  $: stagedHunks = buildCards(
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
  }

  $: stagedCount = Object.values(state.status).filter(s => isStaged(s)).length;
  $: canCommit = stagedCount > 0 && state.commitMessage.trim().length > 0;
</script>

<div class="git-layout">
  <!-- Left column: unstaged -->
  <div class="git-col">
    <div class="git-col-head">
      <Icon name="circle" size={12}/>
      <span>{t('git.unstagedChanges')}</span>
      <span class="count">{uniqueFiles(unstagedHunks)} {t('git.files')}</span>
    </div>
    <div class="hunks-list">
      {#if unstagedHunks.length === 0}
        <div class="empty-hint">
          {state.isLoading ? '...' : t('git.cleanAllStaged')}
        </div>
      {:else}
        {#each unstagedHunks as h}
          <div class="hunk-card {STATUS_CLASS[h.status] ?? ''}">
            <div class="hunk-card-head">
              <span class="status-badge {STATUS_CLASS[h.status] ?? ''}">
                {STATUS_LABEL[h.status] ?? h.status}
              </span>
              <span class="file-info">
                <span class="file-basename">{h.basename}</span>
                {#if h.dirpath}<span class="file-dir">{h.dirpath}</span>{/if}
              </span>
              <button class="stage-btn" on:click={() => stageFile(h.filePath)}>
                {t('git.stage')} →
              </button>
            </div>
            {#if h.lines.length > 0}
              <pre class="hunk-body">{#each h.lines as line}<span class="dl-{line.kind}">{line.kind === 'add' ? '+' : line.kind === 'remove' ? '-' : ' '}{line.content + '\n'}</span>{/each}</pre>
            {:else}
              <div class="hunk-no-preview">{t('git.noDiffPreview')}</div>
            {/if}
          </div>
        {/each}
      {/if}
    </div>
  </div>

  <!-- Right column: staged + commit -->
  <div class="git-col">
    <div class="git-col-head">
      <Icon name="circle-dot" size={12} style="color: var(--accent)"/>
      <span>{t('git.stagedForCommit')}</span>
      <span class="count accent">{uniqueFiles(stagedHunks)} {t('git.files')}</span>
    </div>
    <div class="hunks-list">
      {#if stagedHunks.length === 0}
        <div class="empty-hint">
          {t('git.noStagedChanges')}
        </div>
      {:else}
        {#each stagedHunks as h}
          <div class="hunk-card {STATUS_CLASS[h.status] ?? ''}">
            <div class="hunk-card-head">
              <span class="status-badge {STATUS_CLASS[h.status] ?? ''}">
                {STATUS_LABEL[h.status] ?? h.status}
              </span>
              <span class="file-info">
                <span class="file-basename">{h.basename}</span>
                {#if h.dirpath}<span class="file-dir">{h.dirpath}</span>{/if}
              </span>
              <button class="unstage-btn" on:click={() => unstageFile(h.filePath)}>
                ← {t('git.unstage')}
              </button>
            </div>
            {#if h.lines.length > 0}
              <pre class="hunk-body">{#each h.lines as line}<span class="dl-{line.kind}">{line.kind === 'add' ? '+' : line.kind === 'remove' ? '-' : ' '}{line.content + '\n'}</span>{/each}</pre>
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
        <button class="ai-suggest"><Icon name="sparkles" size={11}/> {t('git.regenerateWithAi')}</button>
      </div>
      <textarea
        class="commit-msg"
        value={state.commitMessage}
        placeholder={t('git.commitPlaceholder') as string}
        on:input={(e) => setCommitMessage((e.target as HTMLTextAreaElement).value)}
      ></textarea>
      <div class="commit-row">
        <span class="remote-label">{remoteLabel}</span>
        <div class="spacer"></div>
        <button class="btn ghost" disabled={!canCommit} on:click={() => commitChanges(state.commitMessage)}>
          <Icon name="save" size={13}/> {t('git.commit')}
        </button>
        <button class="btn primary" disabled={!canCommit} on:click={async () => { await commitChanges(state.commitMessage); await pushBranch(); }}>
          <Icon name="upload" size={13}/> {t('git.commitAndPush')}
        </button>
      </div>
    </div>
  </div>
</div>

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

  .count {
    margin-left: auto;
    font-size: 11px;
    color: var(--fg-4);
  }
  .count.accent { color: var(--accent); }

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

  /* Status badge */
  .status-badge {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    padding: 2px 6px;
    border-radius: 3px;
    flex-shrink: 0;
    background: var(--bg-3);
    color: var(--fg-3);
  }
  .status-badge.status-modified { background: color-mix(in oklch, var(--warning) 15%, transparent); color: var(--warning); }
  .status-badge.status-added    { background: color-mix(in oklch, var(--success) 15%, transparent); color: var(--success); }
  .status-badge.status-deleted  { background: color-mix(in oklch, var(--danger)  15%, transparent); color: var(--danger);  }

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

  /* Stage / unstage buttons */
  .stage-btn, .unstage-btn {
    background: none;
    border: 1px solid var(--stroke-1);
    border-radius: 3px;
    font-size: 11px;
    padding: 3px 8px;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .stage-btn {
    color: var(--fg-2);
    border-color: var(--stroke-1);
  }
  .stage-btn:hover {
    background: var(--accent-weak);
    border-color: var(--accent);
    color: var(--fg-0);
  }

  .unstage-btn {
    color: var(--fg-3);
    border-color: var(--stroke-1);
  }
  .unstage-btn:hover {
    background: var(--bg-4);
    color: var(--fg-0);
    border-color: var(--stroke-2);
  }

  /* Diff body */
  .hunk-body {
    margin: 0;
    padding: 6px 12px;
    font-family: var(--font-mono);
    font-size: 11.5px;
    line-height: 1.6;
    max-height: 260px;
    overflow-x: auto;
    overflow-y: auto;
    min-width: 0;
    background: var(--bg-0);
    border-top: 1px solid var(--stroke-0);
  }

  .dl-add     { color: var(--success); display: block; background: color-mix(in oklch, var(--success) 7%, transparent); }
  .dl-remove  { color: var(--danger);  display: block; background: color-mix(in oklch, var(--danger)  7%, transparent); }
  .dl-context { color: var(--fg-3);    display: block; }

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
</style>
