<script lang="ts">
  /**
   * Mounts a workflow view the first time it is opened, and keeps it mounted
   * after that so its state survives a tab switch. Every view being imported
   * statically put xterm, the git panels and the terminal in the first chunk,
   * which the user pays for at startup even when they only open Files.
   */
  import type { Component } from 'svelte';
  import Spinner from '$lib/components/Spinner.svelte';

  /**
   * A view compiles to a class, or to a function under runes, and the two type
   * as mutually unassignable. The constructor is only ever handed straight to
   * `svelte:component`, so it stays opaque here.
   */
  type AnyComponent = ConstructorOfATypedSvelteComponent | Component<any, any, any>;

  export let load: () => Promise<{ default: AnyComponent }>;
  /** Whether the view is the one on screen right now. */
  export let active: boolean = false;

  let Comp: AnyComponent | null = null;
  let pending = false;

  $: if (active && !Comp && !pending) {
    pending = true;
    load().then((m) => {
      Comp = m.default;
      pending = false;
    });
  }
</script>

{#if Comp}
  <svelte:component this={Comp} {...$$restProps} on:openFile on:fileDiscarded on:filesChanged on:goGitSettings on:createInstanceFromRef/>
{:else if active}
  <div class="lazy-pending"><Spinner size={16}/></div>
{/if}

<style>
  .lazy-pending {
    align-items: center;
    display: flex;
    height: 100%;
    justify-content: center;
    width: 100%;
  }
</style>
