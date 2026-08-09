<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n';
  import { formatCount, formatTokens, formatUsd } from '$lib/utils/format';
  import type { UsageGroup } from '$lib/utils/home/usage-stats';

  export let title: string;
  export let icon: string;
  export let groups: UsageGroup[] = [];
  /** What the share bar and the ranking stand for. */
  export let metric: 'cost' | 'tokens' = 'cost';
  export let limit = 6;
  export let emptyLabel: string;

  let expanded = false;

  $: shown = expanded ? groups : groups.slice(0, limit);
  $: hidden = groups.length - shown.length;
</script>

<section class="card">
  <header>
    <span class="tile"><Icon name={icon} size={11}/></span>
    <h3>{title}</h3>
    <span class="count">{groups.length}</span>
  </header>

  {#if groups.length === 0}
    <p class="empty">{emptyLabel}</p>
  {:else}
    <ul>
      {#each shown as group (group.key)}
        <li>
          <div class="row">
            <span class="label selectable" title={group.label}>{group.label}</span>
            <span class="value">
              {metric === 'cost' ? formatUsd(group.costUsd) : formatTokens(group.tokens)}
            </span>
          </div>
          <div class="track">
            <div class="fill" style="width: {Math.max(1, group.share * 100)}%"></div>
          </div>
          <div class="meta">
            <span>{(t('home.usage.turnsCount') as (n: string) => string)(formatCount(group.turns))}</span>
            <span>{Math.round(group.share * 100)}%</span>
            <span>
              {formatTokens(group.inputTokens + group.cacheReadTokens)} in
              / {formatTokens(group.outputTokens)} out
            </span>
          </div>
        </li>
      {/each}
    </ul>

    {#if hidden > 0 || expanded}
      <button class="more" on:click={() => expanded = !expanded}>
        {expanded
          ? t('home.usage.showLess')
          : (t('home.usage.showMore') as (n: string) => string)(String(hidden))}
      </button>
    {/if}
  {/if}
</section>

<style>
  .card {
    padding: 16px 18px;
    background: var(--bg-2);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-lg);
    min-width: 0;
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 14px;
  }
  .tile {
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border-radius: var(--r-xs);
    background: var(--bg-3);
    color: var(--fg-2);
    flex-shrink: 0;
  }
  h3 {
    margin: 0;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--fg-3);
    flex: 1;
  }
  .count {
    font-size: 10.5px;
    font-family: var(--font-mono);
    color: var(--fg-3);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .row {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }
  .label {
    flex: 1;
    min-width: 0;
    font-size: 12.5px;
    color: var(--fg-1);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .value {
    flex-shrink: 0;
    font-size: 12.5px;
    font-family: var(--font-mono);
    color: var(--fg-0);
  }
  .track {
    height: 4px;
    margin-top: 5px;
    border-radius: 2px;
    background: var(--bg-4);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: var(--accent);
    border-radius: 2px;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 10px;
    margin-top: 4px;
    font-size: 10.5px;
    color: var(--fg-3);
    font-family: var(--font-mono);
  }
  .meta span:last-child { margin-left: auto; }
  .empty {
    margin: 0;
    font-size: 12px;
    color: var(--fg-3);
  }
  .more {
    margin-top: 12px;
    padding: 0;
    background: none;
    border: none;
    cursor: pointer;
    font-family: var(--font-ui);
    font-size: 11.5px;
    color: var(--accent);
  }
  .more:hover { text-decoration: underline; }
</style>
