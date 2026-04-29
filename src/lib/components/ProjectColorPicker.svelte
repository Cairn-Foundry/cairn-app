<script lang="ts">
  import { t } from '$lib/i18n';
  import { PROJECT_COLORS } from '$lib/utils/home/appearance';

  export let color: string;
  export let idSuffix: string = 'default';

  const presetColors = PROJECT_COLORS;
</script>

<div class="color-row">
  {#each presetColors as c}
    <button
      type="button"
      class="color-swatch {color === c ? 'selected' : ''}"
      style="background:{c}"
      on:click={() => color = c}
      aria-label="Color {c}"
    ></button>
  {/each}
  <label for="color-{idSuffix}" class="color-custom-wrap" title={t('settings.appearance.customColor') as string}>
    <input id="color-{idSuffix}" type="color" bind:value={color} class="color-custom-input"/>
    <span class="color-custom-preview" style="background:{color}"></span>
  </label>
</div>

<style>
  .color-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

  .color-swatch {
    width: 28px; height: 28px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    transition: transform 0.1s, border-color 0.1s;
    flex-shrink: 0;
  }
  .color-swatch:hover { transform: scale(1.18); }
  .color-swatch.selected {
    border-color: var(--fg-0);
    box-shadow: 0 0 0 2px var(--bg-1);
  }

  .color-custom-wrap {
    position: relative;
    width: 28px; height: 28px;
    border-radius: 50%;
    overflow: hidden;
    cursor: pointer;
    flex-shrink: 0;
    border: 2px dashed var(--stroke-1);
  }
  .color-custom-input {
    position: absolute;
    inset: -4px;
    width: calc(100% + 8px);
    height: calc(100% + 8px);
    opacity: 0;
    cursor: pointer;
  }
  .color-custom-preview {
    display: block;
    width: 100%; height: 100%;
    border-radius: 50%;
  }
</style>
