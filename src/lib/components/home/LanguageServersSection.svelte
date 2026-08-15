<script lang="ts">
  /**
   * Language server catalogue: install, update, uninstall through each server's package manager,
   * plus the user-declared custom servers. Every command is explicit - nothing installs on its own.
   */
  import { onMount } from 'svelte';
  import CopyButton from '$lib/components/CopyButton.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import { t } from '$lib/i18n';
  import InstallProgress from '$lib/components/InstallProgress.svelte';
  import UninstallServerModal from '$lib/components/home/UninstallServerModal.svelte';
  import CustomServerModal from '$lib/components/home/CustomServerModal.svelte';
  import RemoveCustomServerModal from '$lib/components/home/RemoveCustomServerModal.svelte';
  import { cancelLanguageServerCommand, installLanguageServer, uninstallLanguageServer, uninstallManagerFor, updateLanguageServer, updateManagerFor, COMMAND_CANCELLED, type LanguageServerInfo, type LanguageServerStatus } from '$lib/services/lsp-service';
  import type { CustomLanguageServer } from '$lib/services/settings-service';
  import { activeInstance } from '$lib/stores/instance';
  import { checkForUpdates, clearManagerOutput, clearUpdateCheck, managerOutput, languageServerInfos, languageServerStatuses, liveStatusFor, refreshLanguageServers, removeCustomServer, saveCustomServer, setServerEnabled, updateChecks } from '$lib/stores/language-server';
  import { settings } from '$lib/stores/settings';
  import { matchesServerQuery, shortVersion, summarizeExtensions } from '$lib/utils/languages/servers';

  let loading = true;
  let refreshing = false;
  let busyServerId: string | null = null;
  let busyStartedAt = 0;
  let commandErrors: Record<string, string> = {};
  let checking = false;
  let pendingRemoval: { server: LanguageServerInfo; manager: string | null } | null = null;

  /** Re-reads the catalogue against the active worktree, since availability is path-dependent. */
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

  /**
   * Asks every installed server's manager whether a newer version exists.
   * Never automatic: it is one process and one network round-trip per installed
   * server. What it found holds until it is asked again, and is not written
   * anywhere - "up to date" must always come from an answer of this session.
   */
  async function checkUpdates() {
    checking = true;
    await checkForUpdates($activeInstance?.worktreePath ?? null);
    checking = false;
  }

  /**
   * Updating goes through the manager that installed the binary. The verdict of
   * the last check is dropped afterwards: it describes the version that has
   * just been replaced.
   */
  async function update(server: LanguageServerInfo) {
    const manager = await updateManagerFor(server.id).catch(() => null);
    if (!manager) return;

    busyServerId = server.id;
    busyStartedAt = Date.now();
    commandErrors = { ...commandErrors, [server.id]: '' };
    clearManagerOutput(server.id);
    try {
      await updateLanguageServer(server.id, manager);
      clearUpdateCheck(server.id);
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

  /** Resolves the manager that owns the binary before the confirmation can name a command. */
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

  function updater(server: LanguageServerInfo) {
    return server.updateOptions.find(o => o.available) ?? null;
  }

  let query = '';
  $: shownServers = $languageServerInfos.filter(s => matchesServerQuery(s, query));

  /** null while nothing is being declared, `{ server: null }` while adding. */
  let editing: { server: CustomLanguageServer | null } | null = null;
  let pendingCustomRemoval: LanguageServerInfo | null = null;

  function editCustom(server: LanguageServerInfo) {
    editing = {
      server: $settings.customLanguageServers.find(s => s.id === server.id) ?? null,
    };
  }

  async function saveCustom(server: CustomLanguageServer) {
    editing = null;
    await saveCustomServer(server);
    await reload();
  }

  async function confirmCustomRemoval() {
    const server = pendingCustomRemoval;
    pendingCustomRemoval = null;
    if (!server) return;
    await removeCustomServer(server.id);
    await reload();
  }
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
  <!-- The actions sit on their own line: sharing one with the search left it
       squeezed to nothing as soon as a third button appeared. -->
  <div class="ls-group-head">
    <div class="ls-head-top">
      <span class="settings-group-title">{t('languageServers.serversGroup')}</span>
      <div class="ls-actions">
        <button
          type="button"
          class="ls-action"
          on:click={checkUpdates}
          disabled={checking || busyServerId !== null}
          title={t('languageServers.checkUpdatesDesc') as string}
        >
          {#if checking}<Spinner size={11}/>{:else}<Icon name="download" size={12}/>{/if}
          {t('languageServers.checkUpdates')}
        </button>
        <button
          type="button"
          class="ls-action icon-only"
          on:click={reload}
          disabled={refreshing}
          aria-label={t('languageServers.rescan') as string}
          title={t('languageServers.rescan') as string}
        >
          {#if refreshing}<Spinner size={11}/>{:else}<Icon name="refresh" size={12}/>{/if}
        </button>
        <button type="button" class="btn ls-add" on:click={() => { editing = { server: null }; }}>
          <Icon name="plus" size={12}/>
          {t('languageServers.customAdd')}
        </button>
      </div>
    </div>
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
      {@const updateOption = updater(server)}
      {@const check = $updateChecks[server.id]}
      {@const error = commandErrors[server.id]}
      <div class="settings-row">
        <div class="settings-row-info">
          <!-- The running dot belongs to the name, not to the controls: it says
               something about this server, not something to be clicked. -->
          <span class="settings-row-label ls-name">
            {server.name}
            {#if status === 'ready' || status === 'starting'}
              <span
                class="ls-dot"
                class:starting={status === 'starting'}
                title={(status === 'ready' ? t('languageServers.statusRunning') : t('languageServers.statusStarting')) as string}
              ></span>
            {:else if status === 'failed'}
              <span class="ls-dot failed" title={t('languageServers.statusFailed') as string}></span>
            {/if}
            {#if server.custom}<span class="ls-tag">{t('languageServers.customTag')}</span>{/if}
          </span>
          <span class="settings-row-desc ls-exts" title={server.extensions.join(' ')}>
            {extensions.shown.join('  ')}{#if extensions.rest > 0}<span class="ls-more">+{extensions.rest}</span>{/if}
          </span>
        </div>

        <div class="settings-row-control">
          {#if server.custom}
            <!-- Cairn did not install it, so it never offers to: it only says
                 whether the binary answers, and lets the declaration be fixed. -->
            {#if server.binaryPath === null}
              <span class="ls-missing" title={server.binary}>{t('languageServers.customMissing')}</span>
            {:else}
              <div class="ls-state">
                {#if version}
                  <span class="ls-version" title={server.binaryPath}>{version}</span>
                {/if}
              </div>
              <label class="settings-toggle" aria-label={server.name}>
                <input
                  type="checkbox"
                  checked={enabled}
                  on:change={() => setServerEnabled(server.id, !enabled)}
                />
                <span class="settings-toggle-track"><span class="settings-toggle-thumb"></span></span>
              </label>
            {/if}
            <button
              type="button"
              class="ls-edit"
              aria-label={(t('languageServers.customEditLabel') as (name: string) => string)(server.name)}
              title={(t('languageServers.customEditLabel') as (name: string) => string)(server.name)}
              on:click={() => editCustom(server)}
            >
              <Icon name="edit" size={13}/>
            </button>
            <button
              type="button"
              class="ls-remove"
              aria-label={(t('languageServers.customRemoveTitle') as (name: string) => string)(server.name)}
              title={(t('languageServers.customRemoveTitle') as (name: string) => string)(server.name)}
              on:click={() => { pendingCustomRemoval = server; }}
            >
              <Icon name="trash" size={13}/>
            </button>
          {:else if busyServerId === server.id}
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
            <!-- Version and verdict read as one thing - "4.3.3, and that is the
                 current one" - so they sit together, right-aligned, and keep the
                 same width whatever they say so the column never jitters. -->
            <div class="ls-state">
              {#if version}
                <span class="ls-version" title={server.binaryPath}>{version}</span>
              {/if}
              <!-- Four states, and only what has been verified is claimed: never
                   checked, up to date, a newer one exists, or it could not be
                   established - which is said out loud rather than left to look
                   like a pending update. -->
              {#if check?.outdated === false}
                <span class="ls-badge ok" title={t('languageServers.upToDateDesc') as string}>
                  <Icon name="check" size={10}/>
                  {t('languageServers.upToDate')}
                </span>
              {:else if check && check.outdated === null}
                <span
                  class="ls-badge"
                  title={(check.manager
                    ? (t('languageServers.updateUnknownManager') as (m: string) => string)(check.manager)
                    : t('languageServers.updateUnknownNoManager')) as string}
                >
                  <Icon name="help" size={10}/>
                  {t('languageServers.updateUnknown')}
                </span>
              {/if}
            </div>

            {#if check?.outdated !== false && updateOption}
              <button
                type="button"
                class="ls-update"
                class:available={check?.outdated === true}
                disabled={busyServerId !== null}
                aria-label={(t('languageServers.updateTitle') as (name: string) => string)(server.name)}
                title={updateOption.command}
                on:click={() => update(server)}
              >
                <Icon name="download" size={13}/>
                {#if check?.outdated === true}
                  <span class="ls-target">{check.latest ? shortVersion(check.latest) : t('languageServers.updateAvailable')}</span>
                {/if}
              </button>
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
      {#if !server.custom && (error || (server.binaryPath === null && option === null))}
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

{#if editing}
  <CustomServerModal
    server={editing.server}
    takenIds={$languageServerInfos.map(s => s.id)}
    on:close={() => { editing = null; }}
    on:save={(e) => saveCustom(e.detail)}
  />
{/if}

{#if pendingCustomRemoval}
  <RemoveCustomServerModal
    server={pendingCustomRemoval}
    on:close={() => { pendingCustomRemoval = null; }}
    on:confirm={confirmCustomRemoval}
  />
{/if}

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
    flex-direction: column;
    gap: 8px;
    margin-bottom: 10px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--stroke-0);
  }
  .ls-head-top {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .ls-group-head :global(.settings-group-title) {
    flex: 1;
    margin: 0;
    padding: 0;
    border: none;
  }
  .ls-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
  .ls-action {
    display: flex;
    align-items: center;
    gap: 5px;
    height: 26px;
    padding: 0 8px;
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-sm);
    background: none;
    color: var(--fg-2);
    font-family: var(--font-ui);
    font-size: 11px;
    white-space: nowrap;
    cursor: pointer;
    transition: color .12s, background .12s, border-color .12s;
  }
  .ls-action:hover:not(:disabled) { background: var(--bg-4); color: var(--fg-0); }
  .ls-action:disabled { opacity: 0.45; pointer-events: none; }
  .ls-action.icon-only { padding: 0; width: 26px; justify-content: center; }
  .ls-add { height: 26px; padding: 0 8px; font-size: 11px; flex-shrink: 0; }

  .ls-tag {
    padding: 1px 5px;
    border-radius: 3px;
    background: var(--bg-4);
    font-size: 10px;
    color: var(--fg-3);
    vertical-align: middle;
  }
  .ls-missing { font-size: 11px; color: var(--fg-4); white-space: nowrap; }

  .ls-edit {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: var(--r-sm);
    color: var(--fg-4);
    transition: color .12s, background .12s;
  }
  .ls-edit:hover { background: var(--bg-4); color: var(--fg-0); }

  /* The catalogue is a list to sift, not to read, so the search keeps a full
     line to itself - sharing one with the actions squeezed it to nothing. */
  .ls-search {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    min-width: 0;
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

  /* Sits with the name, so it reads as a property of the server rather than a
     control. Steady while it is up, pulsing only while it is coming up. */
  .ls-name {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
  }
  .ls-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    flex-shrink: 0;
  }
  .ls-dot.starting { animation: pulse-dot 1.4s infinite; }
  .ls-dot.failed { background: var(--danger); animation: none; }

  .ls-install { padding: 4px 10px; font-size: 11.5px; }

  .ls-update {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    min-width: 24px;
    height: 24px;
    padding: 0 4px;
    border-radius: var(--r-sm);
    color: var(--fg-4);
    transition: color .12s, background .12s;
  }
  .ls-update:hover:not(:disabled) { background: var(--bg-4); color: var(--accent); }
  .ls-update:disabled { opacity: 0.35; pointer-events: none; }
  /* An update that is known to exist is an invitation, not a spare control. */
  .ls-update.available { background: var(--accent-weak); color: var(--accent); }
  .ls-target { font-family: var(--font-mono); font-size: 11px; }


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

  /* One line for "which version, and is it the current one": both read as a
     single statement, so they sit side by side on the same baseline. Fixed in
     width and right-aligned, so the toggles stay in line down the list whether
     a row carries a badge or nothing at all. */
  .ls-state {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    width: 132px;
    flex-shrink: 0;
  }
  .ls-version {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-3);
    white-space: nowrap;
  }
  .ls-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 18px;
    padding: 0 7px;
    border: 1px solid var(--stroke-1);
    border-radius: 999px;
    background: none;
    font-size: 11px;
    color: var(--fg-3);
    white-space: nowrap;
  }
  .ls-badge.ok {
    background: var(--accent-weak);
    border-color: transparent;
    color: var(--accent);
  }
  .ls-badge :global(svg) { flex-shrink: 0; }

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
