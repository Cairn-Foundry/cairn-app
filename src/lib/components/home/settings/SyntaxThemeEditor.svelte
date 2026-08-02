<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n';
  import { settings } from '$lib/stores/settings';
  import { toHexColor } from '$lib/utils/editor/color';
  import {
    SYNTAX_TOKEN_KEYS,
    defaultSyntaxTokens,
    type SyntaxTheme,
    type SyntaxTokenKey,
    type SyntaxTokens,
  } from '$lib/utils/editor/syntax-tokens';
  import { PREVIEW_LINES } from '$lib/utils/home/syntax-theme';

  export let theme: SyntaxTheme;

  const dispatch = createEventDispatcher<{ close: void; save: SyntaxTheme }>();

  let name = theme.name;
  let tokens: SyntaxTokens = {
    ...defaultSyntaxTokens($settings.theme),
    ...theme.tokens,
  };

  function cssFor(style: SyntaxTokens[SyntaxTokenKey]): string {
    return `color: ${style.color};
            font-weight: ${style.bold ? 600 : 400};
            font-style: ${style.italic ? 'italic' : 'normal'};
            text-decoration: ${style.underline ? 'underline' : 'none'}`;
  }

  $: styledLines = PREVIEW_LINES.map(line =>
    line.map(seg => ({
      text: seg.text,
      style: seg.token ? cssFor(tokens[seg.token]) : '',
      label: seg.token ? t(`settings.syntax.tokens.${seg.token}`) as string : undefined,
    })),
  );

  function patch(key: SyntaxTokenKey, change: Partial<SyntaxTokens[SyntaxTokenKey]>) {
    tokens = { ...tokens, [key]: { ...tokens[key], ...change } };
  }

  function resetToken(key: SyntaxTokenKey) {
    tokens = { ...tokens, [key]: defaultSyntaxTokens($settings.theme)[key] };
  }

  function resetAll() {
    tokens = defaultSyntaxTokens($settings.theme);
  }

  function save() {
    const trimmed = name.trim();
    if (!trimmed) return;
    dispatch('save', { ...theme, name: trimmed, tokens });
  }
</script>

<div class="modal-backdrop" role="button" tabindex="-1" on:click={() => dispatch('close')} on:keydown={() => {}}>
  <div class="modal" role="presentation" on:click|stopPropagation>
    <div class="modal-head">
      <h3>{t('settings.syntax.editorTitle')}</h3>
      <button class="icon-btn close" on:click={() => dispatch('close')} aria-label={t('common.close') as string}>
        <Icon name="x" size={16}/>
      </button>
    </div>

    <div class="modal-body">
      <div class="token-column">
        <div class="name-row">
          <label for="syntax-theme-name">{t('settings.syntax.name')}</label>
          <input
            id="syntax-theme-name"
            class="selectable"
            type="text"
            bind:value={name}
            placeholder={t('settings.syntax.namePlaceholder') as string}
          />
        </div>

        <div class="token-list">
          {#each SYNTAX_TOKEN_KEYS as key}
            <div class="token-row">
              <label class="token-swatch" style="background: {tokens[key].color}" title={t('settings.syntax.color') as string}>
                <input
                  type="color"
                  value={toHexColor(tokens[key].color)}
                  aria-label={t(`settings.syntax.tokens.${key}`) as string}
                  on:input={(e) => patch(key, { color: (e.target as HTMLInputElement).value })}
                />
              </label>
              <span class="token-label" style={cssFor(tokens[key])}>
                {t(`settings.syntax.tokens.${key}`)}
              </span>
              <div class="token-styles">
                <button
                  class="style-toggle {tokens[key].bold ? 'on' : ''}"
                  title={t('settings.syntax.bold') as string}
                  on:click={() => patch(key, { bold: !tokens[key].bold })}
                >B</button>
                <button
                  class="style-toggle italic {tokens[key].italic ? 'on' : ''}"
                  title={t('settings.syntax.italic') as string}
                  on:click={() => patch(key, { italic: !tokens[key].italic })}
                >I</button>
                <button
                  class="style-toggle underline {tokens[key].underline ? 'on' : ''}"
                  title={t('settings.syntax.underline') as string}
                  on:click={() => patch(key, { underline: !tokens[key].underline })}
                >U</button>
                <button
                  class="style-toggle"
                  title={t('settings.syntax.resetToken') as string}
                  on:click={() => resetToken(key)}
                ><Icon name="undo" size={11}/></button>
              </div>
            </div>
          {/each}
        </div>
      </div>

      <div class="preview-column">
        <div class="preview-title">{t('settings.syntax.preview')}</div>
        <div class="preview-host">
          <pre class="preview-code">{#each styledLines as line}<span class="preview-line">{#each line as seg}<span
              style={seg.style}
              title={seg.label}
            >{seg.text}</span>{/each}
</span>{/each}</pre>
        </div>
      </div>
    </div>

    <div class="modal-foot">
      <button class="btn ghost" on:click={resetAll}>
        <Icon name="undo" size={12}/> {t('settings.syntax.resetAll')}
      </button>
      <div class="foot-right">
        <button class="btn ghost" on:click={() => dispatch('close')}>{t('common.cancel')}</button>
        <button class="btn primary" disabled={!name.trim()} on:click={save}>{t('common.save')}</button>
      </div>
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 9000;
    background: oklch(0 0 0 / 0.5);
    display: grid;
    place-items: center;
    padding: 32px;
  }

  .modal {
    display: flex;
    flex-direction: column;
    width: min(980px, 100%);
    height: min(640px, 100%);
    background: var(--bg-1);
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-lg);
    overflow: hidden;
  }

  .modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    border-bottom: 1px solid var(--stroke-0);
  }
  .modal-head h3 { margin: 0; font-size: 14px; color: var(--fg-0); }

  .icon-btn {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    background: transparent;
    border: none;
    border-radius: var(--r-sm);
    color: var(--fg-2);
    cursor: pointer;
  }
  .icon-btn:hover { background: var(--bg-3); color: var(--fg-0); }

  .modal-body {
    display: grid;
    grid-template-columns: 340px minmax(0, 1fr);
    flex: 1;
    min-height: 0;
  }

  .token-column {
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-right: 1px solid var(--stroke-0);
  }

  .name-row {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--stroke-0);
  }
  .name-row label { font-size: 11px; color: var(--fg-3); }
  .name-row input {
    background: var(--bg-0);
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-sm);
    color: var(--fg-0);
    font-family: var(--font-ui);
    font-size: 12.5px;
    padding: 6px 8px;
    outline: none;
  }
  .name-row input:focus { border-color: var(--accent); }

  .token-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .token-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 5px 6px;
    border-radius: var(--r-sm);
  }
  .token-row:hover { background: var(--bg-2); }

  .token-swatch {
    position: relative;
    width: 20px;
    height: 20px;
    border-radius: var(--r-sm);
    border: 1px solid var(--stroke-1);
    flex-shrink: 0;
    cursor: pointer;
    overflow: hidden;
  }
  .token-swatch input[type="color"] {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    border: none;
    padding: 0;
    cursor: pointer;
  }

  .token-label {
    flex: 1;
    min-width: 0;
    font-family: var(--font-mono);
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .token-styles { display: flex; gap: 3px; }

  .style-toggle {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    padding: 0;
    background: transparent;
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-sm);
    color: var(--fg-3);
    font-size: 11px;
    font-weight: 600;
    font-family: var(--font-ui);
    cursor: pointer;
  }
  .style-toggle.italic { font-style: italic; }
  .style-toggle.underline { text-decoration: underline; }
  .style-toggle:hover { background: var(--bg-3); color: var(--fg-0); }
  .style-toggle.on {
    background: var(--accent-weak);
    border-color: var(--accent);
    color: var(--fg-0);
  }

  .preview-column {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }
  .preview-title {
    padding: 12px 14px;
    border-bottom: 1px solid var(--stroke-0);
    font-size: 11px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--fg-3);
  }
  .preview-host {
    flex: 1;
    min-height: 0;
    overflow: auto;
    background: var(--bg-0);
  }

  .preview-code {
    margin: 0;
    padding: 12px 14px;
    font-family: var(--font-mono);
    font-size: 12.5px;
    line-height: 1.65;
    color: var(--fg-1);
    tab-size: 2;
  }
  .preview-line { display: block; min-height: 1.65em; }

  .modal-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid var(--stroke-0);
  }
  .foot-right { display: flex; gap: 8px; }
</style>
