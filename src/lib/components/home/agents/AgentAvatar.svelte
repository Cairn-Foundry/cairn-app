<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /** An agent's initials on its own colour, toned down so they stay readable in both themes. */
  import { agentInitials } from '#lib/utils/home/native-agents';

  export let name: string;
  export let color = '';
  export let isLarge = false;
</script>

<span class="avatar" class:is-large={isLarge} style={color ? `--agent: ${color}` : ''}>{agentInitials(name)}</span>

<style>
  .avatar {
    --agent: var(--fg-3);
    display: grid;
    flex: none;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: var(--r-sm);
    /* srgb, not oklch: mixing two hues in oklch walks the hue wheel between
       them, and a purple on the warm background came out red. */
    background: color-mix(in srgb, var(--agent) 22%, var(--bg-1));
    border: 1px solid color-mix(in srgb, var(--agent) 45%, var(--bg-1));
    font-size: 10.5px;
    font-weight: 600;
    color: var(--fg-0);
  }
  .avatar.is-large { width: 40px; height: 40px; border-radius: var(--r-md); font-size: 13px; }
</style>
