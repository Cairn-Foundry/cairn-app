<script lang="ts">
  /** Stands in for the home screen: records the props it was opened with. */
  import { createEventDispatcher } from 'svelte';

  export let openSection: string | null = null;
  export let openSettingsTab: string | null = null;
  export let openAddProjectMode: string | null = null;
  export let openAddProjectPath = '';
  export let openAddProjectCloneUrl = '';

  const dispatch = createEventDispatcher();
</script>

<div
  data-home
  data-open-section={openSection ?? ''}
  data-open-settings-tab={openSettingsTab ?? ''}
  data-add-mode={openAddProjectMode ?? ''}
  data-add-path={openAddProjectPath}
  data-add-clone-url={openAddProjectCloneUrl}
>
  <button class="stub-open-project" on:click={() => dispatch('openProject', 'p1')}></button>
  <button class="stub-close-project" on:click={() => dispatch('closeProject', 'p1')}></button>
  <button
    class="stub-section-change"
    on:click={() => dispatch('sectionChange', { section: 'settings', settingsTab: 'git' })}
  ></button>
</div>
