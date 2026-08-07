<script lang="ts">
  import { onMount } from 'svelte';
  import CopyButton from '$lib/components/CopyButton.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import { t } from '$lib/i18n';
  import InstallProgress from '$lib/components/InstallProgress.svelte';
  import UninstallServerModal from '$lib/components/home/UninstallServerModal.svelte';
  import { cancelLanguageServerCommand, installLanguageServer, uninstallLanguageServer, uninstallManagerFor, COMMAND_CANCELLED, type LanguageServerInfo, type LanguageServerStatus } from '$lib/services/lsp-service';
  import { activeInstance } from '$lib/stores/instance';
  import { clearManagerOutput, managerOutput, languageServerInfos, languageServerStatuses, liveStatusFor, refreshLanguageServers, setServerEnabled } from '$lib/stores/language-server';
  import { settings } from '$lib/stores/settings';
  import { matchesServerQuery, shortVersion, summarizeExtensions } from '$lib/utils/languages/servers';

  let loading = true;
  let refreshing = false;
  let busyServerId: string | null = null;
  let busyStartedAt = 0;
  let commandErrors: Record<string, string> = {};
  let pendingRemoval: { server: LanguageServerInfo; manager: string | null } | null = null;

  async function reload() {
    refreshing = true;
    await refreshLanguageServers($activeInstance?.worktreePath ?? null);
    refreshing = false;
    loading = false;
  }

  onMount(reload);

  /**
   * Installing is always a click away, never automatic. A server that installs
   * cleanly is a server the user wanted, so it comes back enabled.
   */
  async function install(server: LanguageServerInfo, manager: string) {
    busyServerId = server.id;
    busyStartedAt = Date.now();
    commandErrors = { ...commandErrors, [server.id]: '' };
    clearManagerOutput(server.id);
    try {
      await installLanguageServer(server.id, manager);
      await reload();
      setServerEnabled(server.id, true);
    } catch (e) {
      if (String(e) !== COMMAND_CANCELLED) {
        commandErrors = { ...commandErrors, [server.id]: String(e) };
      }
    } finally {
      busyServerId = null;
      clearManagerOutput(server.id);
    }
  }

  async function askRemoval(server: LanguageServerInfo) {
    const manager = await uninstallManagerFor(server.id).catch(() => null);
    pendingRemoval = { server, manager };
  }

  /** A removed server has nothing left to run, so it is switched off too. */
  async function confirmRemoval() {
    const removal = pendingRemoval;
    pendingRemoval = null;
    if (!removal?.manager) return;
    const { server, manager } = removal;

    busyServerId = server.id;
    busyStartedAt = Date.now();
    commandErrors = { ...commandErrors, [server.id]: '' };
    clearManagerOutput(server.id);
    try {
      await uninstallLanguageServer(server.id, manager);
      setServerEnabled(server.id, false);
      await reload();
    } catch (e) {
      if (String(e) !== COMMAND_CANCELLED) {
        commandErrors = { ...commandErrors, [server.id]: String(e) };
      }
    } finally {
      busyServerId = null;
      clearManagerOutput(server.id);
    }
  }

  function isEnabled(id: string, list: { id: string; enabled: boolean }[]): boolean {
    return list.find(s => s.id === id)?.enabled ?? false;
  }

  /** The live status wins over the one captured when the list was read. */
  function currentStatus(server: LanguageServerInfo): LanguageServerStatus {
    return liveStatusFor($languageServerStatuses, server.id) ?? server.status;
  }

  function installer(server: LanguageServerInfo) {
    return server.installOptions.find(o => o.available) ?? null;
  }

  let query = '';
  $: shownServers = $languageServerInfos.filter(s => matchesServerQuery(s, query));
</script>

<div class="settings-group">
  <div class="ls-group-head">
    <span class="settings-group-title">{t('languageServers.behaviourGroup')}</span>
  </div>
  <div class="settings-row">
    <div class="settings-row-info">
      <span class="settings-row-label">{t('languageServers.suggestOnOpen')}</span>
      <span class="settings-row-desc">{t('languageServers.suggestOnOpenDesc')}</span>
    </div>
    <label class="settings-toggle" aria-label={t('languageServers.suggestOnOpen') as string}>
      <input
        type="checkbox"
        checked={$settings.suggestLanguageServers}
        on:change={(e) => settings.save({ suggestLanguageServers: e.currentTarget.checked })}
      />
      <span class="settings-toggle-track"><span class="settings-toggle-thumb"></span></span>
    </label>
  </div>
</div>

<div class="settings-group">
  <div class="ls-group-head">
    <span class="settings-group-title">{t('languageServers.serversGroup')}</span>
    <div class="ls-search">
      <Icon name="search" size={12}/>
      <input
        class="ls-search-input selectable"
        type="text"
        spellcheck="false"
        autocomplete="off"
        bind:value={query}
        placeholder={t('languageServers.searchPlaceholder') as string}
        aria-label={t('languageServers.searchPlaceholder') as string}
      />
      {#if query}
        <button
          type="button"
          class="ls-search-clear"
          on:click={() => { query = ''; }}
          aria-label={t('common.clearSearch') as string}
          title={t('common.clearSearch') as string}
        >
          <Icon name="x" size={12}/>
        </button>
      {/if}
    </div>
    <button type="button" class="btn ghost ls-rescan" on:click={reload} disabled={refreshing}>
      {#if refreshing}<Spinner size={11}/>{:else}<Icon name="refresh" size={12}/>{/if}
      {t('languageServers.rescan')}
    </button>
  </div>

  {#if loading}
    <Skeleton lines={6} height={46} gap={6}/>
  {:else if shownServers.length === 0}
    <div class="ls-empty">
      {(t('languageServers.noSearchResults') as (query: string) => string)(query.trim())}
    </div>
  {:else}
    {#each shownServers as server (server.id)}
      {@const status = currentStatus(server)}
      {@const enabled = isEnabled(server.id, $settings.languageServers)}
      {@const version = shortVersion(server.version)}
      {@const extensions = summarizeExtensions(server.extensions)}
      {@const option = installer(server)}
      {@const error = commandErrors[server.id]}
      <div class="settings-row">
        <div class="settings-row-info">
          <span class="settings-row-label">{server.name}</span>
          <span class="settings-row-desc ls-exts" title={server.extensions.join(' ')}>
            {extensions.shown.join('  ')}{#if extensions.rest > 0}<span class="ls-more">+{extensions.rest}</span>{/if}
          </span>
        </div>

        <div class="settings-row-control">
          {#if status === 'ready' || status === 'starting'}
            <span
              class="ls-dot"
              title={(status === 'ready' ? t('languageServers.statusRunning') : t('languageServers.statusStarting')) as string}
            ></span>
          {:else if status === 'failed'}
            <span class="ls-dot failed" title={t('languageServers.statusFailed') as string}></span>
          {/if}

          {#if busyServerId === server.id}
            <Spinner size={13}/>
          {:else if server.binaryPath === null}
            <button
              type="button"
              class="btn ls-install"
              disabled={option === null || busyServerId !== null}
              title={option ? option.command : (t('languageServers.noManagerAvailable') as string)}
              on:click={() => option && install(server, option.manager)}
            >
              <Icon name="download" size={12}/>
              {t('languageServers.install')}
            </button>
          {:else}
            {#if version}
              <span class="ls-version" title={server.binaryPath}>{version}</span>
            {/if}
            <label class="settings-toggle" aria-label={server.name}>
              <input
                type="checkbox"
                checked={enabled}
                on:change={() => setServerEnabled(server.id, !enabled)}
              />
              <span class="settings-toggle-track"><span class="settings-toggle-thumb"></span></span>
            </label>
            <button
              type="button"
              class="ls-remove"
              disabled={busyServerId !== null}
              aria-label={(t('languageServers.uninstallTitle') as (name: string) => string)(server.name)}
              title={(t('languageServers.uninstallTitle') as (name: string) => string)(server.name)}
              on:click={() => askRemoval(server)}
            >
              <Icon name="trash" size={13}/>
            </button>
          {/if}
        </div>
      </div>

      {#if busyServerId === server.id}
        <div class="ls-fallback">
          <InstallProgress
            line={$managerOutput[server.id] ?? ''}
            startedAt={busyStartedAt}
            onCancel={() => cancelLanguageServerCommand(server.id)}
          />
        </div>
      {/if}

      <!-- The command only shows up when clicking is not an option any more. -->
      {#if error || (server.binaryPath === null && option === null)}
        <div class="ls-fallback">
          <div class="ls-fallback-text" class:danger={!!error}>
            {error || t('languageServers.noManagerAvailable')}
          </div>
          {#each server.installOptions as { manager, command }}
            <div class="ls-fallback-cmd">
              <span class="ls-manager">{manager}</span>
              <code class="selectable">{command}</code>
              <CopyButton value={command}/>
            </div>
          {/each}
          <a class="ls-doc" href={server.docUrl} target="_blank" rel="noreferrer noopener">
            {t('languageServers.documentation')}
          </a>
        </div>
      {/if}
    {/each}
  {/if}
</div>

{#if pendingRemoval}
  <UninstallServerModal
    server={pendingRemoval.server}
    manager={pendingRemoval.manager}
    on:close={() => { pendingRemoval = null; }}
    on:confirm={confirmRemoval}
  />
{/if}

<style>
  .ls-group-head {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 10px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--stroke-0);
  }
  .ls-group-head :global(.settings-group-title) {
    flex: 1;
    margin: 0;
    padding: 0;
    border: none;
  }
  .ls-rescan { padding: 3px 8px; font-size: 11px; flex-shrink: 0; }

  /* The catalogue is a list to sift, not to read: the search takes the room
     the title does not need, and the title stops claiming all of it. */
  .ls-group-head :global(.settings-group-title) { flex: 0 1 auto; }
  .ls-search {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    min-width: 0;
    max-width: 280px;
    margin-left: auto;
    padding: 0 8px;
    height: 26px;
    background: var(--bg-1);
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-sm);
    color: var(--fg-4);
  }
  .ls-search:focus-within { border-color: var(--accent); color: var(--fg-3); }
  .ls-search-input {
    flex: 1;
    min-width: 0;
    border: none;
    background: none;
    outline: none;
    color: var(--fg-0);
    font-family: var(--font-ui);
    font-size: 12px;
  }
  .ls-search-input::placeholder { color: var(--fg-4); }
  .ls-search-clear {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    padding: 0;
    border: none;
    border-radius: 3px;
    background: none;
    color: var(--fg-4);
    cursor: pointer;
  }
  .ls-search-clear:hover { background: var(--bg-4); color: var(--fg-0); }

  .ls-empty {
    padding: 18px 14px;
    font-size: 12px;
    color: var(--fg-4);
    text-align: center;
  }

  .ls-exts {
    font-family: var(--font-mono);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ls-more { margin-left: 6px; color: var(--fg-4); }

  .ls-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
    animation: pulse-dot 1.4s infinite;
    flex-shrink: 0;
  }
  .ls-dot.failed { background: var(--danger); animation: none; }

  .ls-install { padding: 4px 10px; font-size: 11.5px; }

  /* Destructive, so it stays quiet until it is pointed at - but never hidden. */
  .ls-remove {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: var(--r-sm);
    color: var(--fg-4);
    transition: color .12s, background .12s;
  }
  .ls-remove:hover:not(:disabled) { background: var(--danger-weak); color: var(--danger); }
  .ls-remove:disabled { opacity: 0.35; pointer-events: none; }

  .ls-version {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-3);
    white-space: nowrap;
  }

  .ls-fallback {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: -2px 0 6px;
    padding: 10px 14px;
    background: var(--bg-1);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-md);
  }
  .ls-fallback-text { font-size: 11.5px; color: var(--fg-2); }
  .ls-fallback-text.danger {
    color: var(--danger);
    font-family: var(--font-mono);
    white-space: pre-wrap;
    max-height: 96px;
    overflow: auto;
  }
  .ls-fallback-cmd { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .ls-manager {
    flex-shrink: 0;
    width: 42px;
    font-size: 11px;
    font-family: var(--font-mono);
    color: var(--fg-4);
  }
  .ls-fallback-cmd code {
    flex: 1;
    min-width: 0;
    font-size: 11.5px;
    font-family: var(--font-mono);
    color: var(--fg-1);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ls-doc { font-size: 11px; color: var(--accent); text-decoration: none; }
  .ls-doc:hover { text-decoration: underline; }
</style>
