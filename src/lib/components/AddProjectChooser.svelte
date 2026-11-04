<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import Icon from '#lib/components/Icon.svelte';
  import { t } from '#lib/i18n';

  const dispatch = createEventDispatcher<{
    close: void;
    choose: 'new' | 'open' | 'clone';
    existing: void;
  }>();
</script>

<svelte:window on:keydown={(e) => e.key === 'Escape' && dispatch('close')} />

<div class="modal-backdrop" on:click={() => dispatch('close')} role="button" tabindex="-1" on:keydown={() => {}}>
  <div class="modal" on:click|stopPropagation role="presentation">
    <div class="modal-head">
      <h3 style="margin: 0">{t('addProject.chooserTitle')}</h3>
      <button class="icon-btn close" aria-label={t('common.close') as string} on:click={() => dispatch('close')}><Icon name="x" size={16}/></button>
    </div>
    <div class="modal-body">
      <div class="home-actions" style="margin-bottom: 0; grid-template-columns: repeat(2, 1fr)">
        <div class="home-action primary" role="button" tabindex="0"
             on:click={() => dispatch('choose', 'new')}
             on:keydown={(e) => e.key === 'Enter' && dispatch('choose', 'new')}>
          <div class="aci"><Icon name="plus" size={22}/></div>
          <div class="at">{t('home.projects.newProject')}</div>
          <div class="ad">{t('home.projects.newProjectDesc')}</div>
        </div>
        <div class="home-action" role="button" tabindex="0"
             on:click={() => dispatch('choose', 'open')}
             on:keydown={(e) => e.key === 'Enter' && dispatch('choose', 'open')}>
          <div class="aci"><Icon name="folder" size={22}/></div>
          <div class="at">{t('home.projects.openProject')}</div>
          <div class="ad">{t('home.projects.openProjectDesc')}</div>
        </div>
        <div class="home-action" role="button" tabindex="0"
             on:click={() => dispatch('choose', 'clone')}
             on:keydown={(e) => e.key === 'Enter' && dispatch('choose', 'clone')}>
          <div class="aci"><Icon name="download" size={22}/></div>
          <div class="at">{t('home.projects.cloneFromRemote')}</div>
          <div class="ad">{t('home.projects.cloneFromRemoteDesc')}</div>
        </div>
        <div class="home-action" role="button" tabindex="0"
             on:click={() => dispatch('existing')}
             on:keydown={(e) => e.key === 'Enter' && dispatch('existing')}>
          <div class="aci"><Icon name="search" size={22}/></div>
          <div class="at">{t('addProject.existingTitle')}</div>
          <div class="ad">{t('addProject.existingDesc')}</div>
        </div>
      </div>
    </div>
  </div>
</div>
