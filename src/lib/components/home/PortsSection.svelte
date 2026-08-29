<script lang="ts">
  /**
   * Listening TCP ports of the machine and the processes owning them, with a
   * confirmed kill. Refreshes on a timer while the section is on screen.
   */
  import { onMount, onDestroy } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import SearchInput from '$lib/components/SearchInput.svelte';
  import CopyButton from '$lib/components/CopyButton.svelte';
  import KillProcessModal from '$lib/components/home/KillProcessModal.svelte';
  import { t } from '$lib/i18n';
  import { listListeningPorts, killProcess, type ListeningPort } from '$lib/services/ports-service';
  import { activeScreen } from '$lib/stores/ui';
  import { get } from 'svelte/store';

  const REFRESH_MS = 5000;

  let ports: ListeningPort[] = [];
  let isLoading = true;
  let isRefreshing = false;
  let error = '';
  let query = '';
  let killingPid: number | null = null;
  let pendingKill: ListeningPort | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  $: filtered = ports.filter((p) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      String(p.port).includes(q) ||
      p.process.toLowerCase().includes(q) ||
      p.command.toLowerCase().includes(q) ||
      String(p.pid).includes(q)
    );
  });

  /**
   * The absolute path of the binary is noise - it repeats the process name and
   * pushes the arguments, which is what tells one `node` from another, out of
   * view. Each path-looking token is reduced to its basename.
   */
  function shortCommand(port: ListeningPort): string {
    if (!port.command) return '';
    const short = port.command
      .split(' ')
      .map((token) => (token.startsWith('/') ? (token.split('/').pop() ?? token) : token))
      .join(' ');
    return short === port.process ? '' : short;
  }

  async function refresh() {
    try {
      ports = await listListeningPorts();
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

  /** The list keeps moving under the pointer, so a kill is always confirmed. */
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

  onMount(() => {
    refresh();
    timer = setInterval(() => { if (get(activeScreen) === 'home') void refresh(); }, REFRESH_MS);
  });

  onDestroy(() => {
    if (timer) clearInterval(timer);
  });
</script>

<div class="ports">
  <div class="toolbar">
    <SearchInput
      bind:value={query}
      placeholder={t('home.ports.search') as string}
      ariaLabel={t('home.ports.search') as string}
    />
    <span class="count">
      {(t('home.ports.countLabel') as (n: number) => string)(filtered.length)}
    </span>
    <button
      class="icon-btn"
      on:click={refreshNow}
      disabled={isRefreshing}
      title={t('home.ports.refresh') as string}
      aria-label={t('home.ports.refresh') as string}
    >
      {#if isRefreshing}
        <Spinner size={12} />
      {:else}
        <Icon name="refresh" size={13} />
      {/if}
    </button>
  </div>

  {#if error}
    <p class="error selectable">{error}</p>
  {/if}

  {#if isLoading}
    <Skeleton lines={6} height={30} gap={4} />
  {:else if filtered.length === 0}
    <p class="empty">{query ? t('home.ports.noMatch') : t('home.ports.empty')}</p>
  {:else}
    <div class="scroller">
      <table>
        <thead>
          <tr>
            <th class="num">{t('home.ports.col.port')}</th>
            <th>{t('home.ports.col.process')}</th>
            <th class="addr">{t('home.ports.col.address')}</th>
            <th class="num">{t('home.ports.col.pid')}</th>
            <th class="actions"><span class="sr-only">{t('home.ports.col.actions')}</span></th>
          </tr>
        </thead>
        <tbody>
          {#each filtered as port (port.id)}
            <tr>
              <td class="num mono port selectable">{port.port}</td>
              <td title={port.command || port.process}>
                <span class="proc">
                  <span class="name selectable">{port.process || '-'}</span>
                  {#if shortCommand(port)}
                    <span class="cmd dim selectable">{shortCommand(port)}</span>
                  {/if}
                </span>
              </td>
              <td class="addr mono dim selectable">
                {port.address}<span class="family">{port.family}</span>
              </td>
              <td class="num mono">
                <span class="pid-cell">
                  <span class="selectable">{port.pid}</span>
                  <CopyButton value={String(port.pid)} />
                </span>
              </td>
              <td class="actions">
                {#if killingPid === port.pid}
                  <Spinner size={12} />
                {:else if port.isOwned}
                  <button
                    class="icon-btn danger"
                    on:click={() => (pendingKill = port)}
                    title={t('home.ports.kill') as string}
                    aria-label={t('home.ports.kill') as string}
                  >
                    <Icon name="x" size={13} />
                  </button>
                {:else}
                  <span class="foreign" title={t('home.ports.notOwned') as string}>
                    <Icon name="lock" size={12} />
                  </span>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

{#if pendingKill}
  <KillProcessModal
    port={pendingKill}
    on:close={() => (pendingKill = null)}
    on:confirm={(e) => confirmKill(e.detail.force)}
  />
{/if}

<style>
  .ports { min-width: 0; }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 18px;
  }
  .toolbar :global(.ag-search) {
    flex: 1;
    margin: 0;
    max-width: 320px;
  }
  .count {
    flex: 1;
    font-size: 11px;
    color: var(--fg-3);
  }

  .error {
    margin: 0 0 10px;
    padding: 8px 10px;
    background: var(--danger-weak);
    border-radius: var(--r-sm);
    font-size: 12px;
    color: var(--danger);
  }
  .empty {
    margin: 0;
    padding: 28px 0;
    text-align: center;
    font-size: 12px;
    color: var(--fg-3);
  }

  .scroller {
    overflow-x: auto;
  }
  table {
    width: 100%;
    min-width: 560px;
    border-collapse: collapse;
    table-layout: fixed;
  }
  th {
    padding: 0 8px 8px;
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
  .num { text-align: right; }
  .mono { font-family: var(--font-mono); }
  .dim { color: var(--fg-3); }

  th:first-child, td:first-child { width: 72px; }
  /* The one flexible column; `max-width: 0` is what makes a fixed-layout cell
     actually clip its content instead of pushing the neighbours out. */
  th:nth-child(2), td:nth-child(2) { width: auto; max-width: 0; }
  th.addr, td.addr { width: 150px; }
  th.num:not(:first-child), td.num:not(:first-child) { width: 92px; }
  th.actions, td.actions { width: 44px; text-align: right; }
  td.actions { overflow: visible; }

  .port { color: var(--accent); font-weight: 600; }
  /* Name and arguments share one line: the list stays scannable at a glance
     rather than doubling in height for a path nobody reads. The flex box is a
     span inside the cell, never the cell itself - `display: flex` on a `td`
     drops it out of the table layout, and it stops honouring its column. */
  .proc {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }
  .name { flex-shrink: 0; }
  .cmd {
    min-width: 0;
    font-size: 10.5px;
    font-family: var(--font-mono);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .family {
    margin-left: 6px;
    font-size: 9.5px;
    color: var(--fg-4);
  }
  .pid-cell {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .foreign { color: var(--fg-4); }
  .icon-btn.danger:hover { background: var(--danger-weak); color: var(--danger); }
  .icon-btn:disabled { opacity: 0.45; pointer-events: none; }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
</style>
