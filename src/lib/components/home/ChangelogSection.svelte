<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * What's new: the releases in the list column of the shared split panel, the selected
   * one beside it. Reads CHANGELOG directly - entries carry their own { en, fr } text.
   */
  import Icon from '#lib/components/Icon.svelte';
  import SplitPanel from '#lib/components/SplitPanel.svelte';
  import { t } from '#lib/i18n';
  import { CHANGELOG, CHANGE_KINDS, localized, type ChangeKind } from '#lib/data/changelog';

  const KINDS: Record<ChangeKind, { icon: string; label: string }> = {
    added: { icon: 'plus', label: t('home.changelog.kinds.added') as string },
    changed: { icon: 'edit', label: t('home.changelog.kinds.changed') as string },
    fixed: { icon: 'check', label: t('home.changelog.kinds.fixed') as string },
    removed: { icon: 'trash', label: t('home.changelog.kinds.removed') as string },
  };

  const currentVersion = __APP_VERSION__ ?? '';

  const releases = CHANGELOG.map(release => ({
    ...release,
    sections: CHANGE_KINDS
      .map(kind => ({ kind, changes: release.changes.filter(c => c.kind === kind) }))
      .filter(s => s.changes.length > 0),
  }));

  let selectedVersion = releases[0]?.version ?? '';
  let detailBody: HTMLElement;

  $: selected = releases.find(r => r.version === selectedVersion) ?? null;

  function selectVersion(version: string) {
    selectedVersion = version;
    if (detailBody) detailBody.scrollTop = 0;
  }

  function onRowKeydown(e: KeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const index = releases.findIndex(r => r.version === selectedVersion);
    const next = releases[index + (e.key === 'ArrowDown' ? 1 : -1)];
    if (!next) return;
    selectVersion(next.version);
    const row = (e.currentTarget as HTMLElement).parentElement
      ?.querySelector<HTMLElement>(`[data-version="${next.version}"]`);
    row?.focus();
    row?.scrollIntoView({ block: 'nearest' });
  }

  /** An empty date means the version is still in development. */
  function formatDate(date: string): string {
    if (!date) return t('home.changelog.unreleased') as string;
    return new Date(date).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }
</script>

<SplitPanel title={t('home.changelog.title') as string} listWidth={240}>
  <nav
    slot="list"
    class="list-items versions"
    aria-label={t('home.changelog.timelineLabel') as string}
  >
    {#each releases as release (release.version)}
      <button
        class="ag-item version-row"
        class:is-active={release.version === selectedVersion}
        aria-current={release.version === selectedVersion}
        data-version={release.version}
        on:click={() => selectVersion(release.version)}
        on:keydown={onRowKeydown}
      >
        <span class="ag-item-text">
          <span class="ag-item-name version-name">{release.version}</span>
          <span class="ag-item-sub">{formatDate(release.date)}</span>
        </span>
        {#if release.version === currentVersion}
          <span class="installed" title={t('home.changelog.current') as string}>
            <Icon name="check" size={11}/>
          </span>
        {/if}
      </button>
    {/each}
  </nav>

  {#if selected}
    <header class="detail-head">
      <div class="detail-title">
        <div class="title-row">
          <h2 class="selectable">Cairn Foundry {selected.version}</h2>
          {#if selected.version === currentVersion}
            <span class="tag">{t('home.changelog.current')}</span>
          {/if}
        </div>
        <p>{formatDate(selected.date)}</p>
      </div>
    </header>

    <div class="detail-body" bind:this={detailBody}>
      <article class="release">
        <p class="summary selectable">{localized(selected.summary)}</p>

        {#each selected.sections as section (section.kind)}
          <section class="kind-section">
            <h3 class="kind-title {section.kind}">
              <Icon name={KINDS[section.kind].icon} size={12}/>
              {KINDS[section.kind].label}
              <span class="kind-count">{section.changes.length}</span>
            </h3>
            <ul class="changes">
              {#each section.changes as change}
                <li class="change selectable">{localized(change.text)}</li>
              {/each}
            </ul>
          </section>
        {/each}
      </article>
    </div>
  {/if}
</SplitPanel>

<style>
  .version-row { padding: 6px 10px; }
  .version-name { font-family: var(--font-mono); font-size: 12.5px; }

  .installed {
    display: grid;
    flex: none;
    place-items: center;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    color: var(--success);
    background: var(--success-weak);
  }

  .tag {
    flex: none;
    padding: 0 7px;
    font-size: 11px;
    line-height: 18px;
    color: var(--success);
    border: 1px solid currentColor;
    border-radius: 9px;
  }

  .release {
    max-width: 720px;
    padding: 20px 24px 12px;
  }

  .summary {
    margin: 0;
    font-size: 14px;
    line-height: 1.6;
    color: var(--fg-1);
  }

  .kind-section { margin-top: 28px; padding-top: 20px; border-top: 1px solid var(--stroke-0); }

  .kind-title {
    display: flex;
    align-items: center;
    gap: 7px;
    margin: 0 0 12px;
    font-size: 13px;
    font-weight: 600;
    color: var(--fg-0);
  }
  .kind-title :global(svg) { color: var(--fg-3); }
  .kind-title.added :global(svg) { color: var(--success); }
  .kind-title.changed :global(svg) { color: var(--accent); }
  .kind-title.fixed :global(svg) { color: var(--warning); }
  .kind-title.removed :global(svg) { color: var(--danger); }

  .kind-count {
    font-size: 11.5px;
    font-weight: 400;
    color: var(--fg-3);
  }

  .changes {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin: 0;
    padding: 0;
  }

  .change {
    position: relative;
    padding-left: 19px;
    font-size: 13px;
    line-height: 1.6;
    color: var(--fg-1);
  }
  .change::before {
    content: '';
    position: absolute;
    left: 5px;
    top: 9px;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--fg-4);
  }
</style>
