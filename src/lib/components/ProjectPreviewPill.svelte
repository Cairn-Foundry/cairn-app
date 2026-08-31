<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * Read-only preview of how a project reads in a list: its accent colour and
   * name. Used by the project forms to show the result live.
   */
  export let name: string;
  export let color: string;
</script>

<div class="preview-pill" style="border-color:{color}33;background:{color}14;">
  <span class="preview-dot" style="background:{color}"></span>
  <span class="preview-label" style="color:{color}">{name}</span>
</div>

<style>
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
</style>
