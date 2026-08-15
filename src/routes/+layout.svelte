<script lang="ts">
  /**
   * Root layout: mirrors the appearance settings onto the document, and applies the window
   * zoom and vibrancy that only the Tauri webview can set.
   */
  import '../app.css';
  import { settings } from '$lib/stores/settings';
  import { foregroundOn } from '$lib/utils/home/contrast';
  import { setWindowVibrancy } from '$lib/services/settings-service';

  let vibrancyApplied: boolean | null = null;

  /** Only calls into the window when the value actually changed - the native call is not free. */
  async function applyVibrancy(enabled: boolean) {
    if (vibrancyApplied === enabled) return;
    vibrancyApplied = enabled;
    try {
      await setWindowVibrancy(enabled);
    } catch {}
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
    document.documentElement.style.setProperty('--accent', $settings.accentColor);
    document.documentElement.style.setProperty('--accent-fg', foregroundOn($settings.accentColor));
    document.documentElement.style.setProperty('--font-mono', $settings.fontFamily);
    document.documentElement.style.setProperty('--font-ui', $settings.fontFamily);
    void applyZoom($settings.uiScale);
    void applyVibrancy($settings.theme === 'glass');
  }
</script>

<slot />
