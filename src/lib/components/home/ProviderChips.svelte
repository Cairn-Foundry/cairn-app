<script lang="ts">
  import ProviderLogo from '$lib/components/home/agents/ProviderLogo.svelte';
  import { cliProviders, cliProviderLabel } from '$lib/stores/cli-providers';
  import { catalogueIdOf, sortProviders } from '$lib/utils/home/cli-providers';
  import type { CliProviderId } from '$lib/services/cli-provider-service';

  export let providers: CliProviderId[] = [];
  export let size = 12;

  /* sortProviders also collapses duplicates: the same agent can be reached
     through two paths, and a repeated key breaks a keyed list. */
  $: ordered = sortProviders(providers);
</script>

<span class="chips">
  {#each ordered as provider (provider)}
    <span class="chip" title={cliProviderLabel(provider, $cliProviders)}>
      <ProviderLogo id={catalogueIdOf(provider)} {size} fallback={provider.slice(0, 1).toUpperCase()}/>
    </span>
  {/each}
</span>

<style>
  .chips {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    flex-shrink: 0;
  }
  .chip {
    display: grid;
    place-items: center;
    color: var(--fg-3);
  }
</style>
