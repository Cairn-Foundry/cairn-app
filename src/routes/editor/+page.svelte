<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * A detached editor window. It deliberately runs none of what the main page
   * starts on mount: no terminals (initialising them kills every PTY of the
   * app), no UI state written back, no integrations watch. It loads what an
   * editor needs and follows the settings the main window saves.
   *
   * Detached windows are a comfort, not a view to restore: they are not
   * reopened on the next launch.
   */
  import { onDestroy, onMount } from 'svelte';
  import DetachedEditor from '#lib/components/detached/DetachedEditor.svelte';
  import { settings } from '#lib/stores/settings';
  import { loadProjects } from '#lib/stores/project';
  import { disposeLanguageServers, initLanguageServers } from '#lib/stores/language-server';
  import { onSettingsChangedElsewhere } from '#lib/services/settings-service';
  import { installCopySelectionHandler } from '#lib/utils/clipboard/copy-selection';
  import { installFieldUndoHandler } from '#lib/utils/clipboard/field-undo';

  let isReady = false;
  const cleanups: Array<() => void> = [];
  let isDisposed = false;

  onMount(async () => {
    // The boot splash of app.html is only taken down by the main page's loading screen.
    document.getElementById('boot-splash')?.remove();
    cleanups.push(installCopySelectionHandler(), installFieldUndoHandler());
    initLanguageServers();
    await Promise.all([settings.load(), loadProjects().catch(() => {})]);
    isReady = true;
    const unlisten = await onSettingsChangedElsewhere(() => { void settings.load(); }).catch(() => null);
    if (unlisten) {
      if (isDisposed) unlisten();
      else cleanups.push(unlisten);
    }
  });

  onDestroy(() => {
    isDisposed = true;
    for (const cleanup of cleanups) cleanup();
    disposeLanguageServers();
  });
</script>

{#if isReady}
  <DetachedEditor/>
{/if}
