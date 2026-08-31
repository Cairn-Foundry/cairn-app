<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * Holds the two-way `bindings` the form writes back, the way EditProject
   * does, and exposes the latest value for a test to read.
   */
  import ProjectIntegrationsForm from '$lib/components/ProjectIntegrationsForm.svelte';
  import type { ProjectIntegrations } from '$lib/types/integrations';

  export let projectId = 'p1';
  export let remoteUrl = '';
  export let bindings: ProjectIntegrations;
  /** Called with every value the form writes back. */
  export let onBindings: (value: ProjectIntegrations) => void = () => {};

  $: onBindings(bindings);
</script>

<ProjectIntegrationsForm {projectId} {remoteUrl} bind:bindings/>
