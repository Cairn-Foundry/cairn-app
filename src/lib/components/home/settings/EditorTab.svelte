<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n';
  import { settings } from '$lib/stores/settings';
  import { SAVE_ON_OPTIONS } from '$lib/utils/home/appearance';
  import type { CairnSettings } from '$lib/services/settings-service';
  import SyntaxThemeEditor from '$lib/components/home/settings/SyntaxThemeEditor.svelte';
  import type { SyntaxTheme } from '$lib/utils/editor/syntax-tokens';
  import { SYNTAX_TOKEN_KEYS, defaultSyntaxTokens } from '$lib/utils/editor/syntax-tokens';
  import {
    createSyntaxTheme,
    duplicateSyntaxTheme,
    parseSyntaxTheme,
    serializeSyntaxTheme,
  } from '$lib/utils/home/syntax-theme';
  import { readFile, writeFile } from '$lib/services/file-service';

  let saveOnOpen = false;

  $: saveOnLabel = SAVE_ON_OPTIONS.find(o => o.value === ($settings.saveOn))?.label ?? 'Focus change';

  let editing: SyntaxTheme | null = null;
  let syntaxError = '';

  $: syntaxThemes = $settings.syntaxThemes;
  $: activeSyntaxId = $settings.activeSyntaxThemeId;
  $: builtInTokens = defaultSyntaxTokens($settings.theme);

  function selectSyntaxTheme(id: string) {
    settings.save({ activeSyntaxThemeId: id });
  }

  function newSyntaxTheme() {
    syntaxError = '';
    editing = createSyntaxTheme(t('settings.syntax.newThemeName') as string, $settings.theme);
  }

  function duplicate(theme: SyntaxTheme) {
    const copy = duplicateSyntaxTheme(theme);
    settings.save({
      syntaxThemes: [...syntaxThemes, copy],
      activeSyntaxThemeId: copy.id,
    });
  }

  function removeSyntaxTheme(theme: SyntaxTheme) {
    settings.save({
      syntaxThemes: syntaxThemes.filter(x => x.id !== theme.id),
      activeSyntaxThemeId: activeSyntaxId === theme.id ? '' : activeSyntaxId,
    });
  }

  function saveSyntaxTheme(theme: SyntaxTheme) {
    const exists = syntaxThemes.some(x => x.id === theme.id);
    settings.save({
      syntaxThemes: exists
        ? syntaxThemes.map(x => (x.id === theme.id ? theme : x))
        : [...syntaxThemes, theme],
      activeSyntaxThemeId: theme.id,
    });
    editing = null;
  }

  async function exportSyntaxTheme(theme: SyntaxTheme) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({
      defaultPath: `${theme.name.replace(/[^\w.-]+/g, '-')}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!path) return;
    await writeFile(path, serializeSyntaxTheme(theme));
  }

  async function importSyntaxTheme() {
    syntaxError = '';
    const { open } = await import('@tauri-apps/plugin-dialog');
    const path = await open({
      multiple: false,
      directory: false,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (typeof path !== 'string') return;
    try {
      const imported = parseSyntaxTheme((await readFile(path)) ?? '', $settings.theme);
      settings.save({
        syntaxThemes: [...syntaxThemes, imported],
        activeSyntaxThemeId: imported.id,
      });
    } catch (err) {
      syntaxError = err instanceof Error ? err.message : String(err);
    }
  }
</script>

<svelte:window on:keydown={(e) => { if (e.key === 'Escape' && saveOnOpen) saveOnOpen = false; }} />

<div class="settings-group">
  <div class="settings-group-title">{t('settings.editor.layoutGroup')}</div>
  <div class="settings-row">
    <div class="settings-row-info">
      <span class="settings-row-label">{t('settings.editor.sidebarPosition')}</span>
      <span class="settings-row-desc">{t('settings.editor.sidebarPositionDesc')}</span>
    </div>
    <div class="sidebar-pos-toggle">
      <button
        class="sidebar-pos-btn {($settings.sidebarPosition) === 'left' ? 'active' : ''}"
        on:click={() => settings.save({ sidebarPosition: 'left' })}
      >{t('settings.editor.sidebarLeft')}</button>
      <button
        class="sidebar-pos-btn {($settings.sidebarPosition) === 'right' ? 'active' : ''}"
        on:click={() => settings.save({ sidebarPosition: 'right' })}
      >{t('settings.editor.sidebarRight')}</button>
    </div>
  </div>
  <div class="settings-row">
    <div class="settings-row-info">
      <span class="settings-row-label">{t('settings.editor.treePanelWidth')}</span>
      <span class="settings-row-desc">{t('settings.editor.treePanelWidthDesc')}</span>
    </div>
    <div class="settings-row-control">
      <input
        class="settings-number-input"
        type="number"
        min="140"
        max="480"
        value={$settings.treePanelWidth}
        on:change={(e) => {
          const v = parseInt((e.target as HTMLInputElement).value, 10);
          if (!isNaN(v)) settings.save({ treePanelWidth: Math.max(140, Math.min(480, v)) });
        }}
      />
      <span class="settings-row-unit">{t('settings.editor.treePanelWidthUnit')}</span>
      <button class="settings-reset-btn" title={t('settings.editor.treePanelWidthResetTitle') as string} on:click={() => settings.save({ treePanelWidth: 220 })}>
        <Icon name="undo" size={12}/>
      </button>
    </div>
  </div>
</div>

<div class="settings-group">
  <div class="settings-group-title">{t('settings.editor.codeEditorGroup')}</div>
  <div class="settings-row">
    <div class="settings-row-info">
      <span class="settings-row-label">{t('settings.editor.fontSize')}</span>
      <span class="settings-row-desc">{t('settings.editor.fontSizeDesc')}</span>
    </div>
    <div class="settings-row-control">
      <input
        class="settings-number-input"
        type="number"
        min="8"
        max="32"
        value={$settings.editorFontSize}
        on:change={(e) => {
          const v = parseInt((e.target as HTMLInputElement).value, 10);
          if (!isNaN(v)) settings.save({ editorFontSize: Math.max(8, Math.min(32, v)) });
        }}
      />
      <span class="settings-row-unit">{t('settings.editor.fontSizeUnit')}</span>
      <button class="settings-reset-btn" title={t('settings.editor.fontSizeResetTitle') as string} on:click={() => settings.save({ editorFontSize: 13 })}>
        <Icon name="undo" size={12}/>
      </button>
    </div>
  </div>
  <div class="settings-row">
    <div class="settings-row-info">
      <span class="settings-row-label">{t('settings.editor.showMinimap')}</span>
      <span class="settings-row-desc">{t('settings.editor.showMinimapDesc')}</span>
    </div>
    <label class="settings-toggle" aria-label={t('settings.editor.toggleMinimap') as string}>
      <input
        type="checkbox"
        checked={$settings.showMinimap}
        on:change={(e) => settings.save({ showMinimap: (e.target as HTMLInputElement).checked })}
      />
      <span class="settings-toggle-track"><span class="settings-toggle-thumb"></span></span>
    </label>
  </div>
  <div class="settings-row">
    <div class="settings-row-info">
      <span class="settings-row-label">{t('settings.editor.saveOn')}</span>
      <span class="settings-row-desc">{t('settings.editor.saveOnDesc')}</span>
    </div>
    <div class="so-dropdown" class:so-open={saveOnOpen}>
      <button
        type="button"
        class="so-trigger"
        on:click={() => saveOnOpen = !saveOnOpen}
        aria-haspopup="listbox"
        aria-expanded={saveOnOpen}
      >
        <span>{saveOnLabel}</span>
        <svg width="10" height="6" viewBox="0 0 10 6" fill="none" class="so-chevron">
          <path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      {#if saveOnOpen}
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div class="so-backdrop" on:click={() => saveOnOpen = false} on:keydown={() => {}}></div>
        <div class="so-menu" role="listbox">
          {#each SAVE_ON_OPTIONS as opt}
            {@const active = ($settings.saveOn) === opt.value}
            <button
              type="button"
              role="option"
              aria-selected={active}
              class="so-item"
              class:so-item-active={active}
              on:click={() => { settings.save({ saveOn: opt.value as CairnSettings['saveOn'] }); saveOnOpen = false; }}
            >
              <span class="so-check">{#if active}<svg width="11" height="9" viewBox="0 0 11 9" fill="none"><path d="M1 4.5l3 3 6-7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>{/if}</span>
              <span class="so-item-body">
                <span class="so-item-label">{opt.label}</span>
                <span class="so-item-desc">{opt.desc}</span>
              </span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>

<div class="settings-group">
  <div class="settings-group-title">{t('settings.syntax.groupTitle')}</div>
  <p class="settings-group-hint">{t('settings.syntax.desc')}</p>

  <div class="syntax-cards">
    <button
      class="syntax-card {activeSyntaxId === '' ? 'active' : ''}"
      on:click={() => selectSyntaxTheme('')}
    >
      <span class="syntax-swatches">
        {#each SYNTAX_TOKEN_KEYS as key}
          <span class="syntax-swatch" style="background: {builtInTokens[key].color}"></span>
        {/each}
      </span>
      <span class="syntax-card-name">{t('settings.syntax.builtIn')}</span>
    </button>

    {#each syntaxThemes as theme (theme.id)}
      <div class="syntax-card-wrap">
        <button
          class="syntax-card {activeSyntaxId === theme.id ? 'active' : ''}"
          on:click={() => selectSyntaxTheme(theme.id)}
        >
          <span class="syntax-swatches">
            {#each SYNTAX_TOKEN_KEYS as key}
              <span class="syntax-swatch" style="background: {theme.tokens[key]?.color ?? builtInTokens[key].color}"></span>
            {/each}
          </span>
          <span class="syntax-card-name">{theme.name}</span>
        </button>
        <div class="syntax-card-actions">
          <button class="syntax-action" title={t('common.edit') as string} on:click={() => { editing = theme; }}>
            <Icon name="edit" size={11}/>
          </button>
          <button class="syntax-action" title={t('common.duplicate') as string} on:click={() => duplicate(theme)}>
            <Icon name="copy" size={11}/>
          </button>
          <button class="syntax-action" title={t('settings.syntax.export') as string} on:click={() => exportSyntaxTheme(theme)}>
            <Icon name="download" size={11}/>
          </button>
          <button class="syntax-action" title={t('common.delete') as string} on:click={() => removeSyntaxTheme(theme)}>
            <Icon name="trash" size={11}/>
          </button>
        </div>
      </div>
    {/each}
  </div>

  <div class="syntax-buttons">
    <button class="btn ghost" style="font-size: 12px;" on:click={newSyntaxTheme}>
      <Icon name="plus" size={12}/> {t('settings.syntax.newTheme')}
    </button>
    <button class="btn ghost" style="font-size: 12px;" on:click={importSyntaxTheme}>
      <Icon name="upload" size={12}/> {t('settings.syntax.import')}
    </button>
  </div>

  {#if syntaxError}
    <p class="syntax-error">{syntaxError}</p>
  {/if}
</div>

{#if editing}
  <SyntaxThemeEditor
    theme={editing}
    on:close={() => { editing = null; }}
    on:save={(e) => saveSyntaxTheme(e.detail)}
  />
{/if}

<div class="settings-group">
  <div class="settings-group-title">{t('settings.editor.quickSearchGroup')}</div>
  <div class="settings-row">
    <div class="settings-row-info">
      <span class="settings-row-label">{t('settings.editor.quickSearchGitignored')}</span>
      <span class="settings-row-desc">{t('settings.editor.quickSearchGitignoredDesc')}</span>
    </div>
    <label class="settings-toggle" aria-label={t('settings.editor.quickSearchGitignored') as string}>
      <input
        type="checkbox"
        checked={$settings.quickSearchShowGitignored}
        on:change={(e) => settings.save({ quickSearchShowGitignored: (e.target as HTMLInputElement).checked })}
      />
      <span class="settings-toggle-track"><span class="settings-toggle-thumb"></span></span>
    </label>
  </div>
</div>

<div class="settings-section-reset">
  <button
    class="btn ghost"
    style="font-size: 12px;"
    on:click={() => settings.save({ treePanelWidth: 220, showMinimap: true, editorFontSize: 13, sidebarPosition: 'left' })}
  >
    <Icon name="undo" size={12}/> {t('settings.editor.resetEditor')}
  </button>
</div>

<style>
  .sidebar-pos-toggle {
    display: flex;
    background: var(--bg-0);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-sm);
    padding: 2px;
    gap: 2px;
    flex-shrink: 0;
  }
  .sidebar-pos-btn {
    padding: 4px 12px;
    font-size: 12px;
    color: var(--fg-2);
    border-radius: 3px;
    font-family: var(--font-ui);
    transition: background .1s, color .1s;
  }
  .sidebar-pos-btn:hover { color: var(--fg-0); }
  .sidebar-pos-btn.active { background: var(--bg-3); color: var(--fg-0); }

  .so-dropdown { position: relative; flex-shrink: 0; }
  .so-trigger {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 10px;
    background: var(--bg-0);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-sm);
    color: var(--fg-1);
    font-family: var(--font-ui);
    font-size: 12px;
    cursor: pointer;
    min-width: 130px;
    justify-content: space-between;
    transition: border-color .15s, color .15s;
  }
  .so-trigger:hover { border-color: var(--stroke-1); color: var(--fg-0); }
  .so-open .so-trigger { border-color: var(--accent); color: var(--fg-0); }
  .so-chevron { transition: transform .15s; color: var(--fg-3); flex-shrink: 0; }
  .so-open .so-chevron { transform: rotate(180deg); }
  .so-backdrop { position: fixed; inset: 0; z-index: 1000; }
  .so-menu {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    z-index: 1001;
    background: var(--bg-2);
    border: 1px solid var(--stroke-1);
    border-radius: 6px;
    padding: 4px;
    box-shadow: 0 6px 20px rgba(0,0,0,.45);
    min-width: 210px;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .so-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    border-radius: 4px;
    border: none;
    background: none;
    cursor: pointer;
    text-align: left;
    width: 100%;
    transition: background .1s;
  }
  .so-item:hover { background: var(--bg-4); }
  .so-item-active { background: var(--bg-3); }
  .so-check {
    width: 14px;
    flex-shrink: 0;
    color: var(--accent);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .so-item-body { display: flex; flex-direction: column; gap: 1px; }
  .so-item-label { font-size: 12px; font-family: var(--font-ui); color: var(--fg-0); line-height: 1.3; }
  .so-item-desc { font-size: 11px; font-family: var(--font-ui); color: var(--fg-3); line-height: 1.3; }

  .settings-group-hint {
    margin: -4px 0 10px;
    font-size: 11.5px;
    color: var(--fg-3);
    line-height: 1.5;
  }

  .syntax-cards {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 4px;
  }

  .syntax-card-wrap { position: relative; }

  .syntax-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    padding: 10px 12px;
    border-radius: var(--r-md);
    border: 2px solid var(--stroke-0);
    background: var(--bg-1);
    cursor: pointer;
    transition: border-color .12s, background .12s;
    width: 168px;
  }
  .syntax-card:hover { border-color: var(--stroke-2); background: var(--bg-2); }
  .syntax-card.active { border-color: var(--accent); background: var(--bg-2); }

  .syntax-swatches {
    display: flex;
    gap: 2px;
    width: 100%;
  }
  .syntax-swatch {
    flex: 1;
    height: 14px;
    border-radius: 2px;
  }

  .syntax-card-name {
    font-size: 12px;
    color: var(--fg-1);
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .syntax-card.active .syntax-card-name { color: var(--fg-0); }

  .syntax-card-actions {
    position: absolute;
    top: 4px;
    right: 4px;
    display: flex;
    gap: 2px;
    opacity: 0;
    transition: opacity .12s;
  }
  .syntax-card-wrap:hover .syntax-card-actions { opacity: 1; }

  .syntax-action {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    padding: 0;
    background: var(--bg-3);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-xs);
    color: var(--fg-2);
    cursor: pointer;
  }
  .syntax-action:hover { background: var(--bg-4); color: var(--fg-0); }

  .syntax-buttons {
    display: flex;
    gap: 8px;
    margin-top: 10px;
  }

  .syntax-error {
    margin: 8px 0 0;
    font-size: 11.5px;
    color: var(--danger);
  }
</style>
