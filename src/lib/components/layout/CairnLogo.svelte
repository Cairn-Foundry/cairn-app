<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * The Cairn mark, drawn as inline SVG so it inherits the current text color.
   */
  export let size: number = 20;
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
  <ellipse cx="12" cy="6.75" rx="2.77" ry="1.69" />
  <ellipse cx="12" cy="11.4" rx="4.27" ry="2.02" />
  <ellipse cx="12" cy="16.5" rx="6.09" ry="2.39" />
</svg>
