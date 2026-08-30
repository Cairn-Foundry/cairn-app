<script lang="ts">
  /**
   * Tests step: the suite tree on the left, counters and the selected test's
   * failure output on the right. Results come from the runner detected in the
   * active instance's worktree.
   */
  import { createEventDispatcher } from 'svelte';
  import { fade } from 'svelte/transition';
  import Icon from '$lib/components/Icon.svelte';
  import Select from '$lib/components/Select.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import { t } from '$lib/i18n';
  import { activeInstance } from '$lib/stores/instance';
  import { activeProjectId } from '$lib/stores/project';
  import {
    countCases, loadTests, runTests, selectCase, selectRunner, setFilter, setSearch,
    stopTests, tests, testStateFor,
  } from '$lib/stores/tests';
  import { runnerKey, type TestCase } from '$lib/types/tests';
  import {
    caseLabel, countVisible, filterSuites, matchesFilter, parseQuery, splitHighlight,
    type TestFilter,
  } from '$lib/utils/tests/test-search';
  import { supportsFileScope } from '$lib/utils/tests/test-scope';
  import { buildTestFixPrompt } from '$lib/utils/tests/test-fix-prompt';
  import { requestAgentDraft } from '$lib/stores/agent-draft';
  import { aiEnabled } from '$lib/stores/settings';
  import { activeStep } from '$lib/stores/ui';
  import { IS_WINDOWS } from '$lib/utils/platform';

  const dispatch = createEventDispatcher<{ openFile: { path: string; line: number } }>();

  const FILTERS: TestFilter[] = ['all', 'failed', 'passed', 'skipped'];

  let showInternal = false;
  let collapsed = new Set<string>();
  let loadedKey = '';

  $: projectId = $activeProjectId ?? '';
  $: instance = $activeInstance;
  $: state = testStateFor($tests, projectId, instance?.id ?? '');

  // A monorepo exposes several packages, each with its own engines. The two
  // selects split that: where to run, then what to run it with.
  $: selectedRunner = state.runners.find((entry) => runnerKey(entry) === state.selectedRunnerId);
  $: selectedSubdir = selectedRunner?.subdir ?? '';
  $: environments = [...new Set(state.runners.map((entry) => entry.subdir))].map((subdir) => ({
    subdir,
    label: subdir || (t('tests.rootEnvironment') as string),
  }));
  $: runnersHere = state.runners.filter((entry) => entry.subdir === selectedSubdir);

  function selectEnvironment(subdir: string): void {
    const target = state.runners.find((entry) => entry.subdir === subdir);
    if (target && instance) selectRunner(projectId, instance.id, runnerKey(target));
  }
  $: busy = state.activeRunId !== '';
  $: counts = countCases(state.suites);
  $: runner = state.runners.find((entry) => entry.id === state.selectedRunnerId) ?? null;

  // Detection runs once per instance, and again whenever the worktree changes.
  $: if (projectId && instance?.worktreePath) {
    const key = `${projectId}:${instance.id}:${instance.worktreePath}`;
    if (key !== loadedKey) {
      loadedKey = key;
      void loadTests(projectId, instance.id, instance.worktreePath);
    }
  }

  $: terms = parseQuery(state.search);
  $: visibleSuites = filterSuites(state.suites, state.search, state.filter);
  $: visibleCount = countVisible(visibleSuites);
  $: searching = state.search.trim() !== '';

  /** How many tests each filter would show, so a chip says what it costs. */
  $: filterCounts = {
    all: state.suites.reduce((n, s) => n + s.cases.length, 0),
    failed: countFor('failed'),
    passed: countFor('passed'),
    skipped: countFor('skipped'),
  };

  function countFor(filter: TestFilter): number {
    return state.suites.reduce(
      (total, suite) => total + suite.cases.filter((c) => matchesFilter(c, filter)).length,
      0,
    );
  }

  function filterLabel(filter: TestFilter): string {
    if (filter === 'failed') return t('tests.filterFailed') as string;
    if (filter === 'passed') return t('tests.filterPassed') as string;
    if (filter === 'skipped') return t('tests.filterSkipped') as string;
    return t('tests.filterAll') as string;
  }

  $: selected = state.suites
    .flatMap((suite) => suite.cases)
    .find((entry) => entry.id === state.selectedCaseId) ?? null;

  /** The frames worth showing: the project's own, unless the user asked for all. */
  $: frames = selected?.failure
    ? (showInternal ? selected.failure.stack : selected.failure.stack.filter((f) => f.inProject))
    : [];

  // A search reveals what it matched: a folded suite cannot hide a hit.
  $: shownCollapsed = searching ? new Set<string>() : collapsed;
  $: allCollapsed = state.suites.length > 0 && collapsed.size >= state.suites.length;
  $: canScopeFile = runner !== null && supportsFileScope(runner.id);
  // A runner names a test only once it has finished, so the live signal lives
  // at the file level: a known file that has not reported yet is still working.
  // The store decides what is still working; the view only renders it.
  $: pending = new Set(state.pending);

  function toggleSuite(file: string) {
    const next = new Set(collapsed);
    if (next.has(file)) next.delete(file);
    else next.add(file);
    collapsed = next;
  }

  function updateSearch(value: string) {
    if (instance) setSearch(projectId, instance.id, value);
  }

  function resetView() {
    if (!instance) return;
    setSearch(projectId, instance.id, '');
    setFilter(projectId, instance.id, 'all');
  }

  function pick(entry: TestCase) {
    if (!instance) return;
    selectCase(projectId, instance.id, entry.id);
  }

  function start() {
    if (!instance?.worktreePath) return;
    void runTests(projectId, instance.id, instance.worktreePath);
  }

  /** Re-runs only the selected test, leaving the rest of the tree in place. */
  function rerunCase() {
    if (!instance?.worktreePath || !selected) return;
    void runTests(projectId, instance.id, instance.worktreePath, {
      kind: 'case', file: selected.file, name: selected.name,
    });
  }

  /**
   * Hands the failure to the Agent step as a ready-made prompt, and switches to
   * it. Nothing is sent: the user reads the prompt and decides what to say
   * about it - whether the code or the test is what is wrong is their call.
   */
  function fixWithAi() {
    if (!instance || !selected || !runner) return;
    requestAgentDraft(
      instance.id,
      buildTestFixPrompt(selected, runner.id, runner.command, IS_WINDOWS),
    );
    activeStep.set('agent');
  }

  /** Re-runs every test of one file. */
  function rerunFile(file?: string) {
    const target = file ?? selected?.file;
    if (!instance?.worktreePath || !target) return;
    void runTests(projectId, instance.id, instance.worktreePath, {
      kind: 'file', file: target,
    });
  }

  function collapseAll() {
    collapsed = new Set(state.suites.map((suite) => suite.file));
  }

  function expandAll() {
    collapsed = new Set();
  }

  function stop() {
    if (!instance) return;
    void stopTests(projectId, instance.id);
  }

  /** Resolves a runner-relative path against the worktree before opening it. */
  function openAt(file: string, line: number | null) {
    if (!instance?.worktreePath || !file) return;
    const path = file.startsWith('/') || /^[a-zA-Z]:/.test(file)
      ? file
      : `${instance.worktreePath}/${file}`;
    dispatch('openFile', { path, line: line ?? 1 });
  }

  function openSelected() {
    if (!selected) return;
    openAt(selected.file, selected.failure?.location?.line ?? selected.line);
  }

  function formatDuration(ms: number | null): string {
    return ms === null ? '-' : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
  }

  function suiteName(file: string): string {
    return file.split('/').pop() ?? file;
  }

  /** `file / describe` above the test name, as the mock showed it. */
  function trail(entry: TestCase, file: string): string {
    return [suiteName(file).replace(/\.(test|spec)\.[a-z]+$/, ''), ...entry.ancestors].join(' / ');
  }
</script>

<style>
  /* Search and filters share one band, so the list starts near the top. */
  .list-head {
    display: flex; align-items: center; gap: 6px;
    padding: 8px 12px 6px;
  }
  .list-search {
    flex: 1; display: flex; align-items: center; gap: 5px;
    background: var(--bg-0); border: 1px solid var(--stroke-0);
    border-radius: 4px; padding: 3px 7px; min-width: 0; color: var(--fg-4);
  }
  .list-search:focus-within { border-color: var(--accent); color: var(--fg-2); }
  .list-search input {
    flex: 1; min-width: 0; background: none; border: none; outline: none;
    font-size: 11px; color: var(--fg-1); font-family: var(--font-ui);
  }
  .list-search input::placeholder { color: var(--fg-4); }
  .list-search-clear {
    background: none; border: none; color: var(--fg-3); cursor: pointer;
    padding: 0; display: grid; place-items: center;
  }
  .list-search-clear:hover { color: var(--fg-0); }
  /* A toolbar control rather than a form field: the trigger loses its chrome
     and shrinks to the size of the icons it sits between. */
  .runner-select { max-width: 110px; min-width: 0; }
  .runner-select :global(.select-trigger) {
    padding: 2px 4px; gap: 4px;
    background: none; border-color: transparent;
    color: var(--fg-3); font-size: 11px;
  }
  .runner-select :global(.select-trigger:hover:not(:disabled)) {
    background: var(--bg-3); color: var(--fg-0);
  }

  .filter-row { display: flex; gap: 4px; padding: 0 12px 8px; flex-wrap: wrap; }
  .chip {
    display: flex; align-items: center; gap: 5px;
    padding: 3px 8px; background: none; border: 1px solid var(--stroke-0);
    border-radius: 99px; font-size: 11px; color: var(--fg-2);
    cursor: pointer; font-family: var(--font-ui);
  }
  .chip:hover { background: var(--bg-3); color: var(--fg-0); }
  .chip.active { background: var(--accent-weak); border-color: var(--accent-line); color: var(--fg-0); }
  .chip-count { font-size: 10px; color: var(--fg-3); font-family: var(--font-mono); }

  /* The shared .test-group-head is a text-only label: laying it out as a row
     here keeps the caret and the count off the uppercase letter-spacing. */
  .group-head {
    display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0;
    padding: 10px 16px 6px; background: none; border: none; cursor: pointer;
    text-align: left; color: var(--fg-3);
  }
  .group-row { display: flex; align-items: center; }
  .group-head:hover { color: var(--fg-1); }
  .run-file {
    background: none; border: none; color: var(--fg-4); cursor: pointer;
    padding: 10px 16px 6px 0; display: grid; place-items: center; flex: none;
  }
  .run-file:hover { color: var(--fg-0); }
  .run-file:disabled { opacity: 0.4; cursor: default; }
  .run-file:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .collapse-toggle {
    background: none; border: none; color: var(--fg-3); cursor: pointer;
    padding: 3px 4px; display: grid; place-items: center; flex: none;
  }
  .collapse-toggle:hover { color: var(--fg-0); }
  .group-head .file-name {
    font-family: var(--font-mono); font-size: 10px;
    letter-spacing: 0.08em; text-transform: uppercase;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .group-head .count.working { color: var(--accent); }
  .group-head .count {
    font-family: var(--font-mono); font-size: 10px; color: var(--fg-4);
  }
  .group-head .caret { display: grid; place-items: center; flex: none; }
  .group-head.has-fail .file-name { color: var(--danger); }

  .test-row .name :global(mark) {
    background: var(--accent-weak); color: var(--fg-0); border-radius: 2px;
  }
  /* A file being replayed still shows its previous results, dimmed, rather
     than vanishing and making the list jump. */
  .test-row.stale { opacity: 0.45; }
  .test-row:focus-visible, .group-head:focus-visible {
    outline: 2px solid var(--accent); outline-offset: -2px;
  }

  .suite-error {
    margin: 2px 16px 8px 34px; padding: 6px 9px; font-size: 11.5px;
    color: var(--danger); background: var(--bg-2); border-radius: var(--r-sm);
    font-family: var(--font-mono); white-space: pre-wrap; word-break: break-word;
    overflow-x: hidden; line-height: 1.5;
  }

  .list-empty {
    padding: 20px 16px; color: var(--fg-3); font-size: 11.5px;
    text-align: center; display: flex; flex-direction: column; gap: 8px; align-items: center;
  }
  .list-empty button {
    background: none; border: 1px solid var(--stroke-0); border-radius: var(--r-sm);
    color: var(--fg-2); font-size: 11px; padding: 3px 10px; cursor: pointer;
  }
  .list-empty button:hover { background: var(--bg-3); color: var(--fg-0); }
  .result-count { padding: 0 16px 6px; font-size: 10.5px; color: var(--fg-4); }

  .actions-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .frames { margin: 0 0 14px; display: flex; flex-direction: column; align-items: flex-start; }
  .frame {
    background: none; border: none; color: var(--fg-2);
    font-family: var(--font-mono); font-size: 11.5px; padding: 2px 0; cursor: pointer;
  }
  .frame:hover { color: var(--accent); text-decoration: underline; }
  .frame.external { color: var(--fg-3); }
  .frames .more {
    background: none; border: none; color: var(--fg-3);
    font-size: 11px; cursor: pointer; padding: 4px 0;
  }
  .frames .more:hover { color: var(--fg-1); }
  .test-file { background: none; border: none; text-align: left; cursor: pointer; }
  .test-file:hover { color: var(--accent); text-decoration: underline; }
  .empty-state {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 8px; height: 100%; padding: 32px; text-align: center; color: var(--fg-3);
  }
  .empty-state .title { color: var(--fg-1); font-size: 13px; }
  .empty-state .body { font-size: 12px; max-width: 400px; line-height: 1.6; }
</style>

<div class="tests-layout">
  <aside class="tests-list">
    <div class="list-head">
      <div class="list-search">
        <Icon name="search" size={11}/>
        <input
          class="selectable"
          value={state.search}
          placeholder={t('tests.searchPlaceholder') as string}
          on:input={(e) => updateSearch(e.currentTarget.value)}
          on:keydown={(e) => e.key === 'Escape' && updateSearch('')}
        />
        {#if state.search}
          <button
            class="list-search-clear"
            aria-label={t('tests.clearSearch') as string}
            title={t('tests.clearSearch') as string}
            on:click={() => updateSearch('')}
          ><Icon name="x" size={11}/></button>
        {/if}
      </div>
      {#if state.suites.length > 0}
        <button
          class="collapse-toggle"
          title={allCollapsed ? t('tests.expandAll') as string : t('tests.collapseAll') as string}
          aria-label={allCollapsed ? t('tests.expandAll') as string : t('tests.collapseAll') as string}
          on:click={() => allCollapsed ? expandAll() : collapseAll()}
        ><Icon name={allCollapsed ? 'expand-all' : 'collapse-all'} size={13}/></button>
      {/if}
      {#if environments.length > 1}
        <span class="runner-select">
          <Select
            value={selectedSubdir}
            options={environments.map((env) => ({ value: env.subdir, label: env.label }))}
            ariaLabel={t('tests.environment') as string}
            on:change={(e) => selectEnvironment(e.detail)}
          />
        </span>
      {/if}
      {#if runnersHere.length > 1}
        <span class="runner-select">
          <Select
            value={state.selectedRunnerId}
            options={runnersHere.map((entry) => ({ value: runnerKey(entry), label: entry.label }))}
            ariaLabel={t('tests.runner') as string}
            on:change={(e) => instance && selectRunner(projectId, instance.id, e.detail)}
          />
        </span>
      {/if}
    </div>

    <div class="filter-row">
      {#each FILTERS as filter}
        <button
          class="chip {state.filter === filter ? 'active' : ''}"
          on:click={() => instance && setFilter(projectId, instance.id, filter)}
        >
          {filterLabel(filter)}
          <span class="chip-count">{filterCounts[filter]}</span>
        </button>
      {/each}
    </div>

    {#if (state.detecting || busy) && state.suites.length === 0}
      <div style="padding: 4px 12px;"><Skeleton lines={7} /></div>
    {:else if visibleSuites.length === 0 && state.suites.length > 0}
      <div class="list-empty">
        <span>{t('tests.noMatch')}</span>
        <button on:click={resetView}>{t('tests.resetView')}</button>
      </div>
    {:else}
      {#if searching}
        <div class="result-count">
          {(t('tests.resultCount') as (n: number) => string)(visibleCount)}
        </div>
      {/if}
      {#each visibleSuites as suite (suite.file)}
        <div class="group-row">
          <button
            class="group-head {suite.status === 'fail' ? 'has-fail' : ''}"
            title={suite.file}
            on:click={() => toggleSuite(suite.file)}
          >
            <span class="caret">
              {#if pending.has(suite.file)}
                <Spinner size={11} stroke={1.5} trackColor="currentColor" color="transparent" />
              {:else}
                <Icon name={shownCollapsed.has(suite.file) ? 'chev-r' : 'chev-d'} size={11}/>
              {/if}
            </span>
            <span class="file-name">{suiteName(suite.file)}</span>
            <span class="count">{suite.cases.length}</span>
            {#if pending.has(suite.file)}
              <span class="count working">{t('tests.working')}</span>
            {/if}
          </button>
          {#if canScopeFile}
            <button
              class="run-file"
              title={t('tests.reRunFile') as string}
              aria-label={t('tests.reRunFile') as string}
              disabled={busy}
              on:click={() => rerunFile(suite.file)}
            ><Icon name="refresh" size={11}/></button>
          {/if}
        </div>

        {#if !shownCollapsed.has(suite.file)}
          {@const stale = pending.has(suite.file)}
          {#if suite.error}
            <div class="suite-error selectable">{suite.error}</div>
          {/if}
          {#each suite.cases as entry (entry.id)}
            <div
              class="test-row {entry.status} {entry.id === state.selectedCaseId ? 'active' : ''} {stale ? 'stale' : ''}"
              in:fade={{ duration: 140 }}
              role="button"
              tabindex="0"
              on:click={() => pick(entry)}
              on:keydown={(e) => e.key === 'Enter' && pick(entry)}
            >
              <span class="status">
                {#if entry.status === 'pass'}<Icon name="check" size={12}/>
                {:else if entry.status === 'fail'}<Icon name="x" size={12}/>
                {:else}<Icon name="circle" size={10}/>
                {/if}
              </span>
              <span class="name">
                {#each splitHighlight(caseLabel(entry), terms) as part}
                  {#if part.hit}<mark>{part.text}</mark>{:else}{part.text}{/if}
                {/each}
              </span>
            </div>
          {/each}
        {/if}
      {/each}
    {/if}
  </aside>

  <div class="test-detail">
    <div class="test-summary">
      <div class="kpi pass">
        <div class="k-num">{counts.pass}</div>
        <div class="k-label">{t('tests.passing')}</div>
      </div>
      <div class="kpi fail">
        <div class="k-num">{counts.fail}</div>
        <div class="k-label">{t('tests.failing')}</div>
      </div>
      <div class="kpi">
        <div class="k-num">{counts.skip + counts.todo}</div>
        <div class="k-label">{t('tests.skipped')}</div>
      </div>
      <div class="kpi">
        <div class="k-num">{formatDuration(state.summary?.durationMs ?? null)}</div>
        <div class="k-label">{t('tests.duration')}</div>
      </div>
      <div class="spacer"></div>
      {#if busy}
        <Spinner size={13} />
        <button class="btn" on:click={stop}><Icon name="x" size={13}/> {t('tests.stop')}</button>
      {:else}
        <button class="btn primary" on:click={start} disabled={!runner}>
          <Icon name="play" size={12}/> {t('tests.runAll')}
        </button>
      {/if}
    </div>

    <div class="test-output">
      {#if state.runners.length === 0 && !state.detecting}
        <div class="empty-state">
          <Icon name="tests" size={24}/>
          <div class="title">{t('tests.noRunnerTitle')}</div>
          <div class="body">{t('tests.noRunnerBody')}</div>
        </div>
      {:else if state.error}
        <div class="empty-state">
          <div class="title">{t('tests.runnerFailed')}</div>
          <div class="body selectable">{state.error}</div>
        </div>
      {:else if state.suites.length === 0 && !busy}
        <div class="empty-state">
          <Icon name="tests" size={24}/>
          <div class="title">{t('tests.neverRun')}</div>
          <div class="body">{t('tests.neverRunBody')}</div>
        </div>
      {:else if !selected}
        <div class="empty-state"><div class="body">{t('tests.noSelection')}</div></div>
      {:else}
        <div class="test-name-big">
          <span class="suite">{trail(selected, selected.file)}</span> &middot; {selected.name}
        </div>
        <button class="test-file selectable" on:click={openSelected}>
          {selected.file}{selected.failure?.location?.line ?? selected.line
            ? `:${selected.failure?.location?.line ?? selected.line}`
            : ''}
        </button>

        {#if selected.status === 'fail' && selected.failure}
          <div class="log-block"><span class="dim">  &bull; </span> <span class="red">{selected.name}</span>
{#if selected.failure.expected !== null || selected.failure.received !== null}
<span class="dim">    Expected: </span>{selected.failure.expected ?? '-'}
<span class="dim">    Received: </span><span class="red">{selected.failure.received ?? '-'}</span>
{/if}
{selected.failure.message}</div>

          {#if frames.length > 0}
            <div class="frames">
              {#each frames as frame}
                <button
                  class="frame {frame.inProject ? '' : 'external'}"
                  on:click={() => openAt(frame.file, frame.line)}
                >at {frame.file}:{frame.line}:{frame.column}</button>
              {/each}
              {#if selected.failure.stack.some((f) => !f.inProject)}
                <button class="more" on:click={() => showInternal = !showInternal}>
                  {t('tests.showInternalFrames')}
                </button>
              {/if}
            </div>
          {/if}
        {:else if selected.status === 'pass'}
          <div class="log-block"><span class="green">  &check; </span> {(t('tests.passedIn') as (d: string) => string)(formatDuration(selected.durationMs))}</div>
        {:else}
          <div class="log-block"><span class="dim">  &ndash; {t('tests.skipped')}</span></div>
        {/if}

        <div class="actions-row">
          {#if selected.status === 'fail' && $aiEnabled}
            <button class="btn ai-btn" on:click={fixWithAi} disabled={!runner}>
              <Icon name="sparkles" size={13}/> {t('tests.fixWithAi')}
            </button>
          {/if}
          <button class="btn" on:click={rerunCase} disabled={busy}>
            <Icon name="refresh" size={13}/> {t('tests.reRunTest')}
          </button>
          {#if canScopeFile}
            <button class="btn ghost" on:click={() => rerunFile()} disabled={busy}>
              <Icon name="refresh" size={13}/> {t('tests.reRunFile')}
            </button>
          {/if}
          <button class="btn ghost" on:click={openSelected}>
            <Icon name="file" size={13}/> {t('tests.openSource')}
          </button>
        </div>

      {/if}
    </div>
  </div>
</div>
