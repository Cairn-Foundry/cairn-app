<script lang="ts">
  /**
   * Inline pending indicator, the only way this app shows an action in flight.
   * Size it to the surrounding text (size 10 to 13); when it replaces a label,
   * put the meaning back with title / aria-label.
   */
  export let size: number = 13;
  export let stroke: number = 2;
  export let trackColor: string = 'oklch(1 0 0 / 0.3)';
  export let color: string = 'currentColor';

  // Drawn as a circle rather than a rotating border box: a bordered element of
  // an odd pixel size has its centre on a half pixel, and the rounding makes
  // the arc wobble instead of turning cleanly. An SVG rotates about its own
  // viewBox, whatever the rendered size.
  const VIEW = 24;
  $: radius = (VIEW - stroke * (VIEW / size)) / 2;
  $: width = stroke * (VIEW / size);
  $: circumference = 2 * Math.PI * radius;
</script>

<svg
  class="spinner"
  width={size}
  height={size}
  viewBox="0 0 {VIEW} {VIEW}"
  fill="none"
  aria-hidden="true"
>
  <circle
    cx={VIEW / 2}
    cy={VIEW / 2}
    r={radius}
    stroke={trackColor}
    stroke-width={width}
  />
  <circle
    cx={VIEW / 2}
    cy={VIEW / 2}
    r={radius}
    stroke={color}
    stroke-width={width}
    stroke-linecap="round"
    stroke-dasharray="{circumference * 0.25} {circumference}"
  />
</svg>

<style>
  .spinner {
    animation: spinner-rotate 0.6s linear infinite;
    display: inline-block;
    flex-shrink: 0;
    transform-origin: 50% 50%;
    vertical-align: middle;
  }

  @keyframes spinner-rotate {
    to { transform: rotate(360deg); }
  }
</style>
