<script lang="ts">
  /** Stands in for the CodeMirror diff in tests: records what it was given. */
  import { createEventDispatcher } from 'svelte';

  export let oldContent = '';
  export let newContent = '';
  export let language: unknown = null;
  export let markers: { line: number; side: 'old' | 'new' }[] = [];

  const dispatch = createEventDispatcher<{ markerClick: { line: number; side: 'old' | 'new' } }>();

  /** Records the jumps the view asked for, so a test can read them back. */
  export const scrolledTo: { line: number; side: 'old' | 'new' }[] = [];
  export function scrollToLine(line: number, side: 'old' | 'new') {
    scrolledTo.push({ line, side });
  }
</script>

<div data-diff data-old={oldContent} data-new={newContent} data-lang={language ?? ''}>
  {#each markers as marker}
    <button
      class="stub-marker"
      data-line={marker.line}
      data-side={marker.side}
      on:click={() => dispatch('markerClick', { line: marker.line, side: marker.side })}
    ></button>
  {/each}
</div>
