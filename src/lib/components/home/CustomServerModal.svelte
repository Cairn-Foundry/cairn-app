<script lang="ts">
  /**
   * Editor for a user-declared language server: binary, arguments, extensions, root markers.
   * Dispatches `save` with the assembled CustomLanguageServer, `close` on cancel.
   */
  import { createEventDispatcher } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n';
  import type { CustomLanguageServer } from '$lib/services/settings-service';
  import { customServerId } from '$lib/stores/language-server';

  /** The server being edited, or null when one is being declared. */
  export let server: CustomLanguageServer | null = null;
  /** Every id already in use, so a new one never collides with them. */
  export let takenIds: string[] = [];

  const dispatch = createEventDispatcher<{ close: void; save: CustomLanguageServer }>();

  let name = server?.name ?? '';
  let binary = server?.binary ?? '';
  let args = (server?.args ?? []).join(' ');
  let extensions = (server?.extensions ?? []).join(' ');
  let languageIds = (server?.languageIds ?? []).join(' ');
  let rootMarkers = (server?.rootMarkers ?? []).join(' ');
  let docUrl = server?.docUrl ?? '';

  /** Space or comma separated, because both are what people type. */
  function split(value: string): string[] {
    return value.split(/[\s,]+/).filter(Boolean);
  }

  /** An extension is stored with its dot, whether or not it was typed with one. */
  function normalizeExtensions(value: string): string[] {
    return split(value).map(e => (e.startsWith('.') ? e : `.${e}`).toLowerCase());
  }

  $: parsedExtensions = normalizeExtensions(extensions);
  $: canSave = name.trim() !== '' && binary.trim() !== '' && parsedExtensions.length > 0;

  function save() {
    if (!canSave) return;
    dispatch('save', {
      id: server?.id ?? customServerId(name, takenIds),
      name: name.trim(),
      binary: binary.trim(),
      args: split(args),
      languageIds: split(languageIds),
      extensions: parsedExtensions,
      rootMarkers: split(rootMarkers),
      docUrl: docUrl.trim(),
    });
  }
</script>

<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<div
  class="modal-backdrop"
  role="dialog"
  aria-modal="true"
  tabindex="-1"
  on:click={() => dispatch('close')}
  on:keydown={(e) => e.key === 'Escape' && dispatch('close')}
>
  <div class="modal cs-modal" on:click|stopPropagation role="presentation">
    <div class="modal-head">
      <div>
        <div class="step-count">{t('languageServers.customHeading')}</div>
        <h3>{server ? t('languageServers.customEditTitle') : t('languageServers.customAddTitle')}</h3>
      </div>
      <button class="icon-btn close" on:click={() => dispatch('close')} aria-label={t('common.close') as string}>
        <Icon name="x" size={16}/>
      </button>
    </div>

    <div class="modal-body cs-body">
      <p class="cs-desc">{t('languageServers.customDescription')}</p>

      <label class="cs-field">
        <span class="cs-label">{t('languageServers.customName')}</span>
        <input class="cs-input selectable" type="text" spellcheck="false" bind:value={name} placeholder="Elixir (Lexical)"/>
      </label>

      <label class="cs-field">
        <span class="cs-label">{t('languageServers.customBinary')}</span>
        <input class="cs-input selectable" type="text" spellcheck="false" bind:value={binary} placeholder="lexical"/>
        <span class="cs-hint">{t('languageServers.customBinaryHint')}</span>
      </label>

      <label class="cs-field">
        <span class="cs-label">{t('languageServers.customArgs')}</span>
        <input class="cs-input selectable" type="text" spellcheck="false" bind:value={args} placeholder="--stdio"/>
      </label>

      <label class="cs-field">
        <span class="cs-label">{t('languageServers.customExtensions')}</span>
        <input class="cs-input selectable" type="text" spellcheck="false" bind:value={extensions} placeholder=".ex .exs"/>
        <span class="cs-hint">{t('languageServers.customExtensionsHint')}</span>
      </label>

      <label class="cs-field">
        <span class="cs-label">{t('languageServers.customLanguageIds')}</span>
        <input class="cs-input selectable" type="text" spellcheck="false" bind:value={languageIds} placeholder="elixir"/>
        <span class="cs-hint">{t('languageServers.customLanguageIdsHint')}</span>
      </label>

      <label class="cs-field">
        <span class="cs-label">{t('languageServers.customRootMarkers')}</span>
        <input class="cs-input selectable" type="text" spellcheck="false" bind:value={rootMarkers} placeholder="mix.exs"/>
        <span class="cs-hint">{t('languageServers.customRootMarkersHint')}</span>
      </label>

      <label class="cs-field">
        <span class="cs-label">{t('languageServers.customDocUrl')}</span>
        <input class="cs-input selectable" type="text" spellcheck="false" bind:value={docUrl} placeholder="https://"/>
      </label>
    </div>

    <div class="modal-foot">
      <div class="spacer"></div>
      <button class="btn ghost" on:click={() => dispatch('close')}>{t('common.cancel')}</button>
      <button class="btn primary" disabled={!canSave} on:click={save}>{t('common.save')}</button>
    </div>
  </div>
</div>

<style>
  .cs-modal { width: min(520px, 94vw); }
  .cs-body { display: flex; flex-direction: column; gap: 12px; max-height: 60vh; overflow-y: auto; }
  .cs-desc { margin: 0; font-size: 12.5px; color: var(--fg-3); line-height: 1.6; }
  .cs-field { display: flex; flex-direction: column; gap: 4px; }
  .cs-label { font-size: 12px; color: var(--fg-2); }
  .cs-input {
    padding: 6px 8px;
    background: var(--bg-1);
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-sm);
    color: var(--fg-0);
    font-family: var(--font-mono);
    font-size: 12px;
    outline: none;
  }
  .cs-input:focus { border-color: var(--accent); }
  .cs-hint { font-size: 11px; color: var(--fg-4); line-height: 1.4; }
</style>
