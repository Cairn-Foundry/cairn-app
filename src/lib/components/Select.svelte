<script lang="ts">
  import { createEventDispatcher, tick } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { clickOutside } from '$lib/utils/click-outside';

  export let value: string;
  export let options: { value: string; label: string }[] = [];
  export let disabled = false;
  export let ariaLabel = '';

  const dispatch = createEventDispatcher<{ change: string }>();

  const PANEL_MARGIN = 8;

  let open = false;
  let highlighted = 0;
  let triggerEl: HTMLButtonElement | null = null;
  let panelEl: HTMLDivElement | null = null;
  let panelStyle = '';

  $: selected = options.find((o) => o.value === value) ?? null;

  function place() {
    if (!triggerEl) return;
    const rect = triggerEl.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - PANEL_MARGIN;
    const above = rect.top - PANEL_MARGIN;
    const opensUp = below < 160 && above > below;
    const maxHeight = Math.min(280, Math.max(120, opensUp ? above : below));
    const vertical = opensUp
      ? `bottom: ${window.innerHeight - rect.top + 4}px`
      : `top: ${rect.bottom + 4}px`;
    panelStyle = `left: ${rect.left}px; width: ${rect.width}px; ${vertical}; --panel-max: ${maxHeight}px`;
  }

  async function toggle() {
    if (disabled) return;
    open = !open;
    if (!open) return;
    highlighted = Math.max(0, options.findIndex((o) => o.value === value));
    await tick();
    place();
  }

  function pick(next: string) {
    open = false;
    if (next === value) return;
    value = next;
    dispatch('change', next);
  }

  function onKeydown(e: KeyboardEvent) {
    if (disabled) return;
    if (e.key === 'Escape') {
      open = false;
      return;
    }
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        void toggle();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      highlighted = (highlighted + 1) % options.length;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlighted = (highlighted - 1 + options.length) % options.length;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const option = options[highlighted];
      if (option) pick(option.value);
    }
  }

  function onScrollCapture(e: Event) {
    if (!open) return;
    if (panelEl?.contains(e.target as Node)) return;
    open = false;
  }
</script>

<svelte:window on:resize={() => open && place()} on:scroll|capture={onScrollCapture} />

<div class="select" use:clickOutside={() => (open = false)}>
  <button
    type="button"
    class="select-trigger"
    class:open
    bind:this={triggerEl}
    {disabled}
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-label={ariaLabel || undefined}
    on:click={toggle}
    on:keydown={onKeydown}
  >
    <span class="select-label">{selected?.label ?? ''}</span>
    <Icon name="chev-d" size={10}/>
  </button>

  {#if open}
    <div class="select-panel" role="listbox" bind:this={panelEl} style={panelStyle}>
      {#each options as option, i (option.value)}
        <button
          type="button"
          class="select-option"
          class:active={option.value === value}
          class:highlighted={i === highlighted}
          role="option"
          aria-selected={option.value === value}
          on:mouseenter={() => (highlighted = i)}
          on:click={() => pick(option.value)}
        >
          <span class="select-option-label">{option.label}</span>
          {#if option.value === value}<Icon name="check" size={11}/>{/if}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .select { position: relative; }

  .select-trigger {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    background: var(--bg-0);
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-sm);
    color: var(--fg-0);
    font-size: 13px;
    font-family: var(--font-ui);
    text-align: left;
    cursor: pointer;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .select-trigger:hover:not(:disabled) { border-color: var(--accent-line); }
  .select-trigger.open { border-color: var(--accent-line); box-shadow: 0 0 0 3px var(--accent-weak); }
  .select-trigger:disabled { opacity: 0.5; cursor: default; }

  .select-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .select-panel {
    position: fixed;
    z-index: 10000;
    display: flex;
    flex-direction: column;
    max-height: var(--panel-max, 280px);
    overflow-y: auto;
    padding: 4px;
    background: var(--bg-2);
    border: 1px solid var(--stroke-1);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  }

  .select-option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 7px 8px;
    background: transparent;
    border: none;
    border-radius: var(--r-xs);
    color: var(--fg-1);
    font-size: 12.5px;
    font-family: var(--font-ui);
    text-align: left;
    cursor: pointer;
  }
  .select-option.highlighted { background: var(--bg-4); color: var(--fg-0); }
  .select-option.active { color: var(--fg-0); }
  .select-option :global(svg) { color: var(--accent); flex-shrink: 0; }

  .select-option-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
