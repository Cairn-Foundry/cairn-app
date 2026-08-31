<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * Keyboard shortcut settings: rebinding by recording a key or a modified click, per-shortcut
   * reset and disable, and highlighting of the bindings that collide.
   */
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n';
  import { settings } from '$lib/stores/settings';
  import { shortcuts, SHORTCUT_DEFS, bindingToLabels, bindingKey, SHORTCUT_GROUP_LABELS } from '$lib/stores/shortcuts';
  import { MOUSE_KEY, type ShortcutId, type ShortcutBinding, type ShortcutConfig } from '$lib/types/shortcuts';
  import { MODIFIER_KEYS } from '$lib/utils/home/appearance';
  import { IS_MAC } from '$lib/utils/platform';
  import { matchesSearch } from '$lib/utils/files/files-search';

  let shortcutSearch = '';
  let recordingId: ShortcutId | null = null;

  $: filteredShortcutDefs = shortcutSearch.trim()
    ? SHORTCUT_DEFS.filter(d => matchesSearch(d.label, shortcutSearch) || matchesSearch(d.description, shortcutSearch))
    : SHORTCUT_DEFS;

  $: shortcutConfigMap = new Map<ShortcutId, ShortcutConfig>(
    ($settings.shortcuts).map(c => [c.id, c])
  );

  $: conflictIds = (() => {
    const seen = new Map<string, ShortcutId[]>();
    for (const def of SHORTCUT_DEFS) {
      const binding = $shortcuts[def.id];
      if (!binding) continue;
      const k = bindingKey(binding);
      if (!seen.has(k)) seen.set(k, []);
      seen.get(k)!.push(def.id);
    }
    const result = new Set<ShortcutId>();
    for (const ids of seen.values()) {
      if (ids.length > 1) ids.forEach(id => result.add(id));
    }
    return result;
  })();

  function startRecording(id: ShortcutId) { recordingId = id; }

  $: recordingDef = recordingId ? SHORTCUT_DEFS.find(d => d.id === recordingId) ?? null : null;

  /** Replaces this shortcut's config entry, leaving the others untouched. */
  function saveBinding(id: ShortcutId, binding: ShortcutBinding) {
    const existing = shortcutConfigMap.get(id) ?? { id, binding: null, enabled: true };
    const next = [
      ...($settings.shortcuts).filter(c => c.id !== id),
      { ...existing, binding },
    ];
    settings.save({ shortcuts: next });
    recordingId = null;
  }

  function modifiersOf(e: KeyboardEvent | MouseEvent) {
    return {
      mod: IS_MAC ? e.metaKey : e.ctrlKey,
      shift: e.shiftKey,
      alt: e.altKey,
      ctrl: e.ctrlKey,
    };
  }

  function handleRecordKeydown(e: KeyboardEvent) {
    if (!recordingId) return;
    if (MODIFIER_KEYS.has(e.key)) return;
    if (e.key === 'Escape') { e.preventDefault(); recordingId = null; return; }
    if (recordingDef?.mouse) return;
    e.preventDefault();
    e.stopPropagation();
    saveBinding(recordingId, { key: e.key, ...modifiersOf(e) });
  }

  /** A bare click stays a click: a mouse binding without a modifier is refused. */
  function handleRecordMousedown(e: MouseEvent) {
    if (!recordingId || !recordingDef?.mouse) return;
    e.preventDefault();
    e.stopPropagation();
    const mods = modifiersOf(e);
    if (!mods.mod && !mods.shift && !mods.alt && !mods.ctrl) { recordingId = null; return; }
    saveBinding(recordingId, { key: MOUSE_KEY, ...mods });
  }

  /** Drops the override entirely, unless the shortcut is disabled and its entry must survive. */
  function resetBinding(id: ShortcutId) {
    const existing = shortcutConfigMap.get(id);
    if (!existing) return;
    const rest = ($settings.shortcuts).filter(c => c.id !== id);
    if (!existing.enabled) {
      settings.save({ shortcuts: [...rest, { ...existing, binding: null }] });
    } else {
      settings.save({ shortcuts: rest });
    }
  }

  /** Clears every custom binding while keeping the shortcuts the user switched off. */
  function resetAllBindings() {
    const next = ($settings.shortcuts)
      .filter(c => !c.enabled)
      .map(c => ({ ...c, binding: null }));
    settings.save({ shortcuts: next });
  }

  function toggleShortcut(id: ShortcutId) {
    const existing = shortcutConfigMap.get(id);
    if (existing) {
      settings.save({
        shortcuts: ($settings.shortcuts).map(c => c.id === id ? { ...c, enabled: !c.enabled } : c),
      });
    } else {
      settings.save({ shortcuts: [...($settings.shortcuts), { id, binding: null, enabled: false }] });
    }
  }

  const GROUPS: { key: string; label: string }[] = (['files','tree','tabs','view','app','editor'] as const)
    .map(key => ({ key, label: SHORTCUT_GROUP_LABELS[key] ?? key }));
</script>

<svelte:window on:keydown={handleRecordKeydown} on:mousedown|capture={handleRecordMousedown} />

<div class="sc-toolbar">
  <div class="sc-search-bar">
    <Icon name="search" size={13}/>
    <input
      class="sc-search-input"
      bind:value={shortcutSearch}
      placeholder={t('settings.shortcuts.searchPlaceholder') as string}
      aria-label={t('settings.shortcuts.searchAriaLabel') as string}
    />
    {#if shortcutSearch}
      <button class="search-clear" on:click={() => shortcutSearch = ''} aria-label={t('settings.shortcuts.clearSearch') as string}>
        <Icon name="x" size={11}/>
      </button>
    {/if}
  </div>
  {#if conflictIds.size > 0}
    <span class="sc-conflict-notice">
      <Icon name="alert" size={13}/> {(t('settings.shortcuts.conflicts') as (n: number) => string)(conflictIds.size)}
    </span>
  {/if}
  <button class="btn ghost sc-reset-all" on:click={resetAllBindings}>
    <Icon name="undo" size={12}/> {t('settings.shortcuts.resetAll')}
  </button>
</div>

{#each GROUPS as { key: group, label }}
  {@const defs = filteredShortcutDefs.filter(d => d.group === group)}
  {#if defs.length > 0}
    <div class="settings-group" style="margin-top: 20px; max-width: 640px;">
      <div class="settings-group-title">{label}</div>
      {#each defs as def}
        {@const binding = $shortcuts[def.id]}
        {@const scConfig = shortcutConfigMap.get(def.id)}
        {@const isCustom = !!scConfig?.binding}
        {@const isDisabled = scConfig ? !scConfig.enabled : false}
        {@const isConflict = conflictIds.has(def.id)}
        {@const isRecording = recordingId === def.id}
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <div
          class="sc-row"
          class:sc-conflict={isConflict && !isDisabled}
          class:sc-recording={isRecording}
          class:sc-disabled={isDisabled}
          on:click={() => { if (!isDisabled) startRecording(def.id); }}
        >
          <!-- svelte-ignore a11y-click-events-have-key-events -->
          <!-- svelte-ignore a11y-no-static-element-interactions -->
          <div class="sc-toggle" on:click|stopPropagation>
            <label class="settings-toggle" aria-label={t('settings.shortcuts.enableShortcut') as string}>
              <input
                type="checkbox"
                checked={!isDisabled}
                on:change={() => toggleShortcut(def.id)}
              />
              <span class="settings-toggle-track"><span class="settings-toggle-thumb"></span></span>
            </label>
          </div>

          <div class="settings-row-info">
            <span class="settings-row-label">
              {def.label}
              {#if isCustom && !isDisabled}<span class="sc-custom-dot" title={t('settings.shortcuts.customized') as string}></span>{/if}
            </span>
            <span class="settings-row-desc">{def.description}</span>
          </div>

          <span class="sc-keys">
            {#if isRecording}
              <span class="sc-recording-hint">{def.mouse ? t('settings.shortcuts.pressClickCombo') : t('settings.shortcuts.pressKeyCombo')}</span>
            {:else if !isDisabled}
              {#if !binding}
                <span class="sc-unbound">{t('settings.shortcuts.unbound')}</span>
              {/if}
              {#each bindingToLabels(binding) as kLabel, i}
                {#if i > 0}<span class="sc-plus">+</span>{/if}
                <kbd class="sc-kbd">{kLabel}</kbd>
              {/each}
              {#if isConflict}
                <span class="sc-conflict-icon" title={t('settings.shortcuts.conflictsWithAnother') as string}>
                  <Icon name="alert" size={12}/>
                </span>
              {/if}
            {/if}
          </span>

          <button
            class="settings-reset-btn"
            title={t('settings.shortcuts.resetToDefault') as string}
            disabled={!isCustom || isDisabled}
            on:click|stopPropagation={() => resetBinding(def.id)}
            aria-label={t('settings.shortcuts.resetShortcut') as string}
          >
            <Icon name="undo" size={12}/>
          </button>
        </div>
      {/each}
    </div>
  {/if}
{/each}
{#if filteredShortcutDefs.length === 0}
  <div style="margin-top: 24px; color: var(--fg-3); font-size: 13px;">
    {(t('settings.shortcuts.noResults') as (q: string) => string)(shortcutSearch)}
  </div>
{/if}

<style>
  .sc-toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 16px;
    max-width: 640px;
    flex-wrap: wrap;
  }

  .sc-search-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    background: var(--bg-0);
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-sm);
    color: var(--fg-3);
    transition: border-color 0.15s;
    flex: 1;
    min-width: 160px;
  }
  .sc-search-bar:focus-within {
    border-color: var(--accent-line);
    color: var(--fg-1);
  }
  .sc-search-input {
    background: transparent;
    border: none;
    outline: none;
    font-size: 12px;
    font-family: var(--font-ui);
    color: var(--fg-0);
    flex: 1;
    min-width: 0;
  }
  .sc-search-input::placeholder { color: var(--fg-4); }

  .search-clear {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    color: var(--fg-3);
    display: flex;
    align-items: center;
  }
  .search-clear:hover { color: var(--fg-0); }

  .sc-toggle { margin-right: 4px; }

  .sc-disabled { opacity: 0.45; cursor: default; }
  .sc-disabled:hover { background: var(--bg-2); border-color: var(--stroke-0); }

  .sc-conflict-notice {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 11.5px;
    color: var(--warning);
    flex: 1;
  }

  .sc-reset-all { margin-left: auto; font-size: 12px; }

  .sc-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    background: var(--bg-2);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-md);
    margin-bottom: 5px;
    cursor: pointer;
    transition: background .1s, border-color .1s;
  }
  .sc-row:hover { background: var(--bg-3); border-color: var(--stroke-1); }
  .sc-row.sc-recording {
    background: var(--accent-weak);
    border-color: var(--accent-line);
  }
  .sc-row.sc-conflict { border-color: oklch(0.80 0.14 75 / 0.5); }

  .sc-keys {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  .sc-unbound {
    font-size: 11px;
    color: var(--fg-4);
    font-style: italic;
  }
  .sc-plus {
    font-size: 10px;
    color: var(--fg-4);
    margin: 0 1px;
  }

  .sc-kbd {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 22px;
    height: 20px;
    padding: 0 6px;
    background: var(--bg-0);
    border: 1px solid var(--stroke-1);
    border-bottom-width: 2px;
    border-radius: var(--r-xs);
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--fg-1);
    line-height: 1;
  }

  .sc-recording-hint {
    font-size: 12px;
    color: var(--accent);
    font-style: italic;
    padding: 2px 8px;
    background: var(--accent-weak);
    border: 1px dashed var(--accent-line);
    border-radius: var(--r-xs);
  }

  .sc-conflict-icon {
    color: var(--warning);
    display: flex;
    align-items: center;
    margin-left: 4px;
  }

  .sc-custom-dot {
    display: inline-block;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--accent);
    margin-left: 5px;
    vertical-align: middle;
  }
</style>
