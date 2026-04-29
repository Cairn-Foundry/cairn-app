<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import type { Project } from '$lib/types/project';

  export let project: Project;

  const dispatch = createEventDispatcher<{ close: void; confirm: void }>();
</script>

<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<div
  class="modal-backdrop"
  role="dialog"
  aria-modal="true"
  tabindex="-1"
  on:click={() => dispatch('close')}
  on:keydown={(e) => e.key === 'Escape' && dispatch('close')}
>
  <div class="modal del-modal" on:click|stopPropagation role="presentation">
    <div class="modal-head">
      <div>
        <div class="step-count">Confirm deletion</div>
        <h3>Remove "{project.name}"?</h3>
      </div>
      <button class="icon-btn close" on:click={() => dispatch('close')} aria-label="Close">
        <Icon name="x" size={16}/>
      </button>
    </div>
    <div class="modal-body">
      <p class="del-desc">
        This removes the project from Cairn and deletes all its instances and worktrees.
        <strong>Your files at <code>{project.path}</code> will not be touched.</strong>
      </p>
    </div>
    <div class="modal-foot">
      <div class="spacer"></div>
      <button class="btn ghost" on:click={() => dispatch('close')}>Cancel</button>
      <button class="btn danger" on:click={() => dispatch('confirm')}>
        <Icon name="trash" size={14}/> Delete project
      </button>
    </div>
  </div>
</div>

<style>
  .del-modal { width: min(460px, 92vw); }
  .del-desc {
    font-size: 13px;
    color: var(--fg-2);
    line-height: 1.6;
    margin: 0;
  }
  .del-desc code {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-1);
    background: var(--bg-0);
    padding: 1px 5px;
    border-radius: 3px;
    word-break: break-all;
  }
</style>
