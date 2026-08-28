<script lang="ts">
  /**
   * Editable map of string pairs, used for MCP env vars and HTTP headers.
   * Dispatches `change` with the whole map; `secret` masks the values until revealed.
   */
  import { createEventDispatcher } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n';

  export let pairs: Record<string, string> = {};
  export let keyPlaceholder = '';
  export let valuePlaceholder = '';
  export let secret = false;

  const dispatch = createEventDispatcher<{ change: Record<string, string> }>();

  let newKey = '';
  let newValue = '';
  let revealed: Record<string, boolean> = {};

  $: entries = Object.entries(pairs);

  function emit(next: Record<string, string>) {
    dispatch('change', next);
  }

  /** Renames a key in place, so the pairs keep the order they were typed in. */
  function rename(from: string, to: string) {
    const trimmed = to.trim();
    if (trimmed === from) return;
    const next: Record<string, string> = {};
    for (const [key, value] of Object.entries(pairs)) {
      next[key === from ? trimmed : key] = value;
    }
    if (trimmed === '') delete next[''];
    emit(next);
  }

  function setValue(key: string, value: string) {
    emit({ ...pairs, [key]: value });
  }

  function remove(key: string) {
    const next = { ...pairs };
    delete next[key];
    emit(next);
  }

  function add() {
    const key = newKey.trim();
    if (!key) return;
    emit({ ...pairs, [key]: newValue });
    newKey = '';
    newValue = '';
  }

  /**
   * A token pasted here should not sit in plain sight on a shared screen.
   * Reactive rather than a plain function: the template only re-reads a call
   * when its arguments change, so a plain `isHidden(key)` never noticed the
   * reveal toggling and the eye button did nothing.
   */
  $: isHidden = (key: string): boolean =>
    secret && !revealed[key] && pairs[key] !== '';
</script>

<div class="kv">
  {#each entries as [key, value] (key)}
    <div class="kv-row">
      <input
        class="ag-input selectable"
        type="text"
        aria-label={keyPlaceholder}
        value={key}
        on:change={(e) => rename(key, e.currentTarget.value)}
      />
      <input
        class="ag-input selectable"
        type={isHidden(key) ? 'password' : 'text'}
        aria-label={valuePlaceholder}
        {value}
        on:input={(e) => setValue(key, e.currentTarget.value)}
      />
      {#if secret}
        <button
          class="kv-btn"
          on:click={() => revealed = { ...revealed, [key]: !revealed[key] }}
          title={t('mcp.fields.reveal') as string}
        >
          <Icon name="eye" size={12}/>
        </button>
      {/if}
      <button class="kv-btn danger" on:click={() => remove(key)} title={t('common.remove') as string}>
        <Icon name="trash" size={12}/>
      </button>
    </div>
  {/each}

  <div class="kv-row">
    <input
      class="ag-input selectable"
      type="text"
      placeholder={keyPlaceholder}
      aria-label={keyPlaceholder}
      bind:value={newKey}
      on:keydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
    />
    <input
      class="ag-input selectable"
      type="text"
      placeholder={valuePlaceholder}
      aria-label={valuePlaceholder}
      bind:value={newValue}
      on:keydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
    />
    <button class="kv-btn" on:click={add} disabled={!newKey.trim()} title={t('common.add') as string}>
      <Icon name="plus" size={12}/>
    </button>
  </div>
</div>

<style>
  .kv { display: flex; flex-direction: column; gap: 6px; }

  .kv-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .kv-row :global(.ag-input) { flex: 1; min-width: 0; }
  .kv-row :global(.ag-input:first-child) {
    flex: 0 0 34%;
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .kv-btn {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    flex-shrink: 0;
    padding: 0;
    background: none;
    border: 1px solid transparent;
    border-radius: var(--r-sm);
    color: var(--fg-3);
    cursor: pointer;
  }
  .kv-btn:hover:not(:disabled) { background: var(--bg-3); color: var(--fg-0); border-color: var(--stroke-0); }
  .kv-btn.danger:hover { background: var(--danger-weak); color: var(--danger); border-color: transparent; }
  .kv-btn:disabled { opacity: .4; cursor: default; }
</style>
