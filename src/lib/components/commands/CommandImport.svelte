<script lang="ts">
  /**
   * Modal offering the scripts found in the project's package.json as commands to
   * import, preselected. Dispatches `import` with the chosen ones.
   */
  import { createEventDispatcher, onMount } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import { t } from '$lib/i18n';
  import type { CustomCommand } from '$lib/services/custom-command-service';
  import {
    candidateToCommand,
    scanPackageJson,
    type ImportCandidate,
    type PackageManager,
  } from '$lib/utils/commands/command-import';

  export let dir: string;

  const dispatch = createEventDispatcher<{ import: CustomCommand[]; close: void }>();

  let scanning = true;
  let manager: PackageManager = 'npm';
  let candidates: ImportCandidate[] = [];
  let selected = new Set<string>();

  onMount(async () => {
    const scan = await scanPackageJson(dir);
    manager = scan.manager;
    candidates = scan.candidates;
    selected = new Set(candidates.map(c => c.name));
    scanning = false;
  });

  function toggle(name: string) {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    selected = next;
  }

  function toggleAll() {
    selected = selected.size === candidates.length
      ? new Set()
      : new Set(candidates.map(c => c.name));
  }

  function commit() {
    const chosen = candidates.filter(c => selected.has(c.name));
    if (chosen.length === 0) return;
    dispatch('import', chosen.map(candidateToCommand));
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
  <div class="modal ci-modal" on:click|stopPropagation role="presentation">
    <div class="modal-head">
      <div>
        <div class="step-count">{t('commands.importHeading')}</div>
        <h3>package.json</h3>
      </div>
      <button class="icon-btn close" on:click={() => dispatch('close')} aria-label={t('common.close') as string}>
        <Icon name="x" size={16}/>
      </button>
    </div>

    <div class="modal-body">
      {#if scanning}
        <Skeleton lines={5}/>
      {:else if candidates.length === 0}
        <p class="ci-empty">{t('commands.importEmpty')}</p>
      {:else}
        <div class="ci-head">
          <span class="ci-manager mono selectable">{manager}</span>
          <button class="ci-all" on:click={toggleAll}>
            {selected.size === candidates.length ? t('commands.importNone') : t('commands.importAll')}
          </button>
        </div>
        <div class="ci-list">
          {#each candidates as candidate}
            <label class="ci-row">
              <input type="checkbox" checked={selected.has(candidate.name)} on:change={() => toggle(candidate.name)}/>
              <span class="ci-icon"><Icon name={candidate.icon} size={14}/></span>
              <span class="ci-name">{candidate.name}</span>
              <span class="ci-script mono selectable">{candidate.script}</span>
            </label>
          {/each}
        </div>
      {/if}
    </div>

    <div class="modal-foot">
      <div class="spacer"></div>
      <button class="btn ghost" on:click={() => dispatch('close')}>{t('common.cancel')}</button>
      <button class="btn primary" disabled={scanning || selected.size === 0} on:click={commit}>
        <Icon name="download" size={13}/> {(t('commands.importCount') as (n: number) => string)(selected.size)}
      </button>
    </div>
  </div>
</div>

<style>
  .ci-modal { width: min(520px, 94vw); }

  .ci-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }

  .ci-manager {
    padding: 2px 7px;
    background: var(--bg-2);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-xs);
    font-size: 11px;
    color: var(--fg-3);
  }

  .ci-all {
    background: none;
    border: none;
    color: var(--fg-3);
    font-size: 12px;
    font-family: var(--font-ui);
    cursor: pointer;
  }
  .ci-all:hover { color: var(--fg-0); }

  .ci-list { display: flex; flex-direction: column; gap: 2px; }

  .ci-row {
    display: grid;
    grid-template-columns: auto auto minmax(60px, 1fr) minmax(0, 2fr);
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: var(--r-sm);
    cursor: pointer;
  }
  .ci-row:hover { background: var(--bg-2); }

  .ci-icon { display: grid; place-items: center; color: var(--fg-3); }

  .ci-name { font-size: 12.5px; color: var(--fg-1); }

  .ci-script {
    font-size: 11.5px;
    color: var(--fg-4);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ci-empty { margin: 0; font-size: 12.5px; color: var(--fg-3); line-height: 1.6; }
</style>
