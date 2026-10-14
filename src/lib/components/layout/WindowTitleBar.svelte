<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * The title bar the app draws in place of the system's: the window is moved
   * by it, and its fill is the user's to choose.
   */
  import WindowControls from '$lib/components/layout/WindowControls.svelte';
  import { channel } from '$lib/stores/channel';
  import { draggableRegion } from '$lib/utils/window-drag';
</script>

<div class="title-bar app-title-bar" data-tauri-drag-region use:draggableRegion>
  <span class="side"></span>
  <span class="title-center">Cairn Foundry{$channel.label ? ` (${$channel.label})` : ''}</span>
  <span class="side"><WindowControls/></span>
</div>

<style>
  .app-title-bar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: var(--titlebar-h);
    padding: 0 6px;
    background: var(--titlebar-bg, var(--bg-1));
    color: var(--titlebar-fg, var(--fg-1));
  }
  .app-title-bar .title-center {
    color: inherit;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    pointer-events: none;
  }
  .side {
    display: flex;
    justify-content: flex-end;
    width: 90px;
    flex-shrink: 0;
  }
</style>
