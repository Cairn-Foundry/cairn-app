<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * The listening TCP ports of the machine, gathered by the process holding
   * them - stopping a process frees all of its ports, so the process is the
   * row. The user's own processes come first and can be stopped, after a
   * confirmation; the others follow, dimmed, with their owner. Refreshes on a timer while the
   * section is on screen.
   */
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import Icon from '#lib/components/Icon.svelte';
  import Spinner from '#lib/components/Spinner.svelte';
  import Skeleton from '#lib/components/Skeleton.svelte';
  import SearchInput from '#lib/components/SearchInput.svelte';
  import SearchEmpty from '#lib/components/SearchEmpty.svelte';
  import CopyButton from '#lib/components/CopyButton.svelte';
  import KillProcessModal from '#lib/components/home/KillProcessModal.svelte';
  import { t } from '#lib/i18n';
  import { listListeningPorts, killProcess, type ListeningPort } from '#lib/services/ports-service';
  import { groupByProcess, matchesProcess, shortCommand, type ProcessPorts } from '#lib/utils/home/ports';
  import { activeScreen } from '#lib/stores/ui';

  const REFRESH_MS = 5000;

  let sockets: ListeningPort[] = [];
  let isLoading = true;
  let isRefreshing = false;
  let error = '';
  let query = '';
  let killingPid: number | null = null;
  let pendingKill: ProcessPorts | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  $: processes = groupByProcess(sockets);
  $: visible = processes.filter((group) => matchesProcess(group, query));
  $: portCount = processes.reduce((n, p) => n + p.ports.length, 0);

  async function refresh() {
    try {
      sockets = await listListeningPorts();
      error = '';
    } catch (e) {
      error = String(e);
    } finally {
      isLoading = false;
    }
  }

  /** The timer refreshes silently; only an explicit click shows the spinner. */
  async function refreshNow() {
    isRefreshing = true;
    try {
      await refresh();
    } finally {
      isRefreshing = false;
    }
  }

  /** The list keeps moving under the pointer, so a stop is always confirmed. */
  async function confirmKill(force: boolean) {
    const target = pendingKill;
    pendingKill = null;
    if (!target) return;
    killingPid = target.pid;
    try {
      await killProcess(target.pid, force);
      error = '';
      await new Promise((r) => setTimeout(r, 400));
      await refresh();
    } catch (e) {
      error = String(e);
    } finally {
      killingPid = null;
    }
  }

  function addressLabel(addresses: string[]): string {
    return addresses.join(', ');
  }

  onMount(() => {
    void refresh();
    timer = setInterval(() => { if (get(activeScreen) === 'home') void refresh(); }, REFRESH_MS);
  });

  onDestroy(() => {
    if (timer) clearInterval(timer);
  });
</script>

<header class="pp-head">
  <h1>
    {t('home.ports.title')}
    {#if !isLoading}<span class="head-count">{(t('home.ports.countLabel') as (n: number) => string)(portCount)}</span>{/if}
  </h1>
  <span class="live">{t('home.ports.live')}</span>
</header>

<div class="pp-bar">
  <SearchInput bind:value={query} placeholder={t('home.ports.search') as string} ariaLabel={t('home.ports.search') as string}/>
  <button
    class="btn ghost refresh"
    on:click={refreshNow}
    disabled={isRefreshing}
    title={t('home.ports.refresh') as string}
    aria-label={t('home.ports.refresh') as string}
  >
    {#if isRefreshing}<Spinner size={12}/>{:else}<Icon name="refresh" size={13}/>{/if}
  </button>
</div>

{#if error}
  <p class="error selectable"><Icon name="alert" size={13}/>{error}</p>
{/if}

{#if isLoading}
  <div class="pp-list" aria-hidden="true">
    {#each { length: 4 } as _, i (i)}
      <div class="proc-row is-skeleton">
        <Skeleton width="28px" height={28}/>
        <Skeleton width="{[40, 55, 35, 48][i]}%" height={10}/>
        <Skeleton width="120px" height={10}/>
      </div>
    {/each}
  </div>
{:else if processes.length === 0}
  <section class="empty">
    <Icon name="server" size={22}/>
    <h2>{t('home.ports.empty')}</h2>
    <p>{t('home.ports.emptyDesc')}</p>
  </section>
{:else if visible.length === 0}
  <SearchEmpty
    title={t('home.ports.noMatch') as string}
    text={(t('home.ports.noMatchText') as (q: string) => string)(query.trim())}
    clearLabel={t('common.clearSearch') as string}
    on:clear={() => (query = '')}
  />
{:else}
  <div class="pp-list" role="table" aria-label={t('home.ports.title') as string}>
    <div class="col-head" role="row">
      <span class="col-process" role="columnheader">{t('home.ports.col.process')}</span>
      <span class="col-ports" role="columnheader">{t('home.ports.col.ports')}</span>
      <span role="columnheader">{t('home.ports.col.pid')}</span>
      <span class="col-actions" role="columnheader"><span class="sr-only">{t('home.ports.col.actions')}</span></span>
    </div>
    {#each visible as proc (proc.pid)}
        {@const command = shortCommand(proc.process, proc.command)}
        <div class="proc-row" class:is-foreign={!proc.isOwned}>
          <span class="tile"><Icon name="terminal" size={13}/></span>
          <div class="proc-text" title={proc.command || proc.process}>
            <span class="name selectable">{proc.process || '-'}</span>
            {#if command}<span class="cmd selectable">{command}</span>{/if}
          </div>
          <div class="ports">
            {#each proc.ports as held (held.port)}
              <span
                class="port-chip"
                class:is-exposed={held.isExposed}
                title={held.isExposed
                  ? (t('home.ports.exposed') as (a: string) => string)(addressLabel(held.addresses))
                  : (t('home.ports.local') as (a: string) => string)(addressLabel(held.addresses))}
              >
                {#if held.isExposed}<Icon name="globe" size={11}/>{/if}
                <span class="port selectable">{held.port}</span>
              </span>
            {/each}
          </div>
          <span class="pid">
            <span class="selectable">{proc.pid}</span>
            <CopyButton value={String(proc.pid)}/>
          </span>
          <span class="actions">
            {#if killingPid === proc.pid}
              <Spinner size={12}/>
            {:else if proc.isOwned}
              <button
                class="btn stop"
                on:click={() => (pendingKill = proc)}
                aria-label={(t('home.ports.killLabel') as (n: string) => string)(proc.process || String(proc.pid))}
              >
                <Icon name="x" size={12}/> {t('home.ports.kill')}
              </button>
            {:else}
              <span class="foreign" title={t('home.ports.notOwned') as string}>
                <Icon name="lock" size={12}/> {proc.user}
              </span>
            {/if}
          </span>
        </div>
    {/each}
  </div>
{/if}

{#if pendingKill}
  <KillProcessModal
    target={pendingKill}
    on:close={() => (pendingKill = null)}
    on:confirm={(e) => confirmKill(e.detail.force)}
  />
{/if}

<style>
  .pp-head { display: flex; align-items: center; gap: 12px; margin-bottom: 32px; }
  .pp-head h1 {
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
  .live { margin-left: auto; font-size: 12px; color: var(--fg-3); }

  .pp-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
  .pp-bar :global(.ag-search) { flex: 0 1 320px; height: 28px; box-sizing: border-box; margin: 0; }
  .refresh { width: 28px; height: 28px; padding: 0; justify-content: center; margin-left: auto; }

  .error {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 8px;
    padding: 9px 12px;
    border-radius: var(--r-sm);
    background: var(--danger-weak);
    font-size: 12px;
    color: var(--danger);
  }

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

  /* One grid for the whole list: every row lines its columns up through subgrid. */
  .pp-list {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto auto auto;
    column-gap: 16px;
    border: 1px solid color-mix(in oklch, var(--stroke-0) 60%, var(--stroke-1));
    border-radius: var(--r-md);
    background: var(--bg-1);
    overflow: hidden;
  }
  .col-head {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: subgrid;
    align-items: center;
    height: 32px;
    padding: 0 12px 0 16px;
    border-bottom: 1px solid var(--stroke-1);
    font-size: 11.5px;
    font-weight: 500;
    color: var(--fg-3);
  }
  .col-process { grid-column: 1 / 3; }
  .col-ports { text-align: right; }
  .col-actions { min-width: 84px; }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }


  .proc-row {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: subgrid;
    align-items: center;
    min-height: 52px;
    padding: 0 12px 0 16px;
    border-top: 1px solid var(--stroke-0);
  }
  .col-head + .proc-row { border-top: 0; }
  .proc-row:hover { background: var(--bg-2); }
  .proc-row.is-skeleton:hover { background: transparent; }
  .tile {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-sm);
    background: var(--bg-2);
    color: var(--fg-2);
  }
  .proc-row.is-foreign .tile { color: var(--fg-4); }
  .proc-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .name { font-size: 13px; font-weight: 500; color: var(--fg-0); }
  .proc-row.is-foreign .name { color: var(--fg-2); }
  .cmd {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--fg-3);
  }

  .ports { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 4px; }
  .port-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0 7px;
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 22px;
    color: var(--fg-1);
    background: var(--bg-2);
    border: 1px solid var(--stroke-0);
    border-radius: 4px;
  }
  .port-chip.is-exposed { color: var(--warning); border-color: color-mix(in srgb, var(--warning) 35%, transparent); }

  .pid {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--fg-3);
    font-variant-numeric: tabular-nums;
  }
  .actions { display: flex; justify-content: flex-end; min-width: 84px; }
  .stop { height: 26px; padding: 0 9px; }
  .stop:hover { background: var(--danger-weak); color: var(--danger); border-color: transparent; }
  .foreign { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--fg-3); }
</style>
