<script lang="ts">
  import '../app.css';
  import { settings } from '$lib/stores/settings';

  $: if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', $settings.theme ?? 'dark');
    document.documentElement.style.setProperty('--accent', $settings.accentColor ?? '#6c8eff');
    const font = $settings.fontFamily ?? "'JetBrains Mono', ui-monospace, monospace";
    document.documentElement.style.setProperty('--font-mono', font);
    document.documentElement.style.setProperty('--font-ui', font);
  }
</script>

<slot />
