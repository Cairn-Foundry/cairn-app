<script lang="ts">
  /**
   * Renders diff hunks as numbered rows, paginated so a large diff does not build every row at once.
   * Read-only: no staging, no selection.
   */
  import type { GitDiffHunk } from '$lib/services/git-service';
  import { t } from '$lib/i18n';

  export let hunks: GitDiffHunk[] = [];

  const PAGE = 300;
  let shown = PAGE;

  // Collapse back to the first page whenever the hunks themselves change, not on every reactive pass.
  let lastSignature = '';
  $: signature =
    hunks.map(h => `${h.header}:${h.lines.length}`).join('|');
  $: if (signature !== lastSignature) {
    lastSignature = signature;
    shown = PAGE;
  }

  type Row =
    | { kind: 'sep'; header: string }
    | { kind: 'add' | 'remove' | 'context'; oldNo: number | null; newNo: number | null; content: string };

  /** Reads the starting old and new line numbers out of an @@ hunk header, falling back to 1 when it does not parse. */
  function parseHeader(header: string): { oldStart: number; newStart: number } {
    const m = header.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    return {
      oldStart: m ? Number(m[1]) : 1,
      newStart: m ? Number(m[2]) : 1,
    };
  }

  /** Flattens the hunks into display rows, walking each side's counter so added and removed lines only advance their own. */
  $: rows = ((): Row[] => {
    const out: Row[] = [];
    hunks.forEach((hunk, i) => {
      const { oldStart, newStart } = parseHeader(hunk.header);
      if (i > 0) out.push({ kind: 'sep', header: hunk.header });
      let oldNo = oldStart;
      let newNo = newStart;
      for (const line of hunk.lines) {
        if (line.kind === 'add') {
          out.push({ kind: 'add', oldNo: null, newNo, content: line.content });
          newNo++;
        } else if (line.kind === 'remove') {
          out.push({ kind: 'remove', oldNo, newNo: null, content: line.content });
          oldNo++;
        } else {
          out.push({ kind: 'context', oldNo, newNo, content: line.content });
          oldNo++;
          newNo++;
        }
      }
    });
    return out;
  })();

  $: hidden = Math.max(0, rows.length - shown);
</script>

<div class="git-diff">
  {#each rows.slice(0, shown) as row}
    {#if row.kind === 'sep'}
      <div class="diff-sep">{row.header}</div>
    {:else}
      <div class="diff-row diff-{row.kind}">
        <span class="gutter">{row.oldNo ?? ''}</span>
        <span class="gutter">{row.newNo ?? ''}</span>
        <span class="sign">{row.kind === 'add' ? '+' : row.kind === 'remove' ? '-' : ''}</span>
        <span class="content selectable">{row.content || ' '}</span>
      </div>
    {/if}
  {/each}
  {#if hidden > 0}
    <button class="diff-more" on:click={() => (shown += PAGE)}>
      {(t('git.showMoreLines') as (n: number) => string)(hidden)}
    </button>
  {/if}
</div>

<style>
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
