<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * Choosing which CLI a new conversation runs. A grid of square tiles in the
   * spirit of the tools panel: a logo and a name, installed first, greyed out
   * when the binary is not on this machine.
   *
   * The tile carries the logo and the name and nothing else - a version, a path
   * and a resume caveat are what you check once, not what you scan a grid for,
   * so they live in the tooltip and on the Providers page.
   *
   * The registry comes from the cache: detecting means running every installed
   * CLI to read its version, and repeating that each time this view opens is a
   * wait on a screen crossed often. A CLI installed meanwhile is picked up by
   * the refresh button rather than by making everyone pay for it.
   */
  import Icon from '$lib/components/Icon.svelte';
  import ProviderLogo from '$lib/components/home/agents/ProviderLogo.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import { t } from '$lib/i18n';
  import type { CliProviderDef, CliProviderId } from '$lib/services/cli-provider-service';

  interface Props {
    providers: CliProviderDef[];
    /** False while detection is still running. */
    ready: boolean;
    /** The CLI last used in this project, offered first and focused. */
    preferred: CliProviderId | null;
    onPick: (cli: CliProviderId) => void;
    /** Detects again, for a CLI installed while Cairn was running. */
    onRefresh: () => void;
    /** Opens the hub page where a missing CLI can be looked up. */
    onOpenProviders: () => void;
  }

  const {
    providers,
    ready,
    preferred,
    onPick,
    onRefresh,
    onOpenProviders,
  }: Props = $props();

  /** Placeholders drawn while detecting: the registry size, so the grid holds still. */
  const SKELETON_TILES = 7;

  let cardEls = $state<Record<string, HTMLButtonElement>>({});

  /** Everything the tile does not show: version, binary, resume caveat. */
  function tooltipFor(provider: CliProviderDef): string {
    if (!provider.installed) return t('agent.picker.notInstalled') as string;
    return [provider.version, provider.path].filter(Boolean).join('\n');
  }

  /** Installed first, registry order within each half. */
  let ordered = $derived(
    [...providers].sort((a, b) => Number(b.installed) - Number(a.installed)),
  );

  let installed = $derived(ordered.filter((p) => p.installed));

  /** The card that takes the keyboard: the last CLI used, else the first installed one. */
  let focusId = $derived(
    installed.find((p) => p.id === preferred)?.id ?? installed[0]?.id ?? null,
  );

  $effect(() => {
    if (!ready || !focusId) return;
    const el = cardEls[focusId];
    if (el) requestAnimationFrame(() => el.focus());
  });

  /** Arrow keys walk the installed cards; the absent ones cannot be launched. */
  function onKeydown(e: KeyboardEvent, id: CliProviderId) {
    const keys = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const index = installed.findIndex((p) => p.id === id);
    if (index < 0) return;
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
    const next = installed[(index + step + installed.length) % installed.length];
    cardEls[next.id]?.focus();
  }
</script>

<div class="picker">
  <div class="picker-inner">
    <div class="picker-head">
      <span class="picker-icon"><Icon name="sparkles" size={22}/></span>
      <h2>{t('agent.picker.title')}</h2>
      <p>{t('agent.picker.subtitle')}</p>
    </div>

  {#if !ready}
    <!-- One placeholder per tile, laid out on the same grid, so the detection
         does not resize the block the moment it lands. -->
    <div class="grid">
      {#each { length: SKELETON_TILES } as _, i (i)}
        <div class="tile-skeleton"><Skeleton lines={1} height={64}/></div>
      {/each}
    </div>
  {:else}
    <div class="grid">
      {#each ordered as provider (provider.id)}
        <button
          class="card"
          class:absent={!provider.installed}
          class:preferred={provider.id === preferred && provider.installed}
          bind:this={cardEls[provider.id]}
          disabled={!provider.installed}
          tabindex={provider.installed ? 0 : -1}
          title={tooltipFor(provider)}
          onclick={() => provider.installed && onPick(provider.id)}
          onkeydown={(e) => onKeydown(e, provider.id)}
        >
          <span class="card-mark">
            <ProviderLogo id={provider.id} size={26} fallback={provider.label.slice(0, 1)}/>
          </span>
          <span class="card-name">{provider.label}</span>
          {#if provider.id === preferred && provider.installed}
            <span class="card-badge">{t('agent.picker.lastUsed')}</span>
          {/if}
        </button>
      {/each}
    </div>

    <div class="picker-links">
      <button class="providers-link" onclick={onRefresh}>
        {t('agent.picker.refresh')}
      </button>
      {#if ordered.some((p) => !p.installed)}
        <button class="providers-link" onclick={onOpenProviders}>
          {t('agent.picker.manageProviders')}
        </button>
      {/if}
    </div>
  {/if}
  </div>
</div>

<style>
  /* Every measurement of this view derives from these three, so no width is
     ever written down twice: the tiles size themselves from `--tile`, and the
     column holding them is `--cols` tiles wide by calculation. A figure typed in
     beside them instead is what left the block sitting 12px off centre. */
  .picker {
    --tile: 132px;
    --gap: 12px;
    --cols: 4;
    --grid-width: calc(var(--cols) * var(--tile) + (var(--cols) - 1) * var(--gap));

    /* A column flex whose single child is centred horizontally by `align-items`
       and vertically by `margin: auto` on that child. Deliberately not a grid
       with `justify-content: center`: the implicit column of such a grid sizes
       itself to its content, leaving no free space for `justify-content` to
       distribute, so the block stays wherever it started. */
    display: flex;
    flex-direction: column;
    align-items: center;
    flex: 1;
    width: 100%;
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    padding: 32px 24px;
    box-sizing: border-box;
  }

  /* Exactly as wide as a full row of tiles, which is also what caps the wrap at
     `--cols`. The heading, the tiles and the link therefore share one axis with
     no slack for anything to drift into. */
  .picker-inner {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 20px;
    /* `flex: none` so this keeps the width below: a flex item is free to shrink
       past a definite width, and a shrunken box is centred as the smaller box it
       became rather than as a full row of tiles. */
    flex: none;
    width: min(var(--grid-width), 100%);
    /* Vertical centring that still scrolls: auto margins share the free space
       above and below, and collapse to zero once the content is taller than the
       area, so the heading never ends up above the top of the scroll range. */
    margin-block: auto;
  }

  .picker-head {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }

  .picker-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    margin-bottom: 12px;
    border-radius: 12px;
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    color: var(--accent);
  }

  .picker-head h2 {
    margin: 0 0 6px;
    font-size: 15px;
    font-weight: 600;
    color: var(--fg-0);
  }

  /* Balanced wrapping so the lines come out near equal length; they are centred
     on each other because the block is only as wide as the grid above them. */
  .picker-head p {
    margin: 0;
    font-size: 12.5px;
    line-height: 1.6;
    color: var(--fg-2);
    text-align: center;
    text-wrap: balance;
  }

  /* Wrapping flex rather than a grid: a grid cannot centre a partial last row.
     Its tracks are fixed columns, so a final row of three tiles under four
     starts at column one and hangs to the left - which is exactly what a
     seven-CLI registry produces. Flex centres every row it wraps, the last one
     included, and wraps on its own when the window narrows, so the column count
     needs no breakpoints of its own. */
  .grid {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--gap);
    width: 100%;
  }

  /* `aspect-ratio` yields to content that does not fit, so a two-word name
     wrapping to a second line would make its tile taller than the row and push
     the grid out of shape. The name below reserves two lines' height for every
     tile, which keeps them all square and all names on the same baseline. */
  /* The tile carries its own width now that the container no longer declares
     tracks. `aspect-ratio` yields to content that does not fit, so a two-word
     name wrapping to a second line would make its tile taller than the row; the
     name below reserves two lines' height on every tile to keep them square. */
  .card,
  .tile-skeleton {
    width: var(--tile);
    aspect-ratio: 1;
    flex: 0 0 auto;
    border: 1px solid var(--stroke-0);
    border-radius: 10px;
    box-sizing: border-box;
  }

  .card {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 12px;
    background: var(--bg-1);
    cursor: pointer;
    color: inherit;
    font: inherit;
    transition: border-color 0.12s ease, background 0.12s ease;
  }

  .tile-skeleton {
    background: var(--bg-1);
    padding: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .card:hover:not(.absent) { background: var(--bg-2); }

  .card:focus-visible {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent);
  }

  .card.preferred { border-color: color-mix(in srgb, var(--accent) 50%, var(--stroke-0)); }

  .card.absent {
    opacity: 0.45;
    cursor: default;
  }

  .card-mark {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    flex-shrink: 0;
    border-radius: 10px;
    background: var(--bg-2);
    color: var(--fg-1);
    font-size: 16px;
    font-weight: 600;
  }

  .card-name {
    display: flex;
    align-items: center;
    justify-content: center;
    /* Two lines' worth, always: one-word and two-word names then occupy the
       same box and centre identically under the logo. */
    height: calc(2 * 1.3em);
    font-size: 12px;
    font-weight: 600;
    line-height: 1.3;
    color: var(--fg-0);
    text-align: center;
    overflow-wrap: anywhere;
  }

  .card-badge {
    position: absolute;
    top: 6px;
    right: 6px;
    padding: 1px 5px;
    font-size: 9.5px;
    font-weight: 500;
    border-radius: 4px;
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    color: var(--accent);
  }

  .picker-links {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .providers-link {
    background: none;
    border: none;
    padding: 0;
    font-size: 12px;
    color: var(--accent);
    cursor: pointer;
    text-decoration: underline;
  }
</style>
