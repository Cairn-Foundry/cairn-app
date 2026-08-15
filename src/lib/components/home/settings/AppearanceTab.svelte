<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n';
  import { settings } from '$lib/stores/settings';
  import { ACCENT_PRESETS, FONT_OPTIONS, DEFAULT_ACCENT } from '$lib/utils/home/appearance';
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
  import { availableThemes } from '$lib/utils/editor/themes';

  const themeOptions = availableThemes();

  $: currentFont = $settings.fontFamily;
  $: accentIsPreset = ACCENT_PRESETS.some(p => p.color === $settings.accentColor);

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

<div class="settings-group">
  <div class="settings-group-title">{t('settings.appearance.themeGroup')}</div>
  <div class="theme-cards">
    {#each themeOptions as option (option.id)}
      <button
        class="theme-card {$settings.theme === option.id ? 'active' : ''}"
        on:click={() => settings.save({ theme: option.id })}
      >
        <div class="theme-preview theme-preview-{option.id}">
          <div class="tp-bar"></div>
          <div class="tp-content">
            <div class="tp-line tp-line-wide"></div>
            <div class="tp-line tp-line-med"></div>
            <div class="tp-line tp-line-short"></div>
          </div>
        </div>
        <span class="theme-card-label">{option.label}</span>
        {#if $settings.theme === option.id}
          <span class="theme-card-check"><Icon name="check" size={11}/></span>
        {/if}
      </button>
    {/each}
  </div>
</div>

<div class="settings-group">
  <div class="settings-group-title">{t('settings.appearance.accentGroup')}</div>
  <div class="accent-presets">
    {#each ACCENT_PRESETS as preset}
      <button
        class="accent-preset {($settings.accentColor) === preset.color && accentIsPreset ? 'active' : ''}"
        title={preset.label}
        style="background: {preset.color}"
        on:click={() => settings.save({ accentColor: preset.color })}
      ></button>
    {/each}
    <label
      class="accent-preset accent-preset-custom {!accentIsPreset ? 'active' : ''}"
      title={t('settings.appearance.customColor') as string}
      style="background: {$settings.accentColor}"
    >
      <input
        type="color"
        value={$settings.accentColor}
        on:input={(e) => settings.save({ accentColor: (e.target as HTMLInputElement).value })}
      />
      {#if accentIsPreset}
        <span class="accent-custom-icon">+</span>
      {/if}
    </label>
  </div>
</div>

<div class="settings-group">
  <div class="settings-group-title">{t('settings.appearance.fontGroup')}</div>
  <div class="font-cards">
    {#each FONT_OPTIONS as opt}
      <button
        class="font-card {currentFont === opt.stack ? 'active' : ''}"
        title={opt.label}
        on:click={() => settings.save({ fontFamily: opt.stack })}
      >
        <span class="font-card-preview" style="font-family: {opt.stack}">{opt.sample}</span>
        <span class="font-card-label">{opt.label}</span>
        {#if currentFont === opt.stack}
          <span class="font-card-check"><Icon name="check" size={10}/></span>
        {/if}
      </button>
    {/each}
  </div>
</div>
<div class="settings-group">
  <div class="settings-group-title">{t('settings.appearance.scaleGroup')}</div>
  <div class="settings-row">
    <div class="settings-row-info">
      <span class="settings-row-label">{t('settings.appearance.uiScale')}</span>
      <span class="settings-row-desc">{t('settings.appearance.uiScaleDesc')}</span>
    </div>
    <div class="settings-row-control">
      <input
        class="settings-number-input"
        type="number"
        min="50"
        max="200"
        step="10"
        value={Math.round($settings.uiScale * 100)}
        on:change={(e) => {
          const v = parseInt((e.target as HTMLInputElement).value, 10);
          if (!isNaN(v)) settings.save({ uiScale: Math.max(50, Math.min(200, v)) / 100 });
        }}
      />
      <span class="settings-row-unit">%</span>
      <button
        class="settings-reset-btn"
        title={t('settings.appearance.uiScaleResetTitle') as string}
        on:click={() => settings.save({ uiScale: 1 })}
      >
        <Icon name="undo" size={12}/>
      </button>
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

<div class="settings-section-reset">
  <button
    class="btn ghost"
    style="font-size: 12px;"
    on:click={() => settings.save({ theme: 'default', accentColor: DEFAULT_ACCENT, fontFamily: "'JetBrains Mono', ui-monospace, monospace" })}
  >
    <Icon name="undo" size={12}/> {t('settings.appearance.resetAppearance')}
  </button>
</div>

<style>
  .theme-cards {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-top: 4px;
  }
  .theme-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 10px;
    border-radius: var(--r-md);
    border: 2px solid var(--stroke-0);
    background: var(--bg-1);
    cursor: pointer;
    transition: border-color .12s, background .12s;
    position: relative;
    width: 110px;
  }
  .theme-card:hover { border-color: var(--stroke-2); background: var(--bg-2); }
  .theme-card.active { border-color: var(--accent); background: var(--bg-2); }

  .theme-preview {
    width: 88px;
    height: 58px;
    border-radius: 4px;
    overflow: hidden;
    border: 1px solid oklch(0 0 0 / 0.15);
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
  }
  .tp-bar { height: 12px; }
  .tp-content { flex: 1; padding: 6px 7px; display: flex; flex-direction: column; gap: 4px; }
  .tp-line { height: 4px; border-radius: 2px; }
  .tp-line-wide  { width: 80%; }
  .tp-line-med   { width: 55%; }
  .tp-line-short { width: 35%; }

  .theme-preview-default                 { background: oklch(0.16 0.008 70); }
  .theme-preview-default .tp-bar         { background: oklch(0.185 0.008 70); }
  .theme-preview-default .tp-line        { background: oklch(0.36 0.008 70); }
  .theme-preview-default .tp-line-wide   { background: color-mix(in oklch, var(--accent) 55%, transparent); }

  .theme-preview-dark                 { background: oklch(0.115 0.003 260); }
  .theme-preview-dark .tp-bar         { background: oklch(0.145 0.004 260); }
  .theme-preview-dark .tp-line        { background: oklch(0.315 0.006 260); }
  .theme-preview-dark .tp-line-wide   { background: color-mix(in oklch, var(--accent) 55%, transparent); }

  .theme-preview-light                { background: oklch(0.97 0.006 80); }
  .theme-preview-light .tp-bar        { background: oklch(0.94 0.007 75); }
  .theme-preview-light .tp-line       { background: oklch(0.80 0.008 70); }
  .theme-preview-light .tp-line-wide  { background: color-mix(in oklch, var(--accent) 70%, transparent); }

  .theme-preview-high-contrast                { background: oklch(0.0 0 0); }
  .theme-preview-high-contrast .tp-bar        { background: oklch(0.08 0 0); }
  .theme-preview-high-contrast .tp-line       { background: oklch(0.40 0 0); }
  .theme-preview-high-contrast .tp-line-wide  { background: color-mix(in oklch, var(--accent) 80%, transparent); }

  .theme-preview-nord                 { background: oklch(0.235 0.021 265); }
  .theme-preview-nord .tp-bar         { background: oklch(0.271 0.023 265); }
  .theme-preview-nord .tp-line        { background: oklch(0.452 0.027 261); }
  .theme-preview-nord .tp-line-wide   { background: oklch(0.78 0.075 225); }

  .theme-preview-solarized                { background: oklch(0.221 0.036 210); }
  .theme-preview-solarized .tp-bar        { background: oklch(0.258 0.038 208); }
  .theme-preview-solarized .tp-line       { background: oklch(0.444 0.033 200); }
  .theme-preview-solarized .tp-line-wide  { background: oklch(0.70 0.14 75); }

  .theme-preview-dracula                { background: oklch(0.212 0.024 288); }
  .theme-preview-dracula .tp-bar        { background: oklch(0.253 0.028 288); }
  .theme-preview-dracula .tp-line       { background: oklch(0.452 0.043 288); }
  .theme-preview-dracula .tp-line-wide  { background: oklch(0.75 0.16 300); }

  .theme-preview-paper                { background: oklch(0.945 0.038 88); }
  .theme-preview-paper .tp-bar        { background: oklch(0.910 0.046 85); }
  .theme-preview-paper .tp-line       { background: oklch(0.730 0.066 73); }
  .theme-preview-paper .tp-line-wide  { background: oklch(0.47 0.15 42); }

  .theme-preview-glass {
    background:
      linear-gradient(135deg, oklch(0.55 0.14 265 / 0.55), oklch(0.62 0.12 320 / 0.45)),
      oklch(0.28 0.012 265);
  }
  .theme-preview-glass .tp-bar        { background: oklch(1 0 0 / 0.16); }
  .theme-preview-glass .tp-line       { background: oklch(1 0 0 / 0.30); }
  .theme-preview-glass .tp-line-wide  { background: oklch(1 0 0 / 0.55); }

  .theme-card-label { font-size: 12px; color: var(--fg-1); }
  .theme-card.active .theme-card-label { color: var(--fg-0); }
  .theme-card-check {
    position: absolute;
    top: 6px; right: 6px;
    color: var(--accent);
    display: flex;
    align-items: center;
  }

  .font-cards {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 4px;
  }

  .font-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 10px 12px;
    border-radius: var(--r-md);
    border: 2px solid var(--stroke-0);
    background: var(--bg-1);
    cursor: pointer;
    transition: border-color .12s, background .12s;
    position: relative;
    min-width: 88px;
  }
  .font-card:hover { border-color: var(--stroke-2); background: var(--bg-2); }
  .font-card.active { border-color: var(--accent); background: var(--bg-2); }

  .font-card-preview {
    font-size: 20px;
    line-height: 1;
    color: var(--fg-0);
    letter-spacing: -0.01em;
  }
  .font-card.active .font-card-preview { color: var(--accent); }

  .font-card-label {
    font-size: 10.5px;
    color: var(--fg-3);
    font-family: var(--font-ui);
    white-space: nowrap;
  }
  .font-card.active .font-card-label { color: var(--fg-1); }

  .font-card-check {
    position: absolute;
    top: 5px;
    right: 5px;
    color: var(--accent);
    display: flex;
    align-items: center;
  }

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

  .accent-presets {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 4px;
  }
  .accent-preset {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    transition: transform .1s, border-color .1s;
    flex-shrink: 0;
    position: relative;
  }
  .accent-preset:hover { transform: scale(1.15); }
  .accent-preset.active {
    border-color: var(--fg-0);
    transform: scale(1.1);
    box-shadow: 0 0 0 2px var(--bg-2);
  }

  .accent-preset-custom {
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  .accent-preset-custom input[type="color"] {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
    width: 100%;
    height: 100%;
    border: none;
    padding: 0;
  }
  .accent-custom-icon {
    font-size: 16px;
    color: oklch(1 0 0 / 0.7);
    line-height: 1;
    pointer-events: none;
  }
</style>
