<script lang="ts">
  /** Stands in for the workspace: records the CLI paths it was handed. */
  export let activeProjectId = '';

  export const openedPaths: string[][] = [];
  export async function openPathsFromCli(paths: string[]) {
    openedPaths.push(paths);
  }
</script>

<div data-workspace data-active-project={activeProjectId}></div>
