<script lang="ts">
  export let size: number = 13;
  export let stroke: number = 2;
  export let trackColor: string = 'oklch(1 0 0 / 0.3)';
  export let color: string = 'currentColor';
</script>

<span
  class="spinner"
  style="width: {size}px; height: {size}px; border-width: {stroke}px; border-color: {trackColor}; border-top-color: {color};"
  aria-hidden="true"
></span>

<style>
  .spinner {
    display: inline-block;
    border-style: solid;
    border-radius: 50%;
    animation: spinner-rotate 0.6s linear infinite;
    flex-shrink: 0;
    vertical-align: middle;
    box-sizing: border-box;
  }
  @keyframes spinner-rotate { to { transform: rotate(360deg); } }
</style>
