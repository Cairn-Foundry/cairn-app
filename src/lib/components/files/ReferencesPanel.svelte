<script lang="ts" context="module">
  import type { LspLocation } from '$lib/services/lsp-service';

  export interface ReferencesResult {
    symbol: string;
    definitions: LspLocation[];
    implementations: LspLocation[];
    references: LspLocation[];
  }
</script>

<script lang="ts">
  /**
   * LSP results panel for one symbol: definitions, implementations and usages,
   * grouped per file into collapsible sections. Calls `onOpen` with the picked location.
   */
  import Icon from '$lib/components/Icon.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import { t } from '$lib/i18n';
  import { basename, parentPathOf, pathWithinWorktree } from '$lib/utils/files/files-tree';

  export let hidden = false;
  export let loading = false;
  export let error = '';
  export let result: ReferencesResult | null = null;
  export let worktreePath: string | null;
  export let onOpen: (path: string, line: number, col: number) => void;
  export let onClose: () => void;

  interface Group {
    path: string;
    filename: string;
    dir: string;
    hits: LspLocation[];
    collapsed: boolean;
  }

  interface Section {
    id: 'definitions' | 'implementations' | 'references';
    label: string;
    groups: Group[];
    count: number;
  }

  let collapsedFiles = new Set<string>();
  let collapsedSections = new Set<string>();

  /**
   * The hit's own line, cut around the symbol so a long line still shows what
   * surrounds it rather than its indentation. Split rather than interpolated so
   * the code is set as text and the match can be marked without any HTML.
   */
  const CONTEXT_BEFORE = 24;
  const CONTEXT_AFTER = 56;

  /** Splits the hit line into before/match/after around the symbol, elided on both ends. */
  function excerpt(hit: LspLocation): { before: string; match: string; after: string } | null {
    if (hit.text === null) return null;
    // The backend trimmed the line, so the columns have to move with it.
    const indent = hit.text.length - hit.text.trimStart().length;
    const raw = hit.text.trimStart();
    const from = Math.max(0, hit.character - indent);
    const to = hit.endLine === hit.line ? Math.max(from, hit.endCharacter - indent) : raw.length;

    const start = Math.max(0, from - CONTEXT_BEFORE);
    const end = Math.min(raw.length, to + CONTEXT_AFTER);
    return {
      before: (start > 0 ? '...' : '') + raw.slice(start, from),
      match: raw.slice(from, to),
      after: raw.slice(to, end) + (end < raw.length ? '...' : ''),
    };
  }

  function relative(path: string): string {
    return pathWithinWorktree(path, worktreePath);
  }

  /**
   * Buckets locations by worktree-relative path, line-sorted, keeping the
   * collapsed state. `collapsed` is passed in rather than read from the
   * closure: a function body is opaque to the compiler, so `sections` would
   * never be invalidated by a fold and clicking a file header did nothing.
   */
  function group(
    locations: LspLocation[],
    sectionId: string,
    collapsed: Set<string>,
  ): Group[] {
    const byPath = new Map<string, LspLocation[]>();
    for (const location of locations) {
      const path = relative(location.path);
      if (!byPath.has(path)) byPath.set(path, []);
      byPath.get(path)!.push(location);
    }
    return Array.from(byPath.entries()).map(([path, hits]) => ({
      path,
      filename: basename(path),
      dir: parentPathOf(path),
      hits: hits.slice().sort((a, b) => a.line - b.line),
      collapsed: collapsed.has(`${sectionId}:${path}`),
    }));
  }

  function toggleFile(sectionId: string, path: string) {
    const key = `${sectionId}:${path}`;
    const next = new Set(collapsedFiles);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    collapsedFiles = next;
  }

  function toggleSection(sectionId: string) {
    const next = new Set(collapsedSections);
    if (next.has(sectionId)) next.delete(sectionId);
    else next.add(sectionId);
    collapsedSections = next;
  }

  /** Collapsing the section folds its files too, so reopening it stays legible. */
  function setSectionFiles(section: Section, collapsed: boolean) {
    const next = new Set(collapsedFiles);
    for (const g of section.groups) {
      const key = `${section.id}:${g.path}`;
      if (collapsed) next.add(key);
      else next.delete(key);
    }
    collapsedFiles = next;
  }

  $: sections = (result
    ? [
        { id: 'definitions' as const,     label: t('references.definitions') as string,     locations: result.definitions },
        { id: 'implementations' as const, label: t('references.implementations') as string, locations: result.implementations },
        { id: 'references' as const,      label: t('references.usages') as string,          locations: result.references },
      ]
    : []
  ).map(s => ({
    id: s.id,
    label: s.label,
    groups: group(s.locations, s.id, collapsedFiles),
    count: s.locations.length,
  })) as Section[];

  $: total = sections.reduce((sum, s) => sum + s.count, 0);
</script>

<div class="refs-panel" class:refs-panel-hidden={hidden}>
  <div class="refs-header">
    <Icon name="link" size={12} />
    <span class="refs-title">{t('references.title')}</span>
    <button type="button" class="refs-icon-btn" on:click={onClose} aria-label={t('references.close') as string}>
      <Icon name="x" size={13} />
    </button>
  </div>

  <div class="refs-summary">
    {#if result?.symbol}
      <span class="refs-symbol selectable">{result.symbol}</span>
    {/if}
    {#if error}
      <span class="refs-note error">{error}</span>
    {:else if !loading && result && total === 0}
      <span class="refs-note dimmed">{t('references.noResults')}</span>
    {:else if !loading && !result}
      <span class="refs-note dimmed">{t('references.empty')}</span>
    {/if}
  </div>

  <div class="refs-results">
    {#if loading}
      <div class="refs-skeleton">
        <Skeleton lines={7} height={13} gap={9} />
      </div>
    {:else}
      {#each sections as section (section.id)}
        {#if section.count > 0}
          {@const sectionCollapsed = collapsedSections.has(section.id)}
          {@const allFilesCollapsed = section.groups.every(g => g.collapsed)}
          <div class="refs-section">
            <button
              type="button"
              class="refs-section-title"
              on:click={() => toggleSection(section.id)}
              aria-expanded={!sectionCollapsed}
            >
              <Icon name={sectionCollapsed ? 'chev-r' : 'chev-d'} size={12} />
              <span>{section.label}</span>
            </button>
            <button
              type="button"
              class="refs-icon-btn refs-fold-all"
              title={(allFilesCollapsed ? t('references.expandFiles') : t('references.collapseFiles')) as string}
              aria-label={(allFilesCollapsed ? t('references.expandFiles') : t('references.collapseFiles')) as string}
              on:click={() => setSectionFiles(section, !allFilesCollapsed)}
            >
              <Icon name={allFilesCollapsed ? 'expand-all' : 'collapse-all'} size={12} />
            </button>
            <span class="refs-count refs-section-count">{section.count}</span>
          </div>
          {#each sectionCollapsed ? [] : section.groups as g (g.path)}
            <div class="refs-group">
              <button type="button" class="refs-file" on:click={() => toggleFile(section.id, g.path)} title={g.path}>
                <Icon name={g.collapsed ? 'chev-r' : 'chev-d'} size={12} />
                <Icon name="file-code" size={13} />
                <span class="refs-filename">{g.filename}</span>
                <span class="refs-dir">{g.dir}</span>
                <span class="refs-count">{g.hits.length}</span>
              </button>
              {#if !g.collapsed}
                {#each g.hits as hit}
                  {@const code = excerpt(hit)}
                  <button
                    type="button"
                    class="refs-hit"
                    on:click={() => onOpen(g.path, hit.line + 1, hit.character + 1)}
                    title="{g.path}:{hit.line + 1}:{hit.character + 1}"
                  >
                    <span class="refs-lineno">{hit.line + 1}</span>
                    {#if code}
                      <span class="refs-code">{code.before}<mark>{code.match}</mark>{code.after}</span>
                    {:else}
                      <span class="refs-col">:{hit.character + 1}</span>
                    {/if}
                  </button>
                {/each}
              {/if}
            </div>
          {/each}
        {/if}
      {/each}
    {/if}
  </div>
</div>

<style>
  .refs-panel {
    display: flex;
    flex-direction: column;
    width: 280px;
    flex-shrink: 0;
    background: var(--bg-1);
    border-right: 1px solid var(--stroke-0);
    overflow: hidden;
  }
  .refs-panel-hidden { display: none; }

  .refs-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px 8px;
    font-size: 10px;
    font-family: var(--font-mono);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--fg-3);
    flex-shrink: 0;
  }
  .refs-title { flex: 1; }
  .refs-icon-btn {
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
    margin-left: auto;
  }
  .refs-icon-btn:hover { background: var(--bg-4); color: var(--fg-0); }

  .refs-summary {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 0 10px 8px;
    border-bottom: 1px solid var(--stroke-0);
    flex-shrink: 0;
    min-height: 20px;
  }
  .refs-symbol {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--fg-0);
  }
  .refs-note { font-size: 11px; font-family: var(--font-mono); }
  .refs-note.dimmed { color: var(--fg-4); }
  .refs-note.error { color: var(--danger); }

  .refs-results {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding-bottom: 12px;
  }
  .refs-results::-webkit-scrollbar { width: 6px; }
  .refs-results::-webkit-scrollbar-track { background: transparent; }
  .refs-results::-webkit-scrollbar-thumb { background: var(--bg-4); border-radius: 3px; }

  .refs-skeleton { padding: 10px; }

  .refs-section {
    display: flex;
    align-items: center;
    padding-right: 4px;
  }
  .refs-section-title {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    min-width: 0;
    padding: 8px 4px 4px 6px;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    font-size: 10px;
    font-family: var(--font-mono);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--fg-3);
  }
  .refs-section-title:hover { color: var(--fg-1); }

  .refs-fold-all {
    width: 20px;
    height: 20px;
    margin-left: 0;
    margin-top: 4px;
    flex-shrink: 0;
  }

  .refs-section-count { margin-top: 4px; }

  .refs-group { border-bottom: 1px solid var(--stroke-0); }

  .refs-file {
    display: flex;
    align-items: center;
    gap: 5px;
    width: 100%;
    padding: 5px 8px 5px 6px;
    background: var(--bg-2);
    border: none;
    cursor: pointer;
    text-align: left;
    color: var(--fg-1);
    font-size: 12px;
    font-family: var(--font-ui);
    min-width: 0;
  }
  .refs-file:hover { background: var(--bg-3); }
  .refs-filename {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex-shrink: 0;
    max-width: 120px;
  }
  .refs-dir {
    color: var(--fg-4);
    font-size: 10.5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
    font-family: var(--font-mono);
  }
  .refs-count {
    flex-shrink: 0;
    font-size: 10px;
    font-family: var(--font-mono);
    color: var(--fg-3);
    background: var(--bg-4);
    border-radius: 8px;
    padding: 1px 6px;
    margin-left: auto;
  }

  .refs-hit {
    display: flex;
    align-items: baseline;
    gap: 7px;
    width: 100%;
    padding: 2px 8px 2px 0;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    color: var(--fg-2);
    font-size: 12px;
    font-family: var(--font-mono);
    min-width: 0;
  }
  .refs-hit:hover { background: var(--bg-3); color: var(--fg-0); }
  .refs-lineno {
    flex-shrink: 0;
    width: 38px;
    text-align: right;
    padding-right: 2px;
    color: var(--fg-4);
    font-size: 11px;
  }
  .refs-col { color: var(--fg-4); font-size: 11px; }

  /* One line per hit: the panel is a list to scan, and a wrapped line would
     cost the alignment that makes it scannable. */
  .refs-code {
    flex: 1;
    min-width: 0;
    font-size: 11.5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .refs-code mark {
    background: var(--accent-weak);
    color: var(--accent);
    border-radius: 2px;
  }
</style>
