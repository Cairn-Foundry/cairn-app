<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * Root layout: mirrors the appearance settings onto the document, applies the window
   * zoom, vibrancy and decorations that only the Tauri webview can set, draws the title
   * bar that stands in for the system's, and sends external links to the system browser.
   */
  import '../app.css';
  import { onMount } from 'svelte';
  import WindowTitleBar from '$lib/components/layout/WindowTitleBar.svelte';
  import { settings } from '$lib/stores/settings';
  import { activeProject } from '$lib/stores/project';
  import { activeScreen } from '$lib/stores/ui';
  import { IS_MAC } from '$lib/utils/platform';
  import { foregroundOn } from '$lib/utils/home/contrast';
  import { titleBarFillColor } from '$lib/utils/home/title-bar';
  import { setWindowVibrancy } from '$lib/services/settings-service';
  import { interceptExternalLinks } from '$lib/utils/external-links';

  onMount(() => interceptExternalLinks());

  let vibrancyApplied: boolean | null = null;

  /** Only calls into the window when the value actually changed - the native call is not free. */
  async function applyVibrancy(enabled: boolean) {
    if (vibrancyApplied === enabled) return;
    vibrancyApplied = enabled;
    try {
      await setWindowVibrancy(enabled);
    } catch {}
  }

  let nativeDecorations: boolean | null = null;

  /**
   * The first value is only recorded: the window is built with its decorations and
   * the store still holds its defaults. Mutter only reads decorations when a window
   * is mapped, hence the hide and show around the switch.
   */
  async function applyDecorations(native: boolean) {
    const previous = nativeDecorations;
    nativeDecorations = native;
    if (IS_MAC || previous === null || previous === native) return;
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      const maximized = await win.isMaximized();
      await win.hide();
      await win.setDecorations(native);
      await win.show();
      if (maximized) await win.maximize();
    } catch {}
  }

  $: customTitleBar = !IS_MAC && $settings.titleBar === 'custom';
  $: titleBarFill = titleBarFillColor($settings, $activeScreen === 'workspace' ? ($activeProject?.color ?? null) : null);

  // The webview zoom scales the whole chrome, which a root font size cannot do
  // here: the interface is laid out in absolute pixels throughout.
  async function applyZoom(scale: number) {
    try {
      const { getCurrentWebview } = await import('@tauri-apps/api/webview');
      await getCurrentWebview().setZoom(scale);
    } catch {}
  }

  $: if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', $settings.theme);
    document.documentElement.setAttribute(
      'data-os',
      /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? 'macos' : 'other',
    );
    document.documentElement.style.setProperty('--accent', $settings.accentColor);
    document.documentElement.style.setProperty('--accent-fg', foregroundOn($settings.accentColor));
    document.documentElement.style.setProperty('--font-mono', $settings.fontFamily);
    document.documentElement.style.setProperty('--font-ui', $settings.fontFamily);
    document.documentElement.toggleAttribute('data-no-icon-animations', !$settings.iconAnimations);
    void applyZoom($settings.uiScale);
    void applyVibrancy($settings.theme === 'glass');
    void applyDecorations(!customTitleBar);
    if (customTitleBar) document.documentElement.style.setProperty('--titlebar-h', '34px');
    else document.documentElement.style.removeProperty('--titlebar-h');
  }
</script>

{#if customTitleBar}
  <WindowTitleBar fill={titleBarFill}/>
{/if}
<slot />
