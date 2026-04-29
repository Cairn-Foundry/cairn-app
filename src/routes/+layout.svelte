<script lang="ts">
  import '../app.css';
  import { settings } from '$lib/stores/settings';

  $: if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', $settings.theme);
    document.documentElement.style.setProperty('--accent', $settings.accentColor);
    const font = $settings.fontFamily;
    document.documentElement.style.setProperty('--font-mono', font);
    document.documentElement.style.setProperty('--font-ui', font);
  }
</script>

<slot />
