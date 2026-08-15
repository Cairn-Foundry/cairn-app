<script lang="ts">
  /**
   * Modal importing variables from a pasted or picked .env file, into a chosen
   * scope. `replace` decides whether keys already present are overwritten.
   */
  import { createEventDispatcher } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Select from '$lib/components/Select.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import { t } from '$lib/i18n';
  import type { EnvScope } from '$lib/services/env-service';
  import { readEnvFile } from '$lib/services/env-service';
  import { isReservedEnvKey, type ParsedEnvEntry, parseEnvFile } from '$lib/utils/env/env-file';

  export let worktreePath: string | null = null;
  export let defaultFileName = '.env';
  export let existingKeys: string[] = [];

  const dispatch = createEventDispatcher<{
    import: { scope: EnvScope; entries: ParsedEnvEntry[]; replace: boolean };
    close: void;
  }>();

  let raw = '';
  let scope: EnvScope = 'project';
  let replace = true;
  let reading = false;
  let selected = new Set<string>();
  let touched = false;

  $: scopeOptions = [
    { value: 'global', label: t('env.scope.global') as string },
    { value: 'project', label: t('env.scope.project') as string },
    { value: 'instance', label: t('env.scope.instance') as string },
  ];

  $: parsed = parseEnvFile(raw);
  $: entries = parsed.entries.filter((e) => !isReservedEnvKey(e.key));
  $: reserved = parsed.entries.filter((e) => isReservedEnvKey(e.key));
  $: if (!touched) selected = new Set(entries.map((e) => e.key));
  $: chosen = entries.filter((e) => selected.has(e.key));

  function toggle(key: string) {
    touched = true;
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    selected = next;
  }

  function toggleAll() {
    touched = true;
    selected = selected.size === entries.length ? new Set() : new Set(entries.map((e) => e.key));
  }

  async function pickFile() {
    reading = true;
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const path = await open({ multiple: false, directory: false });
      if (typeof path !== 'string') return;
      const { readFile } = await import('$lib/services/file-service');
      raw = (await readFile(path)) ?? '';
      touched = false;
    } finally {
      reading = false;
    }
  }

  async function loadFromWorktree() {
    if (!worktreePath) return;
    reading = true;
    try {
      raw = await readEnvFile(worktreePath, defaultFileName);
      touched = false;
    } finally {
      reading = false;
    }
  }

  function commit() {
    if (chosen.length === 0) return;
    dispatch('import', { scope, entries: chosen, replace });
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="modal-backdrop"
  role="dialog"
  aria-modal="true"
  tabindex="-1"
  on:click={() => dispatch('close')}
  on:keydown={(e) => e.key === 'Escape' && dispatch('close')}
>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="modal ei-modal" on:click|stopPropagation role="presentation">
    <div class="modal-head">
      <div>
        <div class="step-count">{t('env.importHeading')}</div>
        <h3>{defaultFileName}</h3>
      </div>
      <button class="icon-btn close" on:click={() => dispatch('close')} aria-label={t('common.close') as string}>
        <Icon name="x" size={16}/>
      </button>
    </div>

    <div class="modal-body">
      <div class="ei-sources">
        <button class="btn ghost" disabled={reading} on:click={pickFile}>
          {#if reading}<Spinner size={12}/>{:else}<Icon name="folder" size={13}/>{/if}
          {t('env.importPickFile')}
        </button>
        {#if worktreePath}
          <button class="btn ghost" disabled={reading} on:click={loadFromWorktree}>
            <Icon name="download" size={13}/> {t('env.importFromWorktree')}
          </button>
        {/if}
      </div>

      <textarea
        class="ei-input mono selectable ei-raw"
        rows="7"
        bind:value={raw}
        on:input={() => touched = false}
        spellcheck="false"
        placeholder={'KEY=value'}
      ></textarea>

      {#if parsed.invalid.length > 0}
        <p class="ei-warn">
          {(t('env.importInvalid') as (n: number) => string)(parsed.invalid.length)}
        </p>
      {/if}
      {#if reserved.length > 0}
        <p class="ei-warn">
          {(t('env.importReserved') as (n: number) => string)(reserved.length)}
        </p>
      {/if}

      {#if entries.length > 0}
        <div class="ei-head">
          <span class="ei-count">{(t('env.importDetected') as (n: number) => string)(entries.length)}</span>
          <button class="ei-all" on:click={toggleAll}>
            {selected.size === entries.length ? t('env.importNone') : t('env.importAll')}
          </button>
        </div>
        <div class="ei-list">
          {#each entries as entry (entry.key)}
            <label class="ei-row">
              <input type="checkbox" checked={selected.has(entry.key)} on:change={() => toggle(entry.key)}/>
              <span class="ei-key mono selectable">{entry.key}</span>
              {#if existingKeys.includes(entry.key)}
                <span class="ei-badge">{t('env.importExisting')}</span>
              {:else}
                <span></span>
              {/if}
            </label>
          {/each}
        </div>
      {/if}

      <div class="ei-options">
        <label class="ei-option">
          <span class="ei-label">{t('env.importTarget')}</span>
          <Select
            value={scope}
            options={scopeOptions}
            ariaLabel={t('env.importTarget') as string}
            on:change={(e) => (scope = e.detail as EnvScope)}
          />
        </label>
        <label class="ei-check">
          <input type="checkbox" bind:checked={replace}/>
          <span>{t('env.importReplace')}</span>
        </label>
      </div>
    </div>

    <div class="modal-foot">
      <div class="spacer"></div>
      <button class="btn ghost" on:click={() => dispatch('close')}>{t('common.cancel')}</button>
      <button class="btn primary" disabled={chosen.length === 0} on:click={commit}>
        <Icon name="download" size={13}/> {(t('env.importCount') as (n: number) => string)(chosen.length)}
      </button>
    </div>
  </div>
</div>

<style>
  .ei-modal { width: min(560px, 94vw); }


  .ei-input {
    width: 100%;
    box-sizing: border-box;
    background: var(--bg-0);
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-sm);
    padding: 8px 10px;
    font-size: 13px;
    color: var(--fg-0);
    font-family: var(--font-ui);
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .ei-input:focus { border-color: var(--accent-line); box-shadow: 0 0 0 3px var(--accent-weak); }
  .ei-input::placeholder { color: var(--fg-4); }
  .ei-input.mono { font-family: var(--font-mono); font-size: 12px; }
  .ei-input:disabled { opacity: 0.5; cursor: default; }

  .ei-sources { display: flex; gap: 8px; margin-bottom: 10px; }

  .ei-raw { resize: vertical; }

  .ei-warn { margin: 8px 0 0; font-size: 11.5px; color: var(--fg-4); line-height: 1.5; }

  .ei-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 12px 0 6px;
  }

  .ei-count {
    font-size: 11px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--fg-3);
  }

  .ei-all {
    background: none;
    border: none;
    color: var(--fg-3);
    font-size: 12px;
    font-family: var(--font-ui);
    cursor: pointer;
  }
  .ei-all:hover { color: var(--fg-0); }

  .ei-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 180px;
    overflow-y: auto;
  }

  .ei-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    padding: 5px 8px;
    border-radius: var(--r-sm);
    cursor: pointer;
  }
  .ei-row:hover { background: var(--bg-2); }

  .ei-key { font-size: 12px; color: var(--fg-1); overflow: hidden; text-overflow: ellipsis; }

  .ei-badge {
    padding: 1px 6px;
    background: var(--bg-2);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-xs);
    font-size: 10.5px;
    color: var(--fg-4);
  }

  .ei-options {
    display: flex;
    align-items: flex-end;
    gap: 16px;
    margin-top: 14px;
  }

  .ei-option { display: flex; flex-direction: column; gap: 5px; width: 180px; }

  .ei-label {
    font-size: 11px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--fg-3);
  }

  .ei-check { display: flex; align-items: center; gap: 7px; font-size: 12.5px; color: var(--fg-2); cursor: pointer; }
</style>
