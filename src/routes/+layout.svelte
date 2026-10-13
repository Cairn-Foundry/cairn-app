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
  import { page } from '$app/stores';
  import WindowTitleBar from '$lib/components/layout/WindowTitleBar.svelte';
  import { settings } from '$lib/stores/settings';
  import { IS_MAC } from '$lib/utils/platform';
  import { foregroundOn } from '$lib/utils/home/contrast';
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
   * The window is built with the decorations its setting asks for, so the first
   * value seen here is only recorded: the store still holds its defaults at that
   * point, and applying them would flash the system title bar on and off.
   */
  async function applyDecorations(native: boolean) {
    const previous = nativeDecorations;
    nativeDecorations = native;
    if (IS_MAC || previous === null || previous === native) return;
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().setDecorations(native);
    } catch {}
  }

  // A detached editor has no chrome of its own for the buttons to sit on, so
  // "hidden" draws the bar there all the same.
  $: titleBar = IS_MAC
    ? 'native'
    : $settings.titleBar === 'hidden' && $page.route.id === '/editor'
      ? 'custom'
      : $settings.titleBar;

  function setRootVar(name: string, value: string | null) {
    if (value === null) document.documentElement.style.removeProperty(name);
    else document.documentElement.style.setProperty(name, value);
  }

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
    void applyDecorations(IS_MAC || $settings.titleBar === 'native');
    setRootVar('--titlebar-h', titleBar === 'custom' ? '34px' : null);
    setRootVar('--window-controls-w', titleBar === 'hidden' ? '96px' : null);
    setRootVar('--titlebar-bg', $settings.titleBarColor || null);
    setRootVar('--titlebar-fg', $settings.titleBarColor ? foregroundOn($settings.titleBarColor) : null);
  }
</script>

{#if titleBar !== 'native'}
  <WindowTitleBar floating={titleBar === 'hidden'}/>
{/if}
<slot />
