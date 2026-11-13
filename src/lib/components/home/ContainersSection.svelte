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
  import CopyButton from '#lib/components/CopyButton.svelte';
  import Select from '#lib/components/Select.svelte';
  import { t, type TranslationKey } from '#lib/i18n';
  import { listContainers, type Container, type ContainersReport } from '#lib/services/containers-service';
  import { openUrl } from '#lib/services/opener-service';
  import { activeScreen } from '#lib/stores/ui';
  import { formatDateTimeFull, relativeTime } from '#lib/utils/format';
  import { displayName, groupContainers, portUrl, DEFAULT_SORT, type ContainerSort } from '#lib/utils/home/containers';

  const REFRESH_MS = 5000;
  const KNOWN_STATES = ['running', 'paused', 'restarting', 'created', 'exited', 'dead', 'removing'];

  let report: ContainersReport | null = null;
  let isRefreshing = false;
  let query = '';
  let showStopped = false;
  let sort: ContainerSort = DEFAULT_SORT;
  let timer: ReturnType<typeof setInterval> | null = null;

  $: containers = report?.containers ?? [];
  $: running = containers.filter((c) => c.state === 'running').length;
  $: groups = groupContainers(containers, query, showStopped, sort);
  $: unavailable = report && report.status !== 'ok' ? report.status : null;

  async function refresh() {
    try {
      report = await listContainers();
    } catch (e) {
      report = { status: 'error', containers: [], message: String(e) };
    }
  }

  async function refreshNow() {
    isRefreshing = true;
    try {
      await refresh();
    } finally {
      isRefreshing = false;
    }
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

  function emptyText(): string {
    if (query) return t('home.containers.noMatch') as string;
    if (containers.length > 0 && !showStopped) return t('home.containers.noRunning') as string;
    return t('home.containers.empty') as string;
  }

  onMount(() => {
    refresh();
    timer = setInterval(() => { if (get(activeScreen) === 'home') void refresh(); }, REFRESH_MS);
  });

  onDestroy(() => {
    if (timer) clearInterval(timer);
  });
</script>

<div class="containers">
  {#if unavailable}
    <div class="unavailable">
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
    </div>
  {:else}
    <div class="toolbar">
      <SearchInput
        bind:value={query}
        placeholder={t('home.containers.search') as string}
        ariaLabel={t('home.containers.search') as string}
      />
      <span class="count">
        {#if report}
          {(t('home.containers.countLabel') as (r: number, n: number) => string)(running, containers.length)}
        {/if}
      </span>
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
        class="icon-btn"
        on:click={refreshNow}
        disabled={isRefreshing}
        title={t('home.containers.refresh') as string}
        aria-label={t('home.containers.refresh') as string}
      >
        {#if isRefreshing}
          <Spinner size={12} />
        {:else}
          <Icon name="refresh" size={13} />
        {/if}
      </button>
    </div>

    {#if !report}
      <Skeleton lines={6} height={30} gap={4} />
    {:else if groups.length === 0}
      <p class="empty">{emptyText()}</p>
    {:else}
      {#each groups as group (group.project)}
        <section class="group">
          <header>
            <Icon name={group.project ? 'layers' : 'box'} size={13} />
            <span class="project selectable">{group.project || t('home.containers.standalone')}</span>
            {#if group.workingDir}
              <span class="dir dim selectable" title={group.workingDir}>{group.workingDir}</span>
            {/if}
            <span class="group-count dim">{group.running}/{group.containers.length}</span>
          </header>
          <div class="scroller">
            <table>
              <thead>
                <tr>
                  <th>{t('home.containers.col.name')}</th>
                  <th class="image">{t('home.containers.col.image')}</th>
                  <th class="state">{t('home.containers.col.state')}</th>
                  <th class="ports">{t('home.containers.col.ports')}</th>
                  <th class="since">{t('home.containers.col.since')}</th>
                </tr>
              </thead>
              <tbody>
                {#each group.containers as c (c.id)}
                  <tr class:stopped={c.state !== 'running'}>
                    <td title={c.name}>
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
                    <td class="since dim" title={since(c) ? formatDateTimeFull(since(c)) : ''}>
                      {since(c) ? relativeTime(since(c)) : ''}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </section>
      {/each}
    {/if}
  {/if}
</div>

<style>
  .containers { min-width: 0; }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 18px;
  }
  .toolbar :global(.ag-search) {
    flex: 1;
    margin: 0;
    max-width: 420px;
  }
  .count {
    flex: 1;
    font-size: 11px;
    color: var(--fg-3);
  }
  .sort {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .sort :global(.select) { width: 190px; }
  .direction {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
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
    padding: 8px 10px;
    font-size: 12px;
    color: var(--fg-2);
    background: transparent;
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-sm);
    line-height: 1.25;
    cursor: pointer;
  }
  .chip:hover { background: var(--bg-2); }
  .chip.on {
    color: var(--accent);
    border-color: var(--accent);
    background: var(--accent-weak, var(--bg-2));
  }

  .empty {
    margin: 0;
    padding: 28px 0;
    text-align: center;
    font-size: 12px;
    color: var(--fg-3);
  }

  .unavailable {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 40px 16px;
    text-align: center;
    color: var(--fg-3);
  }
  .unavailable h2 {
    margin: 4px 0 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--fg-1);
  }
  .unavailable p {
    margin: 0;
    max-width: 440px;
    font-size: 12px;
    line-height: 1.5;
  }
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
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
  }

  .group + .group { margin-top: 22px; }
  .group header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
    color: var(--fg-2);
    min-width: 0;
  }
  .project {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--fg-1);
    flex-shrink: 0;
  }
  .dir {
    min-width: 0;
    font-size: 10.5px;
    font-family: var(--font-mono);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .group-count {
    margin-left: auto;
    font-size: 11px;
    flex-shrink: 0;
  }

  .scroller { overflow-x: auto; }
  table {
    width: 100%;
    min-width: 640px;
    border-collapse: collapse;
    table-layout: fixed;
  }
  th {
    padding: 0 8px 6px;
    text-align: left;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--fg-3);
    border-bottom: 1px solid var(--stroke-0);
  }
  td {
    padding: 6px 8px;
    font-size: 11.5px;
    color: var(--fg-1);
    border-bottom: 1px solid var(--stroke-0);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  tbody tr:hover td { background: var(--bg-2); }
  tr:last-child td { border-bottom: none; }
  tr.stopped td { color: var(--fg-3); }
  .mono { font-family: var(--font-mono); }
  .dim { color: var(--fg-3); }

  th:first-child, td:first-child { width: auto; max-width: 0; }
  th.image, td.image { width: 26%; }
  th.state, td.state { width: 150px; }
  th.ports, td.ports { width: 150px; }
  th.since, td.since { width: 80px; text-align: right; }

  .name-cell {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
  }
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
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

  td.ports {
    overflow: hidden;
    text-overflow: ellipsis;
  }
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
</style>
