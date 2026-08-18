<script lang="ts">
  /**
   * Content placeholder shown while a block of content loads, in place of any
   * textual loading message. Wrap it in a container that supplies the padding.
   */
  export let lines: number = 1;
  export let height: number = 12;
  export let gap: number = 8;
  export let radius: string = 'var(--r-sm)';
  /**
   * Width of the block. Left unset, a multi-line skeleton keeps its ragged last
   * line; a placeholder standing in for one precise element (a chip, a pill, a
   * dot) passes the width it must occupy instead.
   */
  export let width: string | null = null;

  /** Shifts each line's shimmer so a column of them does not pulse in lockstep. */
  const STAGGER_MS = 120;
</script>

<div class="skeleton" style="gap: {gap}px; {width ? `width: ${width}; flex: 0 0 ${width};` : ''}" aria-hidden="true">
  {#each Array(lines) as _, i (i)}
    <span
      class="skeleton-line"
      style="height: {height}px; border-radius: {radius}; animation-delay: {i * STAGGER_MS}ms; width: {width
        ? '100%'
        : i === lines - 1 && lines > 1
          ? '62%'
          : '100%'};"
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
    min-width: 8px;
    background: linear-gradient(
      90deg,
      var(--bg-3) 0%,
      var(--bg-3) 40%,
      var(--bg-4) 50%,
      var(--bg-3) 60%,
      var(--bg-3) 100%
    );
    background-size: 200% 100%;
    animation: skeleton-shimmer 1.6s ease-in-out infinite;
  }
  @keyframes skeleton-shimmer {
    from { background-position: 150% 50%; }
    to { background-position: -50% 50%; }
  }
  @media (prefers-reduced-motion: reduce) {
    .skeleton-line { animation: none; }
  }
</style>
