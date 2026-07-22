<script lang="ts">
  import { tick } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n';
  import { searchInFiles, type SearchMatch } from '$lib/services/file-service';
  import { SEARCH_DEBOUNCE_MS } from '$lib/utils/timing';
  import { basename, parentPathOf } from '$lib/utils/files/files-tree';

  export let worktreePath: string | null;
  export let hidden = false;
  export let onOpen: (path: string, line: number, col: number) => void;
  export let onClose: () => void;

  interface GroupedResult {
    path: string;
    filename: string;
    matches: SearchMatch[];
    collapsed: boolean;
  }

  interface SearchState {
    query: string;
    caseSensitive: boolean;
    isRegex: boolean;
    includeGlob: string;
    excludeGlob: string;
    showFilters: boolean;
  }

  const DEFAULT_EXCLUDE = 'node_modules,dist,target,.git,build,coverage';
  const DEFAULT_STATE: SearchState = { query: '', caseSensitive: false, isRegex: false, includeGlob: '', excludeGlob: DEFAULT_EXCLUDE, showFilters: false };

  const savedStates = new Map<string, SearchState>();

  let query = '';
  let caseSensitive = false;
  let isRegex = false;
  let includeGlob = '';
  let excludeGlob = DEFAULT_EXCLUDE;
  let showFilters = false;

  let results: SearchMatch[] = [];
  let groups: GroupedResult[] = [];
  let searching = false;
  let error = '';
  let debounceTimer: ReturnType<typeof setTimeout>;
  let queryInputEl: HTMLInputElement | null = null;
  let lastWorktreePath: string | null = null;
  let lastHidden = true;
  let searchToken = 0;

  $: if (!hidden) tick().then(() => queryInputEl?.focus());

  function captureState(): SearchState {
    return { query, caseSensitive, isRegex, includeGlob, excludeGlob, showFilters };
  }

  function applyState(s: SearchState) {
    query = s.query;
    caseSensitive = s.caseSensitive;
    isRegex = s.isRegex;
    includeGlob = s.includeGlob;
    excludeGlob = s.excludeGlob;
    showFilters = s.showFilters;
  }

  function groupResults(matches: SearchMatch[]): GroupedResult[] {
    const map = new Map<string, SearchMatch[]>();
    for (const m of matches) {
      if (!map.has(m.path)) map.set(m.path, []);
      map.get(m.path)!.push(m);
    }
    return Array.from(map.entries()).map(([path, ms]) => ({
      path,
      filename: basename(path),
      matches: ms,
      collapsed: false,
    }));
  }

  async function runSearch() {
    if (hidden || !worktreePath || !query.trim()) {
      results = [];
      groups = [];
      return;
    }
    const token = ++searchToken;
    searching = true;
    error = '';
    try {
      const matches = await searchInFiles(worktreePath, query, {
        caseSensitive,
        isRegex,
        includeGlob,
        excludeGlob,
      });
      if (token !== searchToken) return;
      results = matches;
      groups = groupResults(results);
    } catch (e) {
      if (token !== searchToken) return;
      error = String(e);
      results = [];
      groups = [];
    } finally {
      if (token === searchToken) searching = false;
    }
  }

  function scheduleSearch() {
    if (hidden) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runSearch, SEARCH_DEBOUNCE_MS);
  }

  $: if (worktreePath !== lastWorktreePath) {
    if (lastWorktreePath !== null) savedStates.set(lastWorktreePath, captureState());
    lastWorktreePath = worktreePath;
    searchToken++;
    results = [];
    groups = [];
    error = '';
    applyState(worktreePath ? (savedStates.get(worktreePath) ?? DEFAULT_STATE) : DEFAULT_STATE);
    scheduleSearch();
  }

  $: if (hidden !== lastHidden) {
    lastHidden = hidden;
    if (hidden) {
      clearTimeout(debounceTimer);
      searchToken++;
      searching = false;
    } else {
      scheduleSearch();
    }
  }

  $: query, caseSensitive, isRegex, includeGlob, excludeGlob, scheduleSearch();

  function toggleGroup(path: string) {
    groups = groups.map(g => g.path === path ? { ...g, collapsed: !g.collapsed } : g);
  }

  function highlightMatch(match: SearchMatch): [string, string, string] {
    const trimmed = match.text.trimStart();
    const offset = match.text.length - trimmed.length;
    const s = Math.max(0, match.matchStart - offset);
    const e = Math.max(s, match.matchEnd - offset);
    return [trimmed.slice(0, s), trimmed.slice(s, e), trimmed.slice(e)];
  }

  function expandAll() { groups = groups.map(g => ({ ...g, collapsed: false })); }
  function collapseAll() { groups = groups.map(g => ({ ...g, collapsed: true })); }

  $: resultCount = results.length;
  $: fileCount = groups.length;
  $: capped = resultCount >= 2000;
</script>

<div class="search-panel" class:search-panel-hidden={hidden}>
  <div class="search-header">
    <Icon name="search" size={12} />
    <span class="search-title">{t('search.title')}</span>
    <div class="search-header-actions">
      <button
        type="button"
        class="search-icon-btn {showFilters ? 'active' : ''}"
        title={t('search.toggleFilters') as string}
        on:click={() => { showFilters = !showFilters; }}
        aria-label={t('search.toggleFilters') as string}
      >
        <Icon name="settings" size={13} />
      </button>
      {#if groups.length > 0}
        <button type="button" class="search-icon-btn" title={t('search.expandAll') as string} on:click={expandAll} aria-label={t('search.expandAll') as string}>
          <Icon name="chev-d" size={13} />
        </button>
        <button type="button" class="search-icon-btn" title={t('search.collapseAll') as string} on:click={collapseAll} aria-label={t('search.collapseAll') as string}>
          <Icon name="chev-r" size={13} />
        </button>
      {/if}
      <button type="button" class="search-icon-btn" on:click={onClose} aria-label={t('search.closeSearch') as string}>
        <Icon name="x" size={13} />
      </button>
    </div>
  </div>

  <div class="search-inputs">
    <div class="search-query-row">
      <input
        bind:this={queryInputEl}
        bind:value={query}
        class="search-input"
        placeholder={t('search.placeholder') as string}
        spellcheck="false"
        on:keydown={(e) => { if (e.key === 'Escape') { query = ''; onClose(); } }}
      />
      <button
        type="button"
        class="toggle-btn {caseSensitive ? 'on' : ''}"
        title={t('search.caseSensitive') as string}
        on:click={() => { caseSensitive = !caseSensitive; }}
        aria-label={t('search.caseSensitive') as string}
        aria-pressed={caseSensitive}
      >Aa</button>
      <button
        type="button"
        class="toggle-btn {isRegex ? 'on' : ''}"
        title={t('search.regularExpression') as string}
        on:click={() => { isRegex = !isRegex; }}
        aria-label={t('search.regularExpression') as string}
        aria-pressed={isRegex}
      >.*</button>
    </div>

    {#if showFilters}
      <div class="filter-row">
        <input
          bind:value={includeGlob}
          class="search-input search-input-sm"
          placeholder={t('search.includePlaceholder') as string}
          spellcheck="false"
        />
      </div>
      <div class="filter-row">
        <input
          bind:value={excludeGlob}
          class="search-input search-input-sm"
          placeholder={t('search.excludePlaceholder') as string}
          spellcheck="false"
        />
      </div>
    {/if}
  </div>

  <div class="search-summary">
    {#if searching}
      <span class="summary-text dimmed">{t('search.searching')}</span>
    {:else if error}
      <span class="summary-text error">{error}</span>
    {:else if query.trim() && resultCount === 0}
      <span class="summary-text dimmed">{t('search.noResults')}</span>
    {:else if resultCount > 0}
      <span class="summary-text">
        {(t('search.resultsSummary') as (count: number, files: number) => string)(capped ? 2000 : resultCount, fileCount)}{capped ? '+' : ''}
        {#if capped}<span class="summary-capped">{t('search.capped')}</span>{/if}
      </span>
    {/if}
  </div>

  <div class="search-results">
    {#each groups as group (group.path)}
      <div class="result-group">
        <button
          type="button"
          class="result-file-header"
          on:click={() => toggleGroup(group.path)}
          title={group.path}
        >
          <Icon name={group.collapsed ? 'chev-r' : 'chev-d'} size={12} />
          <Icon name="file-code" size={13} />
          <span class="result-filename">{group.filename}</span>
          <span class="result-dir">{parentPathOf(group.path)}</span>
          <span class="result-count">{group.matches.length}</span>
        </button>

        {#if !group.collapsed}
          {#each group.matches as match}
            {@const [pre, hit, post] = highlightMatch(match)}
            <button
              type="button"
              class="result-match"
              on:click={() => onOpen(match.path, match.line, match.col)}
              title="{match.path}:{match.line}:{match.col}"
            >
              <span class="result-lineno">{match.line}</span>
              <span class="result-text">
                <span class="result-pre">{pre}</span><span class="result-hit">{hit}</span><span class="result-post">{post}</span>
              </span>
            </button>
          {/each}
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  .search-panel {
    display: flex;
    flex-direction: column;
    width: 280px;
    flex-shrink: 0;
    background: var(--bg-1);
    border-right: 1px solid var(--stroke-0);
    overflow: hidden;
  }
  .search-panel-hidden { display: none; }

  /* -- Header -- */
  .search-header {
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
  .search-title { flex: 1; }
  .search-header-actions { display: flex; gap: 2px; margin-left: auto; }
  .search-icon-btn {
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
  }
  .search-icon-btn:hover { background: var(--bg-4); color: var(--fg-0); }
  .search-icon-btn.active { background: var(--bg-3); color: var(--accent); }

  /* -- Inputs -- */
  .search-inputs {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 0 8px 8px;
    flex-shrink: 0;
    border-bottom: 1px solid var(--stroke-0);
  }
  .search-query-row {
    display: flex;
    align-items: center;
    gap: 4px;
    background: var(--bg-3);
    border: 1px solid var(--stroke-0);
    border-radius: 5px;
    padding: 0 4px 0 0;
    transition: border-color 0.1s;
  }
  .search-query-row:focus-within { border-color: var(--accent); }
  .search-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: var(--fg-0);
    font-size: 12.5px;
    font-family: var(--font-ui);
    padding: 6px 8px;
    min-width: 0;
  }
  .search-input::placeholder { color: var(--fg-4); }
  .search-input-sm {
    background: var(--bg-3);
    border: 1px solid var(--stroke-0);
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 12px;
    color: var(--fg-1);
    width: 100%;
    box-sizing: border-box;
    transition: border-color 0.1s;
  }
  .search-input-sm:focus { border-color: var(--accent); color: var(--fg-0); outline: none; }
  .search-input-sm::placeholder { color: var(--fg-4); }
  .filter-row { display: flex; }

  .toggle-btn {
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    border: none;
    background: none;
    border-radius: 3px;
    cursor: pointer;
    color: var(--fg-3);
    font-size: 11px;
    font-family: var(--font-mono);
    font-weight: 600;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition: background 0.1s, color 0.1s;
  }
  .toggle-btn:hover { background: var(--bg-4); color: var(--fg-1); }
  .toggle-btn.on { background: var(--accent-weak); color: var(--accent); }

  /* -- Summary -- */
  .search-summary {
    padding: 5px 10px 4px;
    flex-shrink: 0;
    min-height: 22px;
  }
  .summary-text {
    font-size: 11px;
    font-family: var(--font-mono);
    color: var(--fg-2);
  }
  .summary-text.dimmed { color: var(--fg-4); }
  .summary-text.error { color: oklch(0.70 0.18 15); }
  .summary-capped { color: var(--fg-4); }

  /* -- Results -- */
  .search-results {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding-bottom: 12px;
  }
  .search-results::-webkit-scrollbar { width: 6px; }
  .search-results::-webkit-scrollbar-track { background: transparent; }
  .search-results::-webkit-scrollbar-thumb { background: var(--bg-4); border-radius: 3px; }

  .result-group { border-bottom: 1px solid var(--stroke-0); }
  .result-file-header {
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
  .result-file-header:hover { background: var(--bg-3); }
  .result-filename {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex-shrink: 0;
    max-width: 120px;
  }
  .result-dir {
    color: var(--fg-4);
    font-size: 10.5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
    font-family: var(--font-mono);
  }
  .result-count {
    flex-shrink: 0;
    font-size: 10px;
    font-family: var(--font-mono);
    color: var(--fg-3);
    background: var(--bg-4);
    border-radius: 8px;
    padding: 1px 6px;
    margin-left: auto;
  }

  .result-match {
    display: flex;
    align-items: baseline;
    gap: 0;
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
    overflow: hidden;
  }
  .result-match:hover { background: var(--bg-3); color: var(--fg-0); }
  .result-lineno {
    flex-shrink: 0;
    width: 38px;
    text-align: right;
    padding-right: 10px;
    color: var(--fg-4);
    font-size: 11px;
  }
  .result-text {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .result-pre, .result-post { color: var(--fg-3); }
  .result-match:hover .result-pre,
  .result-match:hover .result-post { color: var(--fg-1); }
  .result-hit {
    color: var(--fg-0);
    background: oklch(0.55 0.18 70 / 0.35);
    border-radius: 2px;
  }
</style>
