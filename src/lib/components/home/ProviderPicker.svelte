<script lang="ts">
  /**
   * Tiles to pick the agents an entry targets, showing which others it ends up reaching.
   * Dispatches `change` with the new selection; a refused pick shows its reason instead.
   */
  import { createEventDispatcher } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import ProviderLogo from '$lib/components/home/agents/ProviderLogo.svelte';
  import { t } from '$lib/i18n';
  import { cliProviders } from '$lib/stores/cli-providers';
  import { impliedProviders, sortProviders } from '$lib/utils/home/cli-providers';
  import type { CliProviderId } from '$lib/services/cli-provider-service';

  /** The agents the entry is written for. */
  export let selected: CliProviderId[] = [];
  /** The agents that end up reading it, shared files included. */
  export let reached: CliProviderId[] = [];
  /** Agents this scope has no place for, with the reason to show. */
  export let unavailable: Partial<Record<CliProviderId, string>> = {};
  export let disabled = false;

  const dispatch = createEventDispatcher<{ change: CliProviderId[] }>();

  $: implied = impliedProviders(selected, reached);

  /** Why the last click was refused, cleared as soon as one succeeds. */
  let notice = '';
  $: if (selected) notice = '';

  /**
   * Why an agent cannot be picked, or nothing. An agent that is missing from
   * this machine still shows the entries already written for it, so they can be
   * cleaned up - only adding is refused.
   *
   * Reactive rather than a plain function: the template only re-reads a call
   * when its arguments change, so a plain function never noticed `unavailable`
   * changing and a scope switch left the refused agents looking pickable.
   */
  $: blockedReason = (id: CliProviderId): string => {
    if (unavailable[id]) return unavailable[id] as string;
    const known = $cliProviders.find((p) => p.id === id);
    if (known && !known.configured && !selected.includes(id)) {
      return (t('cliProviders.notInstalled') as (name: string) => string)(known.label);
    }
    return '';
  };

  function toggle(id: CliProviderId) {
    if (disabled) return;
    // Removing is always allowed; it is what takes a stale copy back out.
    if (selected.includes(id)) {
      dispatch('change', selected.filter((p) => p !== id));
      return;
    }
    const blocked = blockedReason(id);
    if (blocked) {
      notice = blocked;
      return;
    }
    dispatch('change', sortProviders([...selected, id]));
  }

  function all() {
    dispatch('change', sortProviders(
      $cliProviders
        .filter((p) => p.configured && !unavailable[p.id])
        .map((p) => p.id),
    ));
  }
</script>

<div class="picker">
  <div class="grid">
    {#each $cliProviders as provider (provider.id)}
      {@const on = selected.includes(provider.id)}
      {@const blocked = blockedReason(provider.id)}
      {@const off = blocked !== ''}
      <button
        class="target"
        class:on
        class:off
        aria-pressed={on}
        aria-disabled={off && !on}
        {disabled}
        title={blocked || provider.label}
        on:click={() => toggle(provider.id)}
      >
        <span class="mark">
          <ProviderLogo id={provider.id} size={15} fallback={provider.label.slice(0, 1)}/>
        </span>
        <span class="name">{provider.label}</span>
        {#if !provider.configured}
          <span class="absent">{t('cliProviders.absent')}</span>
        {/if}
        <span class="state">
          {#if on}
            <Icon name="check" size={12}/>
          {:else if off}
            <Icon name="none" size={12}/>
          {/if}
        </span>
      </button>
    {/each}
  </div>

  <div class="foot">
    {#if notice}
      <span class="ag-hint warn">{notice}</span>
    {:else if implied.length > 0}
      <span class="ag-hint">
        {(t('cliProviders.alsoReaches') as (names: string) => string)(
          implied.map((id) => $cliProviders.find((p) => p.id === id)?.label ?? id).join(', '),
        )}
      </span>
    {:else if selected.length === 0}
      <span class="ag-hint warn">{t('cliProviders.pickOne')}</span>
    {:else}
      <span class="ag-hint">{t('cliProviders.hint')}</span>
    {/if}
    {#if !disabled}
      <button class="btn ghost all" on:click={all}>{t('cliProviders.selectAll')}</button>
    {/if}
  </div>
</div>

<style>
  .picker { display: flex; flex-direction: column; gap: 10px; }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(168px, 1fr));
    gap: 6px;
  }

  .target {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 8px 10px;
    background: var(--bg-1);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-md);
    text-align: left;
    cursor: pointer;
    font-family: var(--font-ui);
    color: var(--fg-2);
    transition: background .12s, border-color .12s, color .12s;
  }
  .target:hover:not(:disabled) { background: var(--bg-3); color: var(--fg-0); }
  .target.on {
    background: var(--accent-weak);
    border-color: var(--accent-line);
    color: var(--fg-0);
  }
  .target:disabled { opacity: .45; cursor: not-allowed; }
  /* Refused rather than dead: the click still lands and says why. */
  .target.off:not(.on) { opacity: .5; }
  .target.off:not(.on):hover { background: var(--bg-1); color: var(--fg-2); }

  .mark { display: grid; place-items: center; flex-shrink: 0; }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12.5px;
  }
  .absent {
    flex-shrink: 0;
    padding: 1px 5px;
    background: var(--bg-3);
    border-radius: 99px;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: .04em;
    color: var(--fg-4);
  }

  .state {
    display: grid;
    place-items: center;
    width: 14px;
    flex-shrink: 0;
    color: var(--accent);
  }
  .target.off .state { color: var(--fg-4); }

  .foot {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .foot .ag-hint { flex: 1; min-width: 0; }
  .all { flex-shrink: 0; font-size: 11px; padding: 3px 8px; }
</style>
