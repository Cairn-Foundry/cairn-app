<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { editProject } from '$lib/stores/project';
  import type { Project } from '$lib/types/project';

  export let project: Project;

  const dispatch = createEventDispatcher<{ close: void }>();

  let name = project.name;
  let color = project.color;
  let loading = false;
  let error = '';

  const presetColors = [
    '#6366f1', '#8b5cf6', '#ec4899', '#ef4444',
    '#f97316', '#eab308', '#22c55e', '#06b6d4',
  ];

  $: canSave = name.trim().length > 0 && (name.trim() !== project.name || color !== project.color);

  async function save() {
    if (!canSave || loading) return;
    loading = true;
    error = '';
    try {
      await editProject(project.id, name.trim(), color);
      dispatch('close');
    } catch (err) {
      error = String(err);
    } finally {
      loading = false;
    }
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && !loading) dispatch('close');
    if (e.key === 'Enter' && canSave && !loading) save();
  }
</script>

<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<div
  class="modal-backdrop"
  role="dialog"
  aria-modal="true"
  tabindex="-1"
  on:click={() => { if (!loading) dispatch('close'); }}
  on:keydown={handleKey}
>
  <div class="modal ep-modal" on:click|stopPropagation role="presentation">

    <div class="modal-head">
      <div>
        <div class="step-count">Edit project</div>
        <h3>Rename &amp; recolor</h3>
      </div>
      <button class="icon-btn close" on:click={() => dispatch('close')} disabled={loading} aria-label="Close">
        <Icon name="x" size={16}/>
      </button>
    </div>

    <div class="modal-body">
      <div class="form-section">
        <label class="ep-label" for="edit-name">
          Project name <span class="req">*</span>
        </label>
        <input
          id="edit-name"
          class="ep-input"
          bind:value={name}
          placeholder={project.name}
          autocomplete="off"
        />
      </div>

      <div class="form-section">
        <div class="ep-label">Color</div>
        <div class="color-row">
          {#each presetColors as c}
            <button
              class="color-swatch {color === c ? 'selected' : ''}"
              style="background:{c}"
              on:click={() => color = c}
              aria-label="Color {c}"
            ></button>
          {/each}
          <label for="color-edit" class="color-custom-wrap" title="Custom color">
            <input id="color-edit" type="color" bind:value={color} class="color-custom-input"/>
            <span class="color-custom-preview" style="background:{color}"></span>
          </label>
        </div>
      </div>

      <div class="preview-pill" style="border-color:{color}33;background:{color}14;">
        <span class="preview-dot" style="background:{color}"></span>
        <span class="preview-label" style="color:{color}">{name || project.name}</span>
      </div>

      {#if error}
        <div class="ep-error" role="alert">
          <Icon name="info" size={14}/> {error}
        </div>
      {/if}
    </div>

    <div class="modal-foot">
      <div class="spacer"></div>
      <button class="btn ghost" on:click={() => dispatch('close')} disabled={loading}>Cancel</button>
      <button class="btn primary" disabled={!canSave || loading} on:click={save}>
        {#if loading}
          <span class="ep-spinner"></span> Saving…
        {:else}
          <Icon name="check" size={14}/> Save changes
        {/if}
      </button>
    </div>

  </div>
</div>

<style>
  .ep-modal { width: min(440px, 92vw); }

  .form-section { margin-bottom: 20px; }
  .ep-label {
    display: block;
    font-size: 11px;
    font-weight: 700;
    color: var(--fg-3);
    letter-spacing: 0.07em;
    text-transform: uppercase;
    margin-bottom: 8px;
  }
  .req { color: var(--accent); }

  .ep-input {
    width: 100%;
    box-sizing: border-box;
    background: var(--bg-0);
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-sm);
    padding: 10px 12px;
    font-size: 14px;
    color: var(--fg-0);
    font-family: var(--font-ui);
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .ep-input:focus {
    border-color: var(--accent-line);
    box-shadow: 0 0 0 3px var(--accent-weak);
  }
  .ep-input::placeholder { color: var(--fg-4); opacity: 1; }

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
  .color-swatch.selected { border-color: var(--fg-0); box-shadow: 0 0 0 2px var(--bg-1); }

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
  .color-custom-preview { display: block; width: 100%; height: 100%; border-radius: 50%; }

  .preview-pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 14px 6px 8px;
    border-radius: 999px;
    border: 1px solid;
    margin-top: 4px;
    transition: background 0.2s, border-color 0.2s;
  }
  .preview-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
  .preview-label { font-size: 13px; font-weight: 500; }

  .ep-error {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin-top: 16px;
    padding: 10px 14px;
    background: var(--danger-weak, oklch(0.28 0.06 15));
    border: 1px solid var(--danger, oklch(0.62 0.18 15));
    border-radius: var(--r-md);
    font-size: 12px;
    color: var(--danger, oklch(0.75 0.18 15));
    line-height: 1.5;
  }

  .ep-spinner {
    display: inline-block;
    width: 13px; height: 13px;
    border: 2px solid oklch(1 0 0 / 0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: ep-spin 0.6s linear infinite;
    flex-shrink: 0;
  }
  @keyframes ep-spin { to { transform: rotate(360deg); } }
</style>
