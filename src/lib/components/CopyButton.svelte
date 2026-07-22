<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n';
  import { CLIPBOARD_CLEAR_DELAY } from '$lib/utils/timing';

  export let value: string;
  export let size: number = 11;

  let copied = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function copy(e: MouseEvent) {
    e.stopPropagation();
    await navigator.clipboard.writeText(value);
    copied = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { copied = false; }, CLIPBOARD_CLEAR_DELAY);
  }
</script>

<button
  type="button"
  class="copy-btn"
  class:copied
  on:click={copy}
  title={(copied ? t('common.copied') : t('common.copy')) as string}
  aria-label={(copied ? t('common.copied') : t('common.copy')) as string}
>
  <Icon name={copied ? 'check' : 'copy'} {size}/>
</button>

<style>
  .copy-btn {
    display: grid;
    place-items: center;
    width: 18px; height: 18px;
    padding: 0;
    border-radius: var(--r-sm);
    color: var(--fg-3);
    flex-shrink: 0;
    transition: color .12s, background .12s;
  }
  .copy-btn:hover { background: var(--bg-3); color: var(--fg-0); }
  .copy-btn.copied { color: var(--success); }
</style>
