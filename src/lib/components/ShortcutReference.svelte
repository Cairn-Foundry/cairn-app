<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { shortcuts, SHORTCUT_DEFS, bindingToLabels, SHORTCUT_GROUP_LABELS } from '$lib/stores/shortcuts';

  const dispatch = createEventDispatcher<{ close: void; goSettings: void }>();

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') dispatch('close');
  }

  const STATIC_EDITOR_TAIL = [
    { keys: ['Tab'],   description: 'Accept completion / insert tab' },
    { keys: ['Enter'], description: 'Accept completion' },
  ];

  $: groups = (['files', 'tabs', 'view', 'editor'] as const).map(group => ({
    label: SHORTCUT_GROUP_LABELS[group] ?? group,
    shortcuts: [
      ...SHORTCUT_DEFS
        .filter(d => d.group === group)
        .map(d => ({ keys: bindingToLabels($shortcuts[d.id]), description: d.label })),
      ...(group === 'editor' ? STATIC_EDITOR_TAIL : []),
    ],
  }));
</script>

<svelte:window on:keydown={handleKeydown} />

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="backdrop" on:click={() => dispatch('close')}>
  <div class="panel" on:click|stopPropagation={() => {}}>
    <div class="header">
      <span class="title">Keyboard Shortcuts</span>
      <div class="header-actions">
        <button
          class="customize-btn"
          on:click={() => { dispatch('goSettings'); dispatch('close'); }}
          title="Customize shortcuts in Settings"
        >
          <Icon name="settings" size={13} />
          Customize
        </button>
        <button class="close-btn" on:click={() => dispatch('close')} aria-label="Close">
          <Icon name="x" size={13} />
        </button>
      </div>
    </div>

    <div class="body">
      {#each groups as group}
        <div class="group">
          <div class="group-label">{group.label}</div>
          {#each group.shortcuts as shortcut}
            <div class="row">
              <span class="desc">{shortcut.description}</span>
              <span class="keys">
                {#each shortcut.keys as label, i}
                  {#if i > 0}<span class="plus">+</span>{/if}
                  <kbd>{label}</kbd>
                {/each}
              </span>
            </div>
          {/each}
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: oklch(0 0 0 / 0.5);
    backdrop-filter: blur(3px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    animation: fade .15s ease-out;
  }

  @keyframes fade { from { opacity: 0; } to { opacity: 1; } }

  .panel {
    background: var(--bg-1);
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-lg);
    width: 460px;
    max-height: 72vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 30px 80px oklch(0 0 0 / 0.6);
    animation: pop .2s cubic-bezier(.3,1.2,.4,1);
  }

  @keyframes pop { from { transform: translateY(10px) scale(.98); opacity: 0; } to { transform: none; opacity: 1; } }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px 14px;
    border-bottom: 1px solid var(--stroke-0);
    flex-shrink: 0;
  }

  .title {
    font-size: 13px;
    font-weight: 500;
    color: var(--fg-0);
    letter-spacing: -0.01em;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .customize-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
    border-radius: var(--r-sm);
    font-size: 12px;
    font-family: var(--font-ui);
    color: var(--fg-2);
    border: 1px solid var(--stroke-0);
    transition: background .12s, color .12s, border-color .12s;
  }
  .customize-btn:hover {
    background: var(--bg-3);
    color: var(--fg-0);
    border-color: var(--stroke-1);
  }

  .close-btn {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: var(--r-sm);
    color: var(--fg-3);
    transition: background .12s, color .12s;
  }

  .close-btn:hover {
    background: var(--bg-3);
    color: var(--fg-0);
  }

  .body {
    overflow-y: auto;
    padding: 6px 0 14px;
  }

  .group {
    padding: 0 20px;
    margin-bottom: 2px;
  }

  .group-label {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-family: var(--font-mono);
    padding: 12px 0 5px;
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 5px 0;
    gap: 16px;
  }

  .row + .row {
    border-top: 1px solid var(--stroke-0);
  }

  .desc {
    font-size: 12.5px;
    color: var(--fg-1);
    flex: 1;
    min-width: 0;
  }

  .keys {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  .plus {
    font-size: 10px;
    color: var(--fg-4);
    margin: 0 1px;
  }

  kbd {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 22px;
    height: 20px;
    padding: 0 5px;
    background: var(--bg-0);
    border: 1px solid var(--stroke-1);
    border-bottom-width: 2px;
    border-radius: var(--r-xs);
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--fg-1);
    line-height: 1;
  }
</style>
