<script lang="ts">
  import { PROVIDER_MARKS } from './provider-marks';

  export let id: string;
  export let size = 16;
  /** Initials, drawn when the provider has no brand mark of its own. */
  export let fallback = '';

  $: mark = PROVIDER_MARKS[id] ?? null;
</script>

{#if mark}
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="currentColor"
    aria-hidden="true"
    focusable="false"
  >
    <path d={mark}/>
  </svg>
{:else}
  {fallback}
{/if}
