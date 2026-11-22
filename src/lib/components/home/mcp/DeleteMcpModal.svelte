<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * Confirmation before removing an MCP server: the server, every config file
   * its declaration is removed from with the CLIs that read it, and the tools
   * those CLIs lose. Forwards `confirm` and `close`.
   */
  import { t } from '#lib/i18n';
  import Icon from '#lib/components/Icon.svelte';
  import ConfirmModal from '#lib/components/ConfirmModal.svelte';
  import ProviderChips from '#lib/components/home/ProviderChips.svelte';
  import { transportIcon } from '#lib/utils/home/mcp';
  import type { McpServer } from '#lib/services/mcp-service';

  export let server: McpServer;

  $: files = server.locations.length > 0
    ? server.locations
    : [{ path: server.sourcePath, providers: server.providers }];
</script>

<ConfirmModal
  title={(t('mcp.delete.title') as (name: string) => string)(server.name)}
  confirmLabel={t('mcp.delete.confirm') as string}
  on:close
  on:confirm
>
  <svelte:fragment slot="subject">
    <span class="dm-tile"><Icon name={transportIcon(server.transport)} size={14}/></span>
    <span class="cm-text">
      <span class="cm-name">{server.name}</span>
      <span class="cm-sub">{server.scope === 'user' ? t('mcp.scope.user') : server.projectName}</span>
    </span>
  </svelte:fragment>

  <section class="cm-section">
    <h3>{t('mcp.delete.filesTitle')}</h3>
    <ul class="cm-list">
      {#each files as file (file.path)}
        <li>
          <ProviderChips providers={file.providers} size={12}/>
          <code class="dm-path selectable" title={file.path}>{file.path}</code>
        </li>
      {/each}
    </ul>
  </section>

  <p class="cm-note">
    <Icon name="info" size={13}/>
    {(t('mcp.delete.effect') as (prefix: string) => string)(`mcp__${server.name}__`)}
  </p>
</ConfirmModal>

<style>
  .dm-tile {
    display: grid;
    flex: none;
    place-items: center;
    width: 28px;
    height: 28px;
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-sm);
    background: var(--bg-2);
    color: var(--fg-2);
  }
  .dm-path {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--fg-2);
  }
</style>
