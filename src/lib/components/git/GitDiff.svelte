<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * Renders diff hunks as numbered rows, paginated so a large diff does not build every row at once.
   * Read-only: no staging, no selection. Given a `side`, the unchanged lines between hunks can be
   * revealed a few at a time, as on GitHub.
   */
  import {
    getFileAtHead,
    getFileInIndex,
    getFileLineCount,
    getFileOnSide,
    type DiffSide,
    type GitDiffHunk,
  } from '$lib/services/git-service';
  import { t } from '$lib/i18n';
  import { langFromPath, readFile } from '$lib/services/file-service';
  import type { EditorLanguage } from '$lib/utils/editor/editor-theme';
  import { cachedLineHtml, highlightDocumentToLines, highlightLineToHtml } from '$lib/utils/git/diff-syntax-highlight';
  import { activeSyntaxTokens, settings } from '$lib/stores/settings';
  import { createEventDispatcher } from 'svelte';
  import { isDiffTooLarge } from '$lib/utils/git/diff-size';
  import Icon from '$lib/components/Icon.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import { recallExpansion, rememberExpansion } from '$lib/utils/git/diff-expansion-memory';
  import {
    EXPAND_STEP,
    buildDiffRows,
    diffGaps,
    expandGap,
    splitFileLines,
    type DiffRow,
    type GapExpansion,
  } from '$lib/utils/git/diff-context';

  export let hunks: GitDiffHunk[] = [];
  export let filePath = '';
  /** Where the new side of the diff lives; null leaves the hunks without expanders. */
  export let side: DiffSide | null = null;
  export let worktreePath = '';
  /** The diff was cut short, so the gaps past its end cannot be trusted. */
  export let truncated = false;
  /** Tells apart two diffs that share a side, path and hunk shapes but not their content, such as stash@{0} before and after a new stash. */
  export let memoryScope = '';

  const dispatch = createEventDispatcher<{ openFile: string }>();

  $: isTooLarge = isDiffTooLarge(hunks, $settings.gitMaxDiffLines);

  $: lang = (filePath ? langFromPath(filePath) : 'text') as EditorLanguage;

  const NESTED_LANGUAGES = new Set(['svelte', 'vue', 'html', 'php']);

  type HighlightedSide = { raw: string[]; html: string[] };
  let oldSide: HighlightedSide | null = null;
  let newSide: HighlightedSide | null = null;

  async function highlightSide(text: string | null, tokens: typeof $activeSyntaxTokens): Promise<HighlightedSide | null> {
    if (text === null) return null;
    return { raw: text.split('\n'), html: await highlightDocumentToLines(text, lang, tokens) };
  }

  let sidesRun = 0;
  /**
   * A nested language (a style or script block in a svelte file) is only known from the lines
   * around a diff line, so those files are highlighted whole and the diff picks its lines out.
   */
  async function loadSides(path: string, wt: string, staged: boolean, tokens: typeof $activeSyntaxTokens): Promise<void> {
    const run = ++sidesRun;
    const [oldText, newText] = await Promise.all([
      (staged ? getFileAtHead(wt, path) : getFileInIndex(wt, path)).catch(() => null),
      (staged ? getFileInIndex(wt, path) : readFile(`${wt}/${path}`)).catch(() => null),
    ]);
    const [oldHighlighted, newHighlighted] = await Promise.all([
      highlightSide(oldText, tokens),
      highlightSide(newText, tokens),
    ]);
    if (run !== sidesRun) return;
    oldSide = oldHighlighted;
    newSide = newHighlighted;
    highlightTick++;
  }

  $: hasWorkingSides = side?.kind === 'worktree' || side?.kind === 'index';
  $: if (worktreePath && filePath && hasWorkingSides && NESTED_LANGUAGES.has(lang)) {
    void loadSides(filePath, worktreePath, side?.kind === 'index', $activeSyntaxTokens);
  } else {
    sidesRun++;
    oldSide = null;
    newSide = null;
  }

  function wholeFileLine(row: { kind: string; oldNo: number | null; newNo: number | null; content: string }, _tick: number): string | undefined {
    const whole = row.kind === 'remove' ? oldSide : newSide;
    const index = (row.kind === 'remove' ? row.oldNo : row.newNo) ?? 0;
    if (!whole || whole.raw[index - 1]?.replace(/\r$/, '') !== row.content) return undefined;
    return whole.html[index - 1];
  }

  let highlightCache = new Map<string, string>();
  $: if ($activeSyntaxTokens) highlightCache = new Map();

  let highlightTick = 0;

  /**
   * Renders a diff line as HTML, syntax-highlighted per the file's language; falls back to
   * escaped text until its highlight resolves. `_tick` is unused but keeps the call reactive:
   * bumping `highlightTick` re-evaluates every call in the each block once a highlight lands.
   */
  function highlightedLine(content: string, _tick: number): string {
    const key = `${lang}:${content}`;
    const cached = highlightCache.get(key) ?? cachedLineHtml(content, lang, $activeSyntaxTokens);
    if (cached !== undefined) return cached;
    const fallback = content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    highlightCache.set(key, fallback);
    void highlightLineToHtml(content, lang, $activeSyntaxTokens).then((html) => {
      highlightCache.set(key, html);
      highlightTick++;
    });
    return fallback;
  }

  const PAGE = 300;
  let shown = PAGE;

  let expansions: GapExpansion[] = [];
  let fileLines: string[] | null = null;
  let fileLength: number | null = null;
  let lengthRequestedFor = '';
  let fileUnavailable = false;
  let loadingGap: number | null = null;
  let loadingDirection: GapDirection = 'down';
  let loadToken = 0;

  // Collapse back to the first page whenever the hunks themselves change, not on every reactive pass.
  let lastSignature = '';
  $: signature =
    `${worktreePath}|${JSON.stringify(side)}|${memoryScope}|${filePath}|` + hunks.map(h => `${h.header}:${h.lines.length}`).join('|');
  $: if (signature !== lastSignature) {
    lastSignature = signature;
    shown = PAGE;
    const saved = recallExpansion(signature);
    expansions = saved?.expansions ?? [];
    fileLines = saved?.fileLines ?? null;
    fileLength = fileLines?.length ?? null;
    fileUnavailable = false;
    loadingGap = null;
    loadToken++;
  }

  $: expandable = side !== null && !!worktreePath && !truncated && !isTooLarge && !fileUnavailable;
  $: gaps = expandable ? diffGaps(hunks, fileLength) : null;

  $: if (gaps && fileLength === null && lengthRequestedFor !== signature) {
    lengthRequestedFor = signature;
    void loadFileLength(signature);
  }

  /** Learns how long the file is up front, so the bottom expander only shows when lines are hidden. */
  async function loadFileLength(forSignature: string) {
    if (!side) return;
    const token = loadToken;
    let length: number | null = null;
    try {
      length = await getFileLineCount(worktreePath, side, filePath);
    } catch {
      length = null;
    }
    if (token !== loadToken || forSignature !== signature) return;
    if (length === null) fileUnavailable = true;
    else fileLength = length;
  }

  $: built = buildDiffRows(hunks, gaps, expansions, fileLines, shown);
  $: rows = built.rows;
  $: hidden = Math.max(0, built.total - shown);

  /** Reveals more of a gap, fetching the file's new side on the first expansion. */
  async function expand(gap: number, direction: 'up' | 'down' | 'all') {
    if (loadingGap !== null || !side) return;
    if (!fileLines) {
      const token = loadToken;
      loadingGap = gap;
      loadingDirection = direction;
      let content: string | null = null;
      try {
        content = await getFileOnSide(worktreePath, side, filePath);
      } catch {
        content = null;
      }
      if (token !== loadToken) return;
      loadingGap = null;
      if (content === null) {
        fileUnavailable = true;
        return;
      }
      fileLines = splitFileLines(content);
    }
    const loaded = diffGaps(hunks, fileLines.length);
    if (!loaded) return;
    expansions = expandGap(expansions, loaded, gap, direction);
    rememberExpansion(signature, { expansions, fileLines });
  }

  type GapRow = Extract<DiffRow, { kind: 'gap' }>;
  type GapDirection = 'up' | 'down' | 'all';
  type GapTarget = { direction: GapDirection; icon: 'chev-u' | 'chev-d' | 'expand-all'; label: string };

  function directionLabel(direction: GapDirection): string {
    return t(direction === 'all' ? 'git.expandAll' : direction === 'down' ? 'git.expandDown' : 'git.expandUp') as string;
  }

  /** One target spans the whole bar; a gap between two hunks splits it in two, down on the left and up on the right. */
  function gapTargets(row: GapRow): GapTarget[] {
    const make = (direction: GapDirection, icon: GapTarget['icon']): GapTarget => ({ direction, icon, label: directionLabel(direction) });
    if (row.up && row.down) {
      if (row.remaining !== null && row.remaining <= EXPAND_STEP) return [make('all', 'expand-all')];
      return [make('down', 'chev-d'), make('up', 'chev-u')];
    }
    return row.down ? [make('down', 'chev-d')] : [make('up', 'chev-u')];
  }
</script>

{#if isTooLarge}
<div class="diff-too-large">
  <span>{t('git.diffTooLarge')}</span>
  <button class="diff-open" on:click={() => dispatch('openFile', filePath)}>
    <Icon name="external" size={12}/>
    {t('git.openInEditor')}
  </button>
</div>
{:else}
<div class="git-diff">
  {#each rows as row}
    {#if row.kind === 'sep'}
      <div class="diff-sep">{row.header}</div>
    {:else if row.kind === 'gap'}
      {@const targets = gapTargets(row)}
      <div class="diff-gap">
        <span class="gap-header">{row.header}</span>
        <span class="gap-hits">
          {#each targets as target}
            <button class="gap-hit" disabled={loadingGap !== null} title={target.label} aria-label={target.label} on:click={() => expand(row.gap, target.direction)}>
              {#if loadingGap === row.gap && loadingDirection === target.direction}
                <span role="status" aria-busy="true" title={target.label} aria-label={target.label}>
                  <Spinner size={11}/>
                </span>
              {:else}
                <Icon name={target.icon} size={12}/>
              {/if}
            </button>
          {/each}
        </span>
      </div>
    {:else}
      <div class="diff-row diff-{row.kind}">
        <span class="gutter">{row.oldNo ?? ''}</span>
        <span class="gutter">{row.newNo ?? ''}</span>
        <span class="sign">{row.kind === 'add' ? '+' : row.kind === 'remove' ? '-' : ''}</span>
        <span class="content selectable">{@html row.content ? (wholeFileLine(row, highlightTick) ?? highlightedLine(row.content, highlightTick)) : ' '}</span>
      </div>
    {/if}
  {/each}
  {#if hidden > 0}
    <button class="diff-more" on:click={() => (shown += PAGE)}>
      {(t('git.showMoreLines') as (n: number) => string)(hidden)}
    </button>
  {/if}
</div>
{/if}

<style>
  .diff-too-large {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px;
    font-size: 12px;
    color: var(--fg-2);
    background: var(--bg-0);
  }

  .diff-open {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border: 1px solid var(--stroke-1);
    border-radius: 6px;
    background: transparent;
    color: var(--fg-1);
    font-size: 12px;
    cursor: pointer;
  }

  .diff-open:hover {
    background: var(--bg-2);
  }

  .git-diff {
    max-height: 320px;
    overflow: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--stroke-1) transparent;
    font-family: var(--font-mono);
    font-size: 11.5px;
    line-height: 1.55;
    background: var(--bg-0);
    font-variant-ligatures: none;
    font-feature-settings: "liga" 0, "calt" 0;
  }

  .diff-row {
    display: flex;
    align-items: baseline;
    white-space: pre;
  }

  .gutter {
    flex-shrink: 0;
    width: 42px;
    padding: 0 6px;
    text-align: right;
    color: var(--fg-4);
  }

  .sign {
    flex-shrink: 0;
    width: 12px;
    text-align: center;
    color: var(--fg-4);
  }

  .content {
    flex: 1;
    min-width: 0;
    padding-right: 10px;
    color: var(--fg-1);
    white-space: pre-wrap;
    word-break: break-word;
  }

  .diff-add {
    background: color-mix(in oklch, var(--success) 10%, transparent);
  }
  .diff-add .sign { color: var(--success); }

  .diff-remove {
    background: color-mix(in oklch, var(--danger) 10%, transparent);
  }
  .diff-remove .sign { color: var(--danger); }

  .diff-more {
    display: block;
    width: 100%;
    padding: 6px;
    border: none;
    border-top: 1px solid var(--stroke-0);
    background: var(--bg-2);
    color: var(--fg-3);
    font-family: inherit;
    font-size: 11px;
    cursor: pointer;
  }
  .diff-more:hover {
    background: var(--bg-3);
    color: var(--fg-1);
  }

  .diff-gap {
    position: relative;
    display: flex;
    align-items: stretch;
    color: var(--fg-4);
    background: color-mix(in oklch, var(--accent) 6%, var(--bg-2));
    border-top: 1px solid var(--stroke-0);
    border-bottom: 1px solid var(--stroke-0);
  }

  .gap-hits {
    position: absolute;
    inset: 0;
    display: flex;
  }

  .gap-hit {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    padding: 0 36px;
    border: none;
    background: transparent;
    color: var(--fg-3);
    cursor: pointer;
  }
  .gap-hit:not(:only-child):last-child {
    justify-content: flex-end;
  }
  .gap-hit:hover:not(:disabled),
  .gap-hit:focus-visible {
    background: color-mix(in oklch, var(--accent) 14%, transparent);
  }
  .gap-hit:disabled {
    cursor: default;
  }

  .gap-header {
    flex: 1;
    min-width: 0;
    padding: 2px 84px;
    min-height: calc(1.55em + 4px);
    white-space: pre;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .diff-sep {
    padding: 2px 10px;
    color: var(--fg-4);
    background: var(--bg-2);
    border-top: 1px solid var(--stroke-0);
    border-bottom: 1px solid var(--stroke-0);
    white-space: pre;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
