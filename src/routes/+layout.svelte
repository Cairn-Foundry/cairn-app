<script lang="ts">
  import '../app.css';
  import { settings } from '$lib/stores/settings';

  $: if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', $settings.theme ?? 'dark');
    document.documentElement.style.setProperty('--accent-hue', String($settings.accentHue ?? 250));
  }
</script>

<slot />
