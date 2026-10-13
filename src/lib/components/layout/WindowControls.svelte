<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * Minimize, maximize and close, for a window whose system title bar is off.
   * Closing goes through the window's own close request, so the unsaved-files
   * prompt and the state flush run exactly as they do from the system button.
   */
  import { t } from '$lib/i18n';

  type WindowAction = 'minimize' | 'toggleMaximize' | 'close';

  async function run(action: WindowAction) {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow()[action]();
    } catch {}
  }
</script>

<div class="window-controls" data-no-drag>
  <button type="button" aria-label={t('windowControls.minimize') as string} title={t('windowControls.minimize') as string} on:click={() => run('minimize')}>
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2.5 6h7"/></svg>
  </button>
  <button type="button" aria-label={t('windowControls.maximize') as string} title={t('windowControls.maximize') as string} on:click={() => run('toggleMaximize')}>
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><rect x="2.5" y="2.5" width="7" height="7" rx="1"/></svg>
  </button>
  <button type="button" class="close" aria-label={t('common.close') as string} title={t('common.close') as string} on:click={() => run('close')}>
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6"/></svg>
  </button>
</div>

<style>
  .window-controls {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }
  button {
    display: grid;
    place-items: center;
    width: 28px;
    height: 24px;
    border-radius: var(--r-sm);
    color: inherit;
    opacity: 0.75;
  }
  button:hover {
    opacity: 1;
    background: color-mix(in oklch, currentColor 14%, transparent);
  }
  button.close:hover {
    background: var(--danger);
    color: oklch(0.98 0 0);
  }
  svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.2;
    stroke-linecap: round;
  }
</style>
