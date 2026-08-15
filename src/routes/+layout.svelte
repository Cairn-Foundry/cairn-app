<script lang="ts">
  import '../app.css';
  import { settings } from '$lib/stores/settings';
  import { foregroundOn } from '$lib/utils/home/contrast';

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
    const font = $settings.fontFamily;
    document.documentElement.style.setProperty('--font-mono', font);
    document.documentElement.style.setProperty('--font-ui', font);
    void applyZoom($settings.uiScale);
  }
</script>

<slot />
