<script lang="ts">
  /**
   * Content placeholder shown while a block of content loads, in place of any
   * textual loading message. Wrap it in a container that supplies the padding.
   */
  export let lines: number = 1;
  export let height: number = 12;
  export let gap: number = 8;
  export let radius: string = 'var(--r-sm)';
</script>

<div class="skeleton" style="gap: {gap}px" aria-hidden="true">
  {#each Array(lines) as _, i (i)}
    <span
      class="skeleton-line"
      style="height: {height}px; border-radius: {radius}; width: {i === lines - 1 && lines > 1 ? '62%' : '100%'};"
    ></span>
  {/each}
</div>

<style>
  .skeleton {
    display: flex;
    flex-direction: column;
    width: 100%;
  }
  .skeleton-line {
    display: block;
    background: linear-gradient(90deg, var(--bg-3) 25%, var(--bg-4) 37%, var(--bg-3) 63%);
    background-size: 400% 100%;
    animation: skeleton-shimmer 1.4s ease-in-out infinite;
  }
  @keyframes skeleton-shimmer {
    from { background-position: 100% 50%; }
    to { background-position: 0 50%; }
  }
  @media (prefers-reduced-motion: reduce) {
    .skeleton-line { animation: none; }
  }
</style>
