<script lang="ts">
  /**
   * Formatting tool: the formatter catalogue and its install state, plus the
   * common style and the per-language overrides, with import and export of the
   * usual config files.
   */
  import { onMount } from 'svelte';
  import { open, save } from '@tauri-apps/plugin-dialog';
  import Icon from '$lib/components/Icon.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import Select from '$lib/components/Select.svelte';
  import ExportModal from './ExportModal.svelte';
  import ImportModal from './ImportModal.svelte';
  import ImportSourceModal from './ImportSourceModal.svelte';
  import StyleField from './StyleField.svelte';
  import { t } from '$lib/i18n';
  import {
    DEFAULT_FORMATTING,
    detectRepoFormatters,
    exportFormattingConfig,
    type FormattingConfig,
    importFormattingConfig,
    type ImportReport,
    installFormatter,
    type StyleValue,
    uninstallFormatter,
    uninstallManagerForFormatter,
    updateFormatter,
    updateManagerForFormatter,
  } from '$lib/services/formatting-service';
  import { formatting } from '$lib/stores/formatting';
  import {
    effectiveFormatterId,
    inheritedValue,
    LSP_FORMATTER_ID,
    isSupported,
    optionsForLanguage,
    resolveStyle,
    withLanguage,
    withOverride,
  } from '$lib/utils/formatting/resolve';
  import {
    languageLabel,
    matchesLanguageQuery,
    sortByLabel,
  } from '$lib/utils/formatting/languages';
  import { activeInstance } from '$lib/stores/instance';
  import { activeProject } from '$lib/stores/project';

  const options = formatting.options;
  const formatters = formatting.formatters;
  const projectsStore = formatting.projects;

  let loading = true;
  let refreshing = false;
  let expanded: string | null = null;
  let busyFormatterId: string | null = null;
  let commandError = '';
  let report: ImportReport | null = null;
  let detected: { formatterId: string; file: string }[] = [];
  let exporting = false;
  let choosingImport = false;
  let detecting = false;
  let query = '';

  $: projectId = $activeProject?.id ?? null;
  $: worktree = $activeInstance?.worktreePath ?? null;
  $: config = projectId ? ($projectsStore[projectId] ?? DEFAULT_FORMATTING) : DEFAULT_FORMATTING;

  $: languages = sortByLabel(
    Array.from(new Set($formatters.flatMap((f) => f.languageIds))),
  );
  $: shownLanguages = languages.filter((language) =>
    matchesLanguageQuery(language, query, rows.get(language)?.formatter?.name ?? ''),
  );

  $: commonOptions = $options.filter((o) => o.languages.length === 0);
  /** The language the export dialog writes out: the open one, or the first. */
  $: exportLanguage = expanded ?? languages[0] ?? '';

  /**
   * What every row shows, rebuilt whenever the scan, the project's config or
   * the detected repository files move. A row cannot read those through a
   * function call: the keyed `{#each}` only recomputes a `{@const}` when
   * something the compiler can see it depend on changes, and a call hides that.
   * A formatter installed from its own row would keep offering Install until
   * the view was mounted again.
   */
  $: rows = new Map(
    languages.map((language) => {
      const formatter = formatterFor(language, config, $formatters);
      return [
        language,
        {
          formatter,
          entry: config.languages.find((l) => l.languageId === language),
          repoConfig:
            config.respectRepoConfig && formatter
              ? (detected.find((d) => d.formatterId === formatter.id)?.file ?? null)
              : null,
        },
      ] as const;
    }),
  );

  function formatterFor(
    language: string,
    forConfig: FormattingConfig,
    catalogue: typeof $formatters,
  ) {
    return (
      catalogue.find(
        (f) => f.id === effectiveFormatterId(forConfig, language, catalogue),
      ) ?? null
    );
  }

  /**
   * The project and the worktree are followed rather than read once: the view
   * can be mounted before the active project is resolved, and it survives a
   * switch to another one. Reading the config late is not a cosmetic problem -
   * the form would show the catalogue defaults, and the first edit would write
   * them over everything the project had set.
   */
  let loadedProject: string | null = null;
  let scannedWorktree: string | null = null;
  let scanned = false;

  $: if (projectId !== loadedProject) {
    loadedProject = projectId;
    void loadProjectConfig(projectId);
  }

  $: if (!scanned || worktree !== scannedWorktree) {
    scanned = true;
    scannedWorktree = worktree;
    void rescan();
  }

  async function loadProjectConfig(id: string | null) {
    if (id) await formatting.loadProject(id);
    loading = false;
  }

  onMount(() => {
    void formatting.loadStyleOptions();
  });

  async function rescan() {
    refreshing = true;
    await formatting.scan(worktree ?? undefined);
    if (worktree) detected = await detectRepoFormatters(worktree).catch(() => []);
    refreshing = false;
  }

  async function persist(patch: Partial<FormattingConfig>) {
    if (!projectId) return;
    await formatting.saveProject(projectId, patch);
  }

  function setBase(optionId: string, value: StyleValue | undefined) {
    void persist({ base: withOverride(config.base, optionId, value) });
  }

  function setLanguageStyle(
    language: string,
    optionId: string,
    value: StyleValue | undefined,
  ) {
    const style = withOverride(rows.get(language)?.entry?.style ?? {}, optionId, value);
    void persist(withLanguage(config, language, { style }));
  }

  async function runManagerCommand(
    formatterId: string,
    kind: 'install' | 'uninstall' | 'update',
    manager: string,
  ) {
    busyFormatterId = formatterId;
    commandError = '';
    try {
      if (kind === 'install') await installFormatter(formatterId, manager);
      else if (kind === 'uninstall') await uninstallFormatter(formatterId, manager);
      else await updateFormatter(formatterId, manager);
      await rescan();
      // An install that succeeded and still leaves the binary unreachable is
      // the one failure the row cannot show on its own: it looks exactly like a
      // button that did nothing.
      if (kind === 'install' && !$formatters.find((f) => f.id === formatterId)?.installed) {
        commandError = (t('formatting.installedNotFound') as (n: string) => string)(manager);
      }
    } catch (e) {
      commandError = String(e);
    } finally {
      busyFormatterId = null;
    }
  }

  /** The install a one-click button runs: the manager this machine actually has. */
  function installer(formatter: { installOptions: { manager: string; available: boolean }[] }) {
    return formatter.installOptions.find((o) => o.available) ?? null;
  }

  async function removeFormatter(id: string) {
    const manager = await uninstallManagerForFormatter(id).catch(() => null);
    if (manager) await runManagerCommand(id, 'uninstall', manager);
  }

  async function upgradeFormatter(id: string) {
    const manager = await updateManagerForFormatter(id).catch(() => null);
    if (manager) await runManagerCommand(id, 'update', manager);
  }

  /**
   * The repository is looked at again on opening: a config file added since the
   * view was mounted has to show up without a reload.
   */
  async function openImport() {
    choosingImport = true;
    if (!worktree) return;
    detecting = true;
    detected = await detectRepoFormatters(worktree).catch(() => []);
    detecting = false;
  }

  async function runImport(path?: string) {
    choosingImport = false;
    const chosen = path ?? (await open({ multiple: false, directory: false }));
    if (typeof chosen !== 'string') return;
    commandError = '';
    try {
      report = await importFormattingConfig(chosen);
    } catch (e) {
      commandError = String(e);
    }
  }

  /**
   * Each option lands where it belongs: a universal one in the common style, a
   * language-specific one on its own languages. Dumping `quoteStyle` into the
   * common style would push a JavaScript setting at every language sharing it.
   */
  async function applyImport() {
    if (!report) return;
    if (report.config) {
      await persist(report.config);
      report = null;
      return;
    }

    let next: FormattingConfig = { ...config };
    const base = { ...next.base };
    const perLanguage = new Map<string, Record<string, StyleValue>>();

    for (const [id, value] of Object.entries(report.style)) {
      const option = $options.find((o) => o.id === id);
      if (!option || option.languages.length === 0) {
        base[id] = value;
        continue;
      }
      for (const language of option.languages) {
        const style = perLanguage.get(language) ?? {};
        style[id] = value;
        perLanguage.set(language, style);
      }
    }

    next = { ...next, base };
    for (const [language, style] of perLanguage) {
      const existing = next.languages.find((l) => l.languageId === language)?.style ?? {};
      next = withLanguage(next, language, { style: { ...existing, ...style } });
    }
    await persist(next);
    report = null;
  }

  async function runExport(target: string) {
    exporting = false;
    const path = await save({ defaultPath: exportFileName(target) });
    if (typeof path !== 'string') return;
    commandError = '';
    try {
      await exportFormattingConfig({
        path,
        target,
        config,
        style: resolveStyle($options, config, exportLanguage),
      });
    } catch (e) {
      commandError = String(e);
    }
  }

  function exportFileName(target: string): string {
    switch (target) {
      case 'prettier': return '.prettierrc';
      case 'biome': return 'biome.json';
      case 'rustfmt': return 'rustfmt.toml';
      case 'ruff': return 'ruff.toml';
      case 'black': return 'pyproject.toml';
      case 'clang-format': return '.clang-format';
      case 'editorconfig': return '.editorconfig';
      default: return '.cairnformat';
    }
  }
</script>

<div class="fmt-view">
  <div class="fmt-head">
    <div class="fmt-head-text">
      <span class="fmt-title">{t('formatting.title')}</span>
      <span class="fmt-sub">{t('formatting.subtitle')}</span>
    </div>
    <div class="fmt-head-actions">
      <button class="btn ghost" disabled={!projectId} on:click={openImport}>
        <Icon name="download" size={13}/> {t('formatting.import')}
      </button>
      <button class="btn ghost" disabled={!projectId} on:click={() => (exporting = true)}>
        <Icon name="upload" size={13}/> {t('formatting.export')}
      </button>
    </div>
  </div>

  <div class="fmt-body">
    {#if loading}
      <div class="settings-group"><Skeleton lines={6} height={46} gap={6}/></div>
    {:else}
      {#if commandError}
        <div class="settings-group"><div class="fmt-error" role="alert">{commandError}</div></div>
      {/if}

      <div class="settings-group">
        <div class="settings-group-title">{t('formatting.behaviourGroup')}</div>

        <div class="settings-row">
          <div class="settings-row-info">
            <span class="settings-row-label">{t('formatting.enabled')}</span>
            <span class="settings-row-desc">{t('formatting.enabledDesc')}</span>
          </div>
          <label class="settings-toggle" aria-label={t('formatting.enabled') as string}>
            <input
              type="checkbox"
              checked={config.enabled}
              disabled={!projectId}
              on:change={(e) => persist({ enabled: e.currentTarget.checked })}
            />
            <span class="settings-toggle-track"><span class="settings-toggle-thumb"></span></span>
          </label>
        </div>

        <div class="settings-row">
          <div class="settings-row-info">
            <span class="settings-row-label">{t('formatting.formatOnSave')}</span>
            <span class="settings-row-desc">{t('formatting.formatOnSaveDesc')}</span>
          </div>
          <label class="settings-toggle" aria-label={t('formatting.formatOnSave') as string}>
            <input
              type="checkbox"
              checked={config.formatOnSave}
              disabled={!projectId}
              on:change={(e) => persist({ formatOnSave: e.currentTarget.checked })}
            />
            <span class="settings-toggle-track"><span class="settings-toggle-thumb"></span></span>
          </label>
        </div>

        <div class="settings-row">
          <div class="settings-row-info">
            <span class="settings-row-label">{t('formatting.respectRepoConfig')}</span>
            <span class="settings-row-desc">{t('formatting.respectRepoConfigDesc')}</span>
          </div>
          <label class="settings-toggle" aria-label={t('formatting.respectRepoConfig') as string}>
            <input
              type="checkbox"
              checked={config.respectRepoConfig}
              disabled={!projectId}
              on:change={(e) => persist({ respectRepoConfig: e.currentTarget.checked })}
            />
            <span class="settings-toggle-track"><span class="settings-toggle-thumb"></span></span>
          </label>
        </div>
      </div>

      <div class="settings-group">
        <div class="settings-group-title">{t('formatting.commonGroup')}</div>
        {#each commonOptions as option (option.id)}
          <StyleField
            {option}
            value={config.base[option.id]}
            inherited={inheritedValue($options, config, languages[0] ?? '', 'common', option.id)}
            on:change={(e) => setBase(option.id, e.detail)}
          />
        {/each}
      </div>

      <div class="settings-group">
        <div class="fmt-group-head">
          <span class="settings-group-title">{t('formatting.languagesGroup')}</span>
          <button
            class="btn ghost"
            on:click={rescan}
            disabled={refreshing}
            aria-label={t('formatting.rescan') as string}
            title={t('formatting.rescan') as string}
          >
            {#if refreshing}<Spinner size={11}/>{:else}<Icon name="refresh" size={12}/>{/if}
          </button>
        </div>

        <div class="fmt-search">
          <Icon name="search" size={12}/>
          <input
            class="fmt-search-input selectable"
            type="text"
            spellcheck="false"
            autocomplete="off"
            bind:value={query}
            placeholder={t('formatting.searchLanguages') as string}
            aria-label={t('formatting.searchLanguages') as string}
          />
          {#if query}
            <button
              class="fmt-search-clear"
              on:click={() => (query = '')}
              aria-label={t('common.clearSearch') as string}
            >
              <Icon name="x" size={12}/>
            </button>
          {/if}
        </div>

        {#if shownLanguages.length === 0}
          <div class="fmt-empty">{t('formatting.noLanguageMatch')}</div>
        {/if}

        {#each shownLanguages as language (language)}
          {@const row = rows.get(language)}
          {@const formatter = row?.formatter ?? null}
          {@const entry = row?.entry}
          {@const repoConfig = row?.repoConfig ?? null}
          {@const install = formatter && !formatter.installed ? installer(formatter) : null}
          {@const specific = optionsForLanguage($options, language)
            .filter((o) => o.languages.length > 0)
            .filter((o) => isSupported(formatter?.supported, o.id))}
          {@const isOpen = expanded === language}

          <div class="settings-row fmt-lang" class:open={isOpen}>
            <button
              class="fmt-lang-main"
              aria-expanded={isOpen}
              on:click={() => (expanded = isOpen ? null : language)}
            >
              <Icon name={isOpen ? 'chev-d' : 'chev-r'} size={11}/>
              <span class="settings-row-info">
                <span class="settings-row-label">{languageLabel(language)}</span>
                <span class="settings-row-desc">
                  {#if formatter}
                    {formatter.name}
                    {#if formatter.installed && repoConfig}
                      &middot; {repoConfig}
                    {/if}
                  {:else}
                    {t('formatting.lspFallback')}
                  {/if}
                </span>
              </span>
            </button>

            <div class="settings-row-control fmt-lang-control">
              <!-- State first, then the choice: whether this language is
                   formatted at all - or still needs its binary - is what the
                   eye should meet before which tool does it. The two never
                   appear together, so the slot holds exactly one control. -->
              {#if busyFormatterId === formatter?.id}
                <span class="fmt-state"><Spinner size={12}/></span>
              {:else if formatter && !formatter.installed}
                {#if formatter.toolchain}
                  <a
                    class="btn ghost fmt-state"
                    href={formatter.docUrl}
                    target="_blank"
                    rel="noreferrer"
                    title={(t('formatting.toolchainHint') as (n: string) => string)(formatter.name)}
                  >
                    <Icon name="external" size={12}/>
                  </a>
                {:else if install}
                  <button
                    class="btn fmt-state"
                    on:click={() => runManagerCommand(formatter.id, 'install', install.manager)}
                  >
                    <Icon name="download" size={12}/>
                    {t('formatting.install')}
                  </button>
                {/if}
              {:else}
                <!-- Nothing can run this language until its binary is there, so
                     the switch only appears once something can answer to it.
                     The language server fallback has none to install. -->
                <label
                  class="settings-toggle fmt-state"
                  title={t('formatting.languageEnabled') as string}
                  aria-label={t('formatting.languageEnabled') as string}
                >
                  <input
                    type="checkbox"
                    checked={entry?.enabled ?? true}
                    disabled={!projectId}
                    on:change={(e) =>
                      persist(withLanguage(config, language, { enabled: e.currentTarget.checked }))}
                  />
                  <span class="settings-toggle-track"><span class="settings-toggle-thumb"></span></span>
                </label>
              {/if}

            </div>
          </div>

          {#if isOpen}
            <div class="fmt-detail">
              <div class="fmt-detail-options">
                <div class="settings-row">
                  <div class="settings-row-info">
                    <span class="settings-row-label">{t('formatting.formatter')}</span>
                    <span class="settings-row-desc">{t('formatting.formatterDesc')}</span>
                  </div>
                  <div class="settings-row-control">
                    <div class="fmt-pick">
                      <Select
                        value={formatter?.id ?? LSP_FORMATTER_ID}
                        options={[
                          { value: LSP_FORMATTER_ID, label: t('formatting.lspFallback') as string },
                          ...$formatters
                            .filter((f) => f.languageIds.includes(language))
                            .map((f) => ({ value: f.id, label: f.name })),
                        ]}
                        ariaLabel={t('formatting.formatter') as string}
                        disabled={!projectId}
                        on:change={(e) =>
                          persist(withLanguage(config, language, { formatterId: e.detail }))}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {#if formatter?.installed}
                <div class="fmt-detail-row">
                  <span class="fmt-path selectable">{formatter.binaryPath}</span>
                  {#if formatter.version}
                    <span class="fmt-version selectable">{formatter.version}</span>
                  {/if}
                  {#if formatter.projectLocal}
                    <span class="fmt-tag">{t('formatting.projectLocal')}</span>
                  {:else}
                    {#if formatter.updateOptions.length > 0}
                      <button class="btn ghost" on:click={() => upgradeFormatter(formatter.id)}>
                        {t('formatting.update')}
                      </button>
                    {/if}
                    {#if formatter.uninstallOptions.length > 0}
                      <button
                        class="btn ghost danger fmt-remove"
                        on:click={() => removeFormatter(formatter.id)}
                      >
                        <Icon name="trash" size={11}/>
                        {t('formatting.uninstall')}
                      </button>
                    {/if}
                  {/if}
                </div>
              {:else if formatter?.toolchain}
                <p class="fmt-detail-row fmt-hint">
                  {(t('formatting.toolchainHint') as (n: string) => string)(formatter.name)}
                </p>
              {/if}

              {#if repoConfig}
                <div class="fmt-detail-row fmt-repo">
                  <Icon name="info" size={12}/>
                  <span>
                    {(t('formatting.repoConfigWins') as (f: string, n: string) => string)(
                      repoConfig,
                      formatter?.name ?? '',
                    )}
                  </span>
                  <button
                    class="btn ghost"
                    on:click={() => worktree && runImport(`${worktree}/${repoConfig}`)}
                  >
                    {t('formatting.importThisFile')}
                  </button>
                </div>
              {/if}

              {#if specific.length > 0}
                <div class="fmt-detail-options" class:inert={repoConfig}>
                  {#each specific as option (option.id)}
                    <StyleField
                      {option}
                      value={entry?.style[option.id]}
                      inherited={inheritedValue($options, config, language, 'language', option.id)}
                      on:change={(e) => setLanguageStyle(language, option.id, e.detail)}
                    />
                  {/each}
                </div>
              {:else}
                <p class="fmt-hint fmt-no-options">{t('formatting.noLanguageOptions')}</p>
              {/if}
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  </div>
</div>

{#if exporting}
  <ExportModal
    style={resolveStyle($options, config, exportLanguage)}
    languageId={exportLanguage}
    formatters={$formatters}
    on:close={() => (exporting = false)}
    on:confirm={(e) => runExport(e.detail.target)}
  />
{/if}

{#if choosingImport}
  <ImportSourceModal
    {detected}
    formatters={$formatters}
    scanning={detecting}
    on:close={() => (choosingImport = false)}
    on:browse={() => runImport()}
    on:pick={(e) => worktree && runImport(`${worktree}/${e.detail.file}`)}
  />
{/if}

{#if report}
  <ImportModal {report} on:close={() => (report = null)} on:confirm={applyImport}/>
{/if}

<style>
  .fmt-view {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    background: var(--bg-0);
  }

  .fmt-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--stroke-0);
  }
  .fmt-head-text { display: flex; flex-direction: column; gap: 3px; }
  .fmt-title { font-size: 13px; color: var(--fg-0); }
  .fmt-sub { font-size: 11.5px; color: var(--fg-4); line-height: 1.4; }
  .fmt-head-actions { display: flex; gap: 8px; flex-shrink: 0; }

  .fmt-body { flex: 1; overflow-y: auto; padding: 12px 16px 20px; }

  /* The tool owns the whole main area, so its groups are not held to the
     narrow column the home settings pages use. */
  .fmt-body :global(.settings-group) { max-width: none; margin-top: 20px; }
  .fmt-body :global(.settings-group:first-child) { margin-top: 4px; }

  .fmt-group-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .fmt-group-head :global(.settings-group-title) { flex: 1; }

  .fmt-error {
    padding: 8px 12px;
    font-size: 12px;
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--danger) 20%, transparent);
    border-radius: var(--r-sm);
  }

  .fmt-search {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 12px;
    margin-bottom: 6px;
    background: var(--bg-0);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-md);
    color: var(--fg-3);
  }
  .fmt-search:focus-within { border-color: var(--accent); }
  .fmt-search-input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: 0;
    outline: 0;
    font-size: 12.5px;
    color: var(--fg-0);
  }
  .fmt-search-input::placeholder { color: var(--fg-3); }
  .fmt-search-clear {
    display: grid;
    place-items: center;
    background: none;
    border: none;
    color: var(--fg-3);
    cursor: pointer;
  }
  .fmt-search-clear:hover { color: var(--fg-0); }

  .fmt-empty {
    padding: 14px;
    font-size: 12px;
    color: var(--fg-3);
    text-align: center;
  }

  /* The row owns no padding of its own: the button fills it, so the whole
     strip is the click target rather than the label alone. */
  .fmt-lang { padding: 0; }
  .fmt-lang.open {
    margin-bottom: 0;
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
  }

  .fmt-lang-main {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    padding: 11px 14px;
    background: none;
    border: none;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }
  .fmt-lang-main :global(svg) { color: var(--fg-3); flex-shrink: 0; }

  .fmt-lang-control { padding-right: 14px; gap: 8px; }
  .fmt-pick { width: 168px; }
  /* Install button, switch and spinner share the slot, so the picker starts
     at the same x on every row rather than shifting per state. */
  .fmt-state {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-shrink: 0;
  }

  .fmt-detail {
    margin-bottom: 6px;
    padding: 10px 14px 2px;
    background: var(--bg-2);
    border: 1px solid var(--stroke-0);
    border-top: none;
    border-radius: 0 0 var(--r-md) var(--r-md);
  }
  .fmt-detail-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-bottom: 10px;
    font-size: 11px;
    color: var(--fg-2);
    flex-wrap: wrap;
  }
  .fmt-repo :global(svg) { color: var(--accent); flex-shrink: 0; }

  .fmt-hint { color: var(--fg-3); margin: 0; }
  .fmt-no-options { padding-bottom: 10px; font-size: 11px; }
  .fmt-path { font-family: var(--font-mono); color: var(--fg-2); }
  .fmt-version { font-family: var(--font-mono); color: var(--fg-3); }
  .fmt-tag {
    padding: 1px 6px;
    background: var(--bg-3);
    border-radius: var(--r-sm);
    font-size: 10px;
    color: var(--fg-2);
  }

  /* Removing a binary is not one more fact about it: it sits away from the
     path and version, at the end of the row. */
  .fmt-remove { margin-left: auto; }

  /* The repository's file decides: the options stay readable but cannot
     pretend they are what the formatter will use. */
  .fmt-detail-options.inert { opacity: 0.45; pointer-events: none; }
  .fmt-detail-options :global(.settings-row) { background: var(--bg-1); }
</style>
