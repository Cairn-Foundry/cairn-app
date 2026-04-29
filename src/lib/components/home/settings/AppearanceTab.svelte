<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n';
  import { settings } from '$lib/stores/settings';
  import { ACCENT_PRESETS, FONT_OPTIONS, DEFAULT_ACCENT } from '$lib/utils/home/appearance';

  $: currentFont = $settings.fontFamily;
  $: accentIsPreset = ACCENT_PRESETS.some(p => p.color === $settings.accentColor);
</script>

<div class="settings-group">
  <div class="settings-group-title">{t('settings.appearance.themeGroup')}</div>
  <div class="theme-cards">
    {#each [['dark', 'Dark'], ['light', 'Light'], ['high-contrast', 'High contrast']] as [val, label]}
      <button
        class="theme-card {$settings.theme === val ? 'active' : ''}"
        on:click={() => settings.save({ theme: val as 'dark' | 'light' | 'high-contrast' })}
      >
        <div class="theme-preview theme-preview-{val}">
          <div class="tp-bar"></div>
          <div class="tp-content">
            <div class="tp-line tp-line-wide"></div>
            <div class="tp-line tp-line-med"></div>
            <div class="tp-line tp-line-short"></div>
          </div>
        </div>
        <span class="theme-card-label">{label}</span>
        {#if $settings.theme === val}
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
<div class="settings-section-reset">
  <button
    class="btn ghost"
    style="font-size: 12px;"
    on:click={() => settings.save({ theme: 'dark', accentColor: DEFAULT_ACCENT, fontFamily: "'JetBrains Mono', ui-monospace, monospace" })}
  >
    <Icon name="undo" size={12}/> {t('settings.appearance.resetAppearance')}
  </button>
</div>

<style>
  .theme-cards {
    display: flex;
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

  .theme-preview-dark                 { background: oklch(0.16 0.008 70); }
  .theme-preview-dark .tp-bar         { background: oklch(0.185 0.008 70); }
  .theme-preview-dark .tp-line        { background: oklch(0.36 0.008 70); }
  .theme-preview-dark .tp-line-wide   { background: color-mix(in oklch, var(--accent) 55%, transparent); }

  .theme-preview-light                { background: oklch(0.97 0.006 80); }
  .theme-preview-light .tp-bar        { background: oklch(0.94 0.007 75); }
  .theme-preview-light .tp-line       { background: oklch(0.80 0.008 70); }
  .theme-preview-light .tp-line-wide  { background: color-mix(in oklch, var(--accent) 70%, transparent); }

  .theme-preview-high-contrast                { background: oklch(0.0 0 0); }
  .theme-preview-high-contrast .tp-bar        { background: oklch(0.08 0 0); }
  .theme-preview-high-contrast .tp-line       { background: oklch(0.40 0 0); }
  .theme-preview-high-contrast .tp-line-wide  { background: color-mix(in oklch, var(--accent) 80%, transparent); }

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
    user-select: none;
  }
</style>
