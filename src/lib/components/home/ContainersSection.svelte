<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import Icon from '#lib/components/Icon.svelte';
  import Spinner from '#lib/components/Spinner.svelte';
  import Skeleton from '#lib/components/Skeleton.svelte';
  import SearchInput from '#lib/components/SearchInput.svelte';
  import SearchEmpty from '#lib/components/SearchEmpty.svelte';
  import CopyButton from '#lib/components/CopyButton.svelte';
  import Select from '#lib/components/Select.svelte';
  import ContainerConfirmModal from '#lib/components/home/ContainerConfirmModal.svelte';
  import ContainerTerminals from '#lib/components/home/ContainerTerminals.svelte';
  import { t, type TranslationKey } from '#lib/i18n';
  import {
    composeDown,
    containerAction,
    containerStats,
    listContainers,
    type Container,
    type ContainerAction,
    type ContainersReport,
    type ContainerStats,
  } from '#lib/services/containers-service';
  import { openUrl } from '#lib/services/opener-service';
  import { activeScreen } from '#lib/stores/ui';
  import { formatBytes, formatDateTimeFull, relativeTime } from '#lib/utils/format';
  import { displayName, formatCpu, groupContainers, portUrl, usageOf, DEFAULT_SORT, type ContainerGroup, type ContainerSort } from '#lib/utils/home/containers';

  const REFRESH_MS = 5000;
  const KNOWN_STATES = ['running', 'paused', 'restarting', 'created', 'exited', 'dead', 'removing'];

  let report: ContainersReport | null = null;
  let isRefreshing = false;
  let query = '';
  let showStopped = false;
  let sort: ContainerSort = DEFAULT_SORT;
  let timer: ReturnType<typeof setInterval> | null = null;
  let busy = new Set<string>();
  let terminals: ContainerTerminals;
  let actionError = '';
  let stats: Map<string, ContainerStats> | null = null;
  let statsTimer: ReturnType<typeof setTimeout> | null = null;
  let isMounted = true;
  let folded = new Set<string>();
  let pending: { kind: 'remove' | 'down'; name: string; containers: string[]; run: () => Promise<void> } | null = null;

  $: containers = report?.containers ?? [];
  $: running = containers.filter((c) => c.state === 'running').length;
  $: statsById = stats ?? new Map<string, ContainerStats>();
  $: groups = groupContainers(containers, query, showStopped, sort, statsById);
  $: total = usageOf(containers, statsById);
  $: unavailable = report && report.status !== 'ok' ? report.status : null;

  async function refresh() {
    try {
      report = await listContainers();
    } catch (e) {
      report = { status: 'error', containers: [], message: String(e) };
    }
  }

  /** `docker stats` takes about two seconds: the next sample waits for the last one. */
  async function pollStats() {
    if (!isMounted) return;
    if (get(activeScreen) === 'home' && report?.status === 'ok' && running > 0) {
      try {
        const sample = await containerStats();
        stats = new Map(sample.map((s) => [s.id, s]));
      } catch {
        stats = stats ?? new Map();
      }
    }
    if (isMounted) statsTimer = setTimeout(pollStats, REFRESH_MS);
  }

  function memoryShare(s: ContainerStats): number {
    return s.memoryLimitBytes > 0 ? Math.min(100, (s.memoryBytes / s.memoryLimitBytes) * 100) : 0;
  }

  async function refreshNow() {
    isRefreshing = true;
    try {
      await refresh();
    } finally {
      isRefreshing = false;
    }
  }

  const STOPPED = ['exited', 'created', 'dead'];
  const isStopped = (c: Container) => STOPPED.includes(c.state);
  const isUp = (c: Container) => c.state === 'running' || c.state === 'restarting';

  /** A group action covers the whole project, stopped containers hidden by the filter included. */
  function projectContainers(group: ContainerGroup): Container[] {
    return containers.filter((c) => c.composeProject === group.project);
  }

  function setBusy(key: string, on: boolean) {
    const next = new Set(busy);
    if (on) next.add(key);
    else next.delete(key);
    busy = next;
  }

  async function perform(key: string, run: () => Promise<void>) {
    setBusy(key, true);
    try {
      await run();
      actionError = '';
    } catch (e) {
      actionError = String(e);
    } finally {
      await refresh();
      setBusy(key, false);
    }
  }

  function act(c: Container, action: ContainerAction) {
    if (action === 'remove') {
      pending = {
        kind: 'remove',
        name: c.name,
        containers: [],
        run: () => perform(c.id, () => containerAction([c.id], 'remove')),
      };
      return;
    }
    void perform(c.id, () => containerAction([c.id], action));
  }

  function actOnProject(group: ContainerGroup, action: ContainerAction | 'down') {
    const all = projectContainers(group);
    const key = `project:${group.project}`;
    if (action === 'down') {
      pending = {
        kind: 'down',
        name: group.project,
        containers: all.map((c) => c.name),
        run: () => perform(key, () => composeDown(group.project)),
      };
      return;
    }
    const targets = all.filter((c) => (action === 'start' ? isStopped(c) : isUp(c)));
    if (targets.length === 0) return;
    void perform(key, () => containerAction(targets.map((c) => c.id), action));
  }

  async function confirmPending() {
    const job = pending;
    pending = null;
    if (job) await job.run();
  }

  function actionLabel(action: string): string {
    return t(`home.containers.action.${action}` as TranslationKey) as string;
  }

  function stateLabel(c: Container): string {
    const label = KNOWN_STATES.includes(c.state)
      ? (t(`home.containers.state.${c.state}` as TranslationKey) as string)
      : c.state;
    if (c.state === 'exited' && c.exitCode !== null && c.exitCode !== 0) {
      return `${label} · ${(t('home.containers.exitedWith') as (n: number) => string)(c.exitCode)}`;
    }
    return label;
  }

  function sortBy(key: string) {
    sort = { key: key as ContainerSort['key'], reversed: sort.key === key ? !sort.reversed : false };
  }

  function directionLabel(sort: ContainerSort): string {
    return t(`home.containers.sort.${sort.key}${sort.reversed ? 'Reversed' : 'Natural'}` as TranslationKey) as string;
  }

  function since(c: Container): string {
    return c.state === 'running' ? c.startedAt : c.finishedAt;
  }

  function toggleGroup(project: string) {
    const next = new Set(folded);
    if (next.has(project)) next.delete(project);
    else next.add(project);
    folded = next;
  }

  function onGroupBarClick(e: MouseEvent, project: string) {
    if ((e.target as HTMLElement).closest('button, .selectable')) return;
    toggleGroup(project);
  }

  onMount(() => {
    void refresh().then(pollStats);
    timer = setInterval(() => { if (get(activeScreen) === 'home') void refresh(); }, REFRESH_MS);
  });

  onDestroy(() => {
    isMounted = false;
    if (timer) clearInterval(timer);
    if (statsTimer) clearTimeout(statsTimer);
  });
</script>

<header class="ct-head">
  <h1>
    {t('home.containers.title')}
    {#if report && !unavailable}
      <span class="head-count">{(t('home.containers.countLabel') as (r: number, n: number) => string)(running, containers.length)}</span>
    {/if}
  </h1>
  {#if !unavailable && stats && running > 0}
    <span class="head-total">{(t('home.containers.memoryTotal') as (s: string) => string)(formatBytes(total.memoryBytes))}</span>
  {/if}
</header>

<div class="containers">
  {#if unavailable}
    <section class="empty unavailable">
      <Icon name="container" size={22} />
      <h2>{t(`home.containers.unavailable.${unavailable}` as TranslationKey)}</h2>
      {#if unavailable !== 'error'}
        <p>{t(`home.containers.unavailable.${unavailable}Hint` as TranslationKey)}</p>
      {/if}
      {#if report?.message}
        <pre class="message selectable">{report.message}</pre>
      {/if}
      <button class="btn" on:click={refreshNow} disabled={isRefreshing}>
        {#if isRefreshing}<Spinner size={11} />{:else}<Icon name="refresh" size={12} />{/if}
        {t('home.containers.refresh')}
      </button>
    </section>
  {:else}
    <div class="ct-bar">
      <SearchInput
        bind:value={query}
        placeholder={t('home.containers.search') as string}
        ariaLabel={t('home.containers.search') as string}
      />
      <div class="sort">
        <button
          class="direction"
          class:reversed={sort.reversed}
          on:click={() => sortBy(sort.key)}
          title={directionLabel(sort)}
          aria-label={directionLabel(sort)}
        >
          <Icon name="sort" size={14} />
        </button>
        <Select
          value={sort.key}
          options={[
            { value: 'name', label: t('home.containers.sort.name') as string },
            { value: 'uptime', label: t('home.containers.sort.uptime') as string },
            { value: 'memory', label: t('home.containers.sort.memory') as string },
            { value: 'cpu', label: t('home.containers.sort.cpu') as string },
          ]}
          ariaLabel={t('home.containers.sort.label') as string}
          on:change={(e) => sortBy(e.detail)}
          on:repick={(e) => sortBy(e.detail)}
        />
      </div>
      <button
        class="chip"
        class:on={showStopped}
        aria-pressed={showStopped}
        on:click={() => (showStopped = !showStopped)}
      >
        {t('home.containers.showStopped')}
      </button>
      <button
        class="btn ghost refresh"
        on:click={refreshNow}
        disabled={isRefreshing}
        title={t('home.containers.refresh') as string}
        aria-label={t('home.containers.refresh') as string}
      >
        {#if isRefreshing}<Spinner size={12} />{:else}<Icon name="refresh" size={13} />{/if}
      </button>
    </div>

    {#if actionError}
      <div class="error" role="alert">
        <div>
          <strong>{t('home.containers.action.failed')}</strong>
          <pre class="selectable">{actionError}</pre>
        </div>
        <button class="icon-btn" on:click={() => (actionError = '')} title={t('home.containers.action.dismiss') as string} aria-label={t('home.containers.action.dismiss') as string}>
          <Icon name="x" size={12} />
        </button>
      </div>
    {/if}

    {#if !report}
      <Skeleton lines={6} height={30} gap={4} />
    {:else if groups.length === 0 && query.trim()}
      <SearchEmpty
        title={t('home.containers.noMatch') as string}
        text={(t('home.containers.noMatchText') as (q: string) => string)(query.trim())}
        clearLabel={t('common.clearSearch') as string}
        on:clear={() => (query = '')}
      />
    {:else if groups.length === 0}
      <section class="empty">
        <Icon name="container" size={22} />
        {#if containers.length > 0}
          <h2>{t('home.containers.noRunning')}</h2>
          <p>{t('home.containers.noRunningDesc')}</p>
        {:else}
          <h2>{t('home.containers.empty')}</h2>
          <p>{t('home.containers.emptyDesc')}</p>
        {/if}
      </section>
    {:else}
      <div class="frame">
        <table>
          <thead>
            <tr>
              <th class="name-col">{t('home.containers.col.name')}</th>
              <th class="image">{t('home.containers.col.image')}</th>
              <th class="state">{t('home.containers.col.state')}</th>
              <th class="ports">{t('home.containers.col.ports')}</th>
              <th class="cpu" title={t('home.containers.cpuHint') as string}>{t('home.containers.col.cpu')}</th>
              <th class="memory">{t('home.containers.col.memory')}</th>
              <th class="since">{t('home.containers.col.since')}</th>
              <th class="actions"><span class="sr-only">{t('home.containers.col.actions')}</span></th>
            </tr>
          </thead>
          {#each groups as group (group.project)}
            {@const isFolded = folded.has(group.project) && !query.trim()}
            {@const groupName = group.project || (t('home.containers.standalone') as string)}
            <tbody class="group">
              <tr class="group-head">
                <th colspan="8" scope="rowgroup">
                  <!-- svelte-ignore a11y-click-events-have-key-events -->
                  <!-- svelte-ignore a11y-no-static-element-interactions -->
                  <div class="group-bar" on:click={(e) => onGroupBarClick(e, group.project)}>
                    <button
                      class="chevron-btn"
                      aria-expanded={!isFolded}
                      aria-label={(t('home.containers.toggleGroup') as (n: string) => string)(groupName)}
                      on:click={() => toggleGroup(group.project)}
                    >
                      <span class="chevron" class:collapsed={isFolded}><Icon name="chev-d" size={13} /></span>
                    </button>
                    <Icon name={group.project ? 'layers' : 'box'} size={14} />
                    <span class="project selectable">{groupName}</span>
                    {#if group.workingDir}
                      <span class="dir selectable" title={group.workingDir}>{group.workingDir}</span>
                    {/if}
                    <span class="group-count">{group.running}/{group.containers.length}</span>
                    <span class="spacer"></span>
                    {#if stats && group.running > 0}
                      {@const usage = usageOf(group.containers, statsById)}
                      <span class="group-usage" title={t('home.containers.cpuHint') as string}>
                        {formatCpu(usage.cpuPercent)} · {formatBytes(usage.memoryBytes)}
                      </span>
                    {/if}
                    {#if group.project}
                      <span class="group-actions">
                        {#if busy.has(`project:${group.project}`)}
                          <Spinner size={12} />
                        {:else}
                          {#if projectContainers(group).some(isStopped)}
                            <button class="icon-btn" on:click={() => actOnProject(group, 'start')} title={actionLabel('startAll')} aria-label={actionLabel('startAll')}>
                              <Icon name="play" size={12} />
                            </button>
                          {/if}
                          {#if projectContainers(group).some(isUp)}
                            <button class="icon-btn" on:click={() => actOnProject(group, 'restart')} title={actionLabel('restartAll')} aria-label={actionLabel('restartAll')}>
                              <Icon name="refresh" size={12} />
                            </button>
                            <button class="icon-btn" on:click={() => actOnProject(group, 'stop')} title={actionLabel('stopAll')} aria-label={actionLabel('stopAll')}>
                              <Icon name="stop" size={12} />
                            </button>
                          {/if}
                          <button class="icon-btn danger" on:click={() => actOnProject(group, 'down')} title={actionLabel('downProject')} aria-label={actionLabel('downProject')}>
                            <Icon name="trash" size={12} />
                          </button>
                        {/if}
                      </span>
                    {/if}
                  </div>
                </th>
              </tr>
              {#if !isFolded}
                {#each group.containers as c (c.id)}
                  <tr class="row" class:stopped={c.state !== 'running'}>
                    <td class="name-col" title={c.name}>
                      <span class="name-cell">
                        <span class="dot {c.state} {c.health}" aria-hidden="true"></span>
                        <span class="name selectable">{displayName(c)}</span>
                        <CopyButton value={c.name} />
                      </span>
                    </td>
                    <td class="image mono dim selectable" title={c.image}>{c.image}</td>
                    <td class="state" title={c.status}>
                      {stateLabel(c)}
                      {#if c.health}
                        <span class="health {c.health}">{t(`home.containers.health.${c.health}` as TranslationKey)}</span>
                      {/if}
                    </td>
                    <td class="ports">
                      {#each c.ports as p (`${p.hostIp}:${p.hostPort}/${p.protocol}`)}
                        {#if p.protocol === 'tcp' && c.state === 'running'}
                          <button
                            class="port-link mono"
                            title={(t('home.containers.openPort') as (u: string) => string)(portUrl(p))}
                            on:click={() => openUrl(portUrl(p))}
                          >{p.hostPort}<span class="dim">→{p.containerPort}</span></button>
                        {:else}
                          <span class="port mono dim">{p.hostPort}→{p.containerPort}/{p.protocol}</span>
                        {/if}
                      {/each}
                    </td>
                    {#if c.state !== 'running'}
                      <td class="cpu"></td>
                      <td class="memory"></td>
                    {:else if !stats}
                      <td class="cpu"><Spinner size={10} /></td>
                      <td class="memory"><Spinner size={10} /></td>
                    {:else}
                      {@const s = stats.get(c.id)}
                      <td class="cpu mono">{s ? formatCpu(s.cpuPercent) : ''}</td>
                      <td class="memory">
                        {#if s}
                          <span
                            class="memory-cell"
                            title={(t('home.containers.memoryOfLimit') as (u: string, l: string) => string)(formatBytes(s.memoryBytes), formatBytes(s.memoryLimitBytes))}
                          >
                            <span class="mono">{formatBytes(s.memoryBytes)}</span>
                            <span class="meter" class:high={memoryShare(s) >= 80} aria-hidden="true">
                              <span style="width: {memoryShare(s)}%"></span>
                            </span>
                          </span>
                        {/if}
                      </td>
                    {/if}
                    <td class="since dim" title={since(c) ? formatDateTimeFull(since(c)) : ''}>
                      {since(c) ? relativeTime(since(c)) : ''}
                    </td>
                    <td class="actions">
                      <span class="row-actions">
                        <button class="icon-btn" on:click={() => terminals.open(c, 'logs')} title={actionLabel('logs')} aria-label={actionLabel('logs')}>
                          <Icon name="list" size={12} />
                        </button>
                        {#if c.state === 'running'}
                          <button class="icon-btn" on:click={() => terminals.open(c, 'shell')} title={actionLabel('shell')} aria-label={actionLabel('shell')}>
                            <Icon name="terminal" size={12} />
                          </button>
                        {/if}
                        {#if busy.has(c.id) || busy.has(`project:${c.composeProject}`)}
                          <Spinner size={12} />
                        {:else if isStopped(c)}
                          <button class="icon-btn" on:click={() => act(c, 'start')} title={actionLabel('start')} aria-label={actionLabel('start')}>
                            <Icon name="play" size={12} />
                          </button>
                          <button class="icon-btn danger" on:click={() => act(c, 'remove')} title={actionLabel('remove')} aria-label={actionLabel('remove')}>
                            <Icon name="trash" size={12} />
                          </button>
                        {:else}
                          {#if isUp(c)}
                            <button class="icon-btn" on:click={() => act(c, 'restart')} title={actionLabel('restart')} aria-label={actionLabel('restart')}>
                              <Icon name="refresh" size={12} />
                            </button>
                          {/if}
                          <button class="icon-btn" on:click={() => act(c, 'stop')} title={actionLabel('stop')} aria-label={actionLabel('stop')}>
                            <Icon name="stop" size={12} />
                          </button>
                        {/if}
                      </span>
                    </td>
                  </tr>
                {/each}
              {/if}
            </tbody>
          {/each}
        </table>
      </div>
    {/if}
  {/if}
  <ContainerTerminals bind:this={terminals} />
</div>

{#if pending}
  <ContainerConfirmModal
    kind={pending.kind}
    name={pending.name}
    containers={pending.containers}
    on:close={() => (pending = null)}
    on:confirm={confirmPending}
  />
{/if}

<style>
  .ct-head { display: flex; align-items: center; gap: 12px; margin-bottom: 32px; }
  .ct-head h1 {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0;
    font-family: var(--font-ui);
    font-size: 18px;
    font-weight: 600;
    color: var(--fg-0);
  }
  .head-count {
    padding: 1px 8px;
    font-size: 11.5px;
    font-weight: 400;
    line-height: 1.6;
    color: var(--fg-2);
    background: var(--bg-3);
    border-radius: 10px;
  }
  .head-total { margin-left: auto; font-size: 12px; color: var(--fg-3); }

  .containers { min-width: 0; }

  .ct-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
  .ct-bar :global(.ag-search) { flex: 0 1 320px; height: 28px; box-sizing: border-box; margin: 0; }
  .sort {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .sort :global(.select) { width: 170px; }
  .sort :global(.select-trigger) { height: 28px; box-sizing: border-box; padding-top: 0; padding-bottom: 0; }
  .direction {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: var(--r-sm);
    color: var(--fg-2);
    cursor: pointer;
  }
  .direction:hover { background: var(--bg-2); color: var(--fg-0); }
  .direction :global(.ic) { transition: transform 0.15s; }
  .direction.reversed :global(.ic) { transform: scaleY(-1); }
  .chip {
    height: 28px;
    box-sizing: border-box;
    padding: 0 10px;
    font-size: 12px;
    color: var(--fg-2);
    background: transparent;
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-sm);
    cursor: pointer;
  }
  .chip:hover { background: var(--bg-2); }
  .chip.on {
    color: var(--accent);
    border-color: var(--accent);
    background: var(--accent-weak, var(--bg-2));
  }
  .refresh { width: 28px; height: 28px; padding: 0; justify-content: center; margin-left: auto; }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 64px 0;
    text-align: center;
    color: var(--fg-3);
  }
  .empty h2 { margin: 8px 0 0; font-size: 15px; font-weight: 600; color: var(--fg-0); }
  .empty p { max-width: 52ch; margin: 0; font-size: 13px; line-height: 1.55; color: var(--fg-2); }
  .message {
    max-width: 560px;
    margin: 4px 0;
    padding: 8px 10px;
    background: var(--bg-2);
    border-radius: var(--r-sm);
    font-family: var(--font-mono);
    font-size: 11px;
    white-space: pre-wrap;
    word-break: break-word;
    text-align: left;
  }
  .empty .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
  }

  /* The frame of the projects and ports lists: one border around every group. */
  .frame {
    overflow-x: auto;
    border: 1px solid color-mix(in oklch, var(--stroke-0) 60%, var(--stroke-1));
    border-radius: var(--r-md);
    background: var(--bg-1);
  }
  table {
    width: 100%;
    min-width: 960px;
    border-collapse: collapse;
    table-layout: fixed;
  }
  thead th {
    height: 32px;
    padding: 0 8px;
    text-align: left;
    font-size: 11.5px;
    font-weight: 500;
    color: var(--fg-3);
    border-bottom: 1px solid var(--stroke-1);
  }
  thead th.name-col { padding-left: 16px; }

  .group-head th {
    padding: 0;
    text-align: left;
    font-weight: normal;
    background: var(--bg-0);
    border-top: 1px solid var(--stroke-0);
  }
  tbody:first-of-type .group-head th { border-top: 0; }
  .group-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 38px;
    padding: 0 10px 0 8px;
    color: var(--fg-3);
    cursor: pointer;
  }
  .chevron-btn {
    display: flex;
    align-items: center;
    padding: 2px;
    color: var(--fg-3);
    border-radius: var(--r-sm);
    flex-shrink: 0;
  }
  .chevron-btn:hover { color: var(--fg-0); background: var(--bg-3); }
  .chevron { display: inline-flex; transition: transform 0.15s; }
  .chevron.collapsed { transform: rotate(-90deg); }
  .project {
    font-size: 12px;
    font-weight: 600;
    color: var(--fg-1);
    flex-shrink: 0;
  }
  .dir {
    min-width: 0;
    font-size: 11px;
    font-family: var(--font-mono);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .group-count {
    padding: 0 6px;
    font-size: 11px;
    color: var(--fg-2);
    background: var(--bg-3);
    border-radius: 8px;
    flex-shrink: 0;
  }
  .spacer { flex: 1; }
  .group-usage { font-size: 11px; white-space: nowrap; }
  .group-actions {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  td {
    height: 40px;
    padding: 0 8px;
    font-size: 12px;
    color: var(--fg-1);
    border-top: 1px solid var(--stroke-0);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  td.name-col { padding-left: 38px; }
  tr.row:hover td { background: var(--bg-2); }
  tr.stopped td { color: var(--fg-3); }
  .mono { font-family: var(--font-mono); }
  .dim { color: var(--fg-3); }

  .name-col { width: auto; max-width: 0; }
  th.image, td.image { width: 18%; }
  th.state, td.state { width: 130px; }
  th.ports, td.ports { width: 130px; }
  th.since, td.since { width: 64px; text-align: right; }
  th.cpu, td.cpu { width: 60px; text-align: right; }
  th.memory, td.memory { width: 96px; text-align: right; }
  .memory-cell { display: inline-flex; flex-direction: column; align-items: flex-end; gap: 3px; }
  .meter {
    width: 56px;
    height: 3px;
    border-radius: 2px;
    background: var(--bg-3);
    overflow: hidden;
  }
  .meter > span { display: block; height: 100%; background: var(--accent); }
  .meter.high > span { background: var(--danger); }
  th.actions, td.actions { width: 140px; text-align: right; padding-right: 10px; }
  .row-actions {
    display: inline-flex;
    justify-content: flex-end;
    gap: 2px;
    vertical-align: middle;
  }

  .name-cell {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 500;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
    background: var(--fg-4);
  }
  .dot.running { background: var(--success); }
  .dot.running.unhealthy { background: var(--danger); }
  .dot.running.starting,
  .dot.restarting,
  .dot.paused { background: var(--warning); }
  .dot.dead { background: var(--danger); }

  .health {
    margin-left: 4px;
    font-size: 10px;
    color: var(--fg-3);
  }
  .health.unhealthy { color: var(--danger); }
  .health.starting { color: var(--warning); }

  .port-link, .port {
    margin-right: 6px;
    font-size: 11px;
  }
  .port-link {
    padding: 0;
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
  }
  .port-link:hover { text-decoration: underline; }
  .icon-btn:disabled { opacity: 0.45; pointer-events: none; }
  .icon-btn.danger:hover { background: var(--danger-weak); color: var(--danger); }

  .error {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin: 0 0 14px;
    padding: 8px 10px;
    background: var(--danger-weak);
    border-radius: var(--r-sm);
    font-size: 12px;
    color: var(--danger);
  }
  .error > div { flex: 1; min-width: 0; }
  .error pre {
    margin: 4px 0 0;
    font-family: var(--font-mono);
    font-size: 11px;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
</style>
