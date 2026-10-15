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
  import { settings, settingsLoaded } from '$lib/stores/settings';
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
   * Compared with the window itself, which Rust already built with the saved
   * setting: switching it again would hide and show it for nothing. Mutter only
   * reads decorations when a window is mapped, hence the hide and show.
   */
  async function applyDecorations(native: boolean) {
    if (IS_MAC || nativeDecorations === native) return;
    nativeDecorations = native;
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      if ((await win.isDecorated()) === native) return;
      const maximized = await win.isMaximized();
      await win.hide();
      await win.setDecorations(native);
      await win.show();
      if (maximized) await win.maximize();
    } catch {}
  }

  let fullscreen = false;

  // Tauri has no fullscreen event: entering or leaving it arrives as a resize.
  onMount(() => {
    if (IS_MAC) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const win = getCurrentWindow();
        const check = async () => { fullscreen = await win.isFullscreen(); };
        await check();
        const off = await win.onResized(() => void check());
        if (disposed) off();
        else unlisten = off;
      } catch {}
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  });

  $: customTitleBar = !IS_MAC && $settings.titleBar === 'custom';
  $: showTitleBar = customTitleBar && !fullscreen;
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
    if ($settingsLoaded) void applyDecorations(!customTitleBar);
    if (showTitleBar) document.documentElement.style.setProperty('--titlebar-h', '34px');
    else document.documentElement.style.removeProperty('--titlebar-h');
  }
</script>

{#if showTitleBar}
  <WindowTitleBar fill={titleBarFill}/>
{/if}
<slot />
