<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * What's new section: a timeline of releases on the left, the selected one on the right.
   * Reads CHANGELOG directly - entries carry their own { en, fr } text rather than i18n keys.
   */
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n';
  import { CHANGELOG, CHANGE_KINDS, localized, type ChangeKind } from '$lib/data/changelog';

  const KINDS: Record<ChangeKind, { icon: string; label: string }> = {
    added: { icon: 'plus', label: t('home.changelog.kinds.added') as string },
    changed: { icon: 'edit', label: t('home.changelog.kinds.changed') as string },
    fixed: { icon: 'check', label: t('home.changelog.kinds.fixed') as string },
    removed: { icon: 'trash', label: t('home.changelog.kinds.removed') as string },
  };

  const currentVersion = __APP_VERSION__ ?? '';

  let selectedVersion = CHANGELOG[0]?.version ?? '';

  const releases = CHANGELOG.map(release => ({
    ...release,
    sections: CHANGE_KINDS
      .map(kind => ({ kind, changes: release.changes.filter(c => c.kind === kind) }))
      .filter(s => s.changes.length > 0),
  }));

  /** Selects a release and scrolls its block into view. */
  function selectVersion(version: string) {
    selectedVersion = version;
    document
      .getElementById(`changelog-release-${version}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

<div class="changelog">
  <nav class="timeline" aria-label={t('home.changelog.timelineLabel') as string}>
    {#each CHANGELOG as entry}
      <button
        class="node {entry.version === selectedVersion ? 'active' : ''}"
        aria-current={entry.version === selectedVersion}
        on:click={() => selectVersion(entry.version)}
      >
        <span class="marker" class:unreleased={!entry.date}></span>
        <span class="node-text">
          <span class="node-version">v{entry.version}</span>
          <span class="node-date">{formatDate(entry.date)}</span>
        </span>
        {#if entry.version === currentVersion}
          <span class="badge">{t('home.changelog.current')}</span>
        {/if}
      </button>
    {/each}
  </nav>

  <div class="releases">
    {#each releases as release}
      <article
        class="release"
        class:active={release.version === selectedVersion}
        id="changelog-release-{release.version}"
      >
        <header class="release-head">
          <h2 class="version selectable">v{release.version}</h2>
          {#if release.version === currentVersion}
            <span class="badge">{t('home.changelog.current')}</span>
          {/if}
          <span class="date">{formatDate(release.date)}</span>
        </header>
        <p class="summary selectable">{localized(release.summary)}</p>

        {#each release.sections as section}
          <section class="kind-section">
            <h3 class="kind-title {section.kind}">
              <span class="kind-icon"><Icon name={KINDS[section.kind].icon} size={11}/></span>
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
    {/each}
  </div>
</div>

<style>
  .changelog {
    display: flex;
    align-items: flex-start;
    gap: 28px;
  }

  /* -- Version timeline ---------------------------------------------------- */
  .timeline {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 200px;
    flex-shrink: 0;
    padding-left: 6px;
    position: sticky;
    top: 0;
  }
  .timeline::before {
    content: '';
    position: absolute;
    left: 18px;
    top: 18px;
    bottom: 18px;
    width: 1px;
    background: var(--stroke-0);
  }

  .node {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 7px 8px;
    background: none;
    border: none;
    border-radius: var(--r-sm);
    text-align: left;
    cursor: pointer;
    color: var(--fg-2);
    font-family: var(--font-ui);
  }
  .node:hover { background: var(--bg-4); color: var(--fg-0); }
  .node.active { background: var(--accent-weak); color: var(--fg-0); }

  .marker {
    width: 9px;
    height: 9px;
    flex-shrink: 0;
    border-radius: 50%;
    background: var(--bg-0);
    border: 2px solid var(--stroke-1);
  }
  .node.active .marker { background: var(--accent); border-color: var(--accent); }
  .marker.unreleased { border-style: dashed; }

  .node-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .node-version {
    font-family: var(--font-mono);
    font-size: 12.5px;
  }

  .node-date {
    font-size: 10.5px;
    color: var(--fg-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .badge {
    margin-left: auto;
    flex-shrink: 0;
    padding: 1px 5px;
    border-radius: var(--r-xs);
    font-size: 9.5px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--accent);
    background: var(--accent-weak);
    border: 1px solid var(--accent-line);
  }

  /* -- Releases ------------------------------------------------------------ */
  .releases {
    flex: 1;
    min-width: 0;
    max-width: 620px;
    display: flex;
    flex-direction: column;
    gap: 28px;
    scroll-behavior: smooth;
  }

  .release {
    position: relative;
    scroll-margin-top: 8px;
    padding: 18px 20px;
    background: var(--bg-2);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-lg);
  }

  .release + .release::before {
    content: '';
    position: absolute;
    left: 50%;
    top: -29px;
    width: 1px;
    height: 28px;
    background: var(--stroke-0);
  }
  .release + .release::after {
    content: '';
    position: absolute;
    left: 50%;
    top: -18px;
    width: 5px;
    height: 5px;
    margin-left: -2px;
    border-radius: 50%;
    background: var(--stroke-1);
  }
  .release.active { border-color: var(--accent-line); }
  .release-head .badge { margin-left: 0; align-self: center; }

  .release-head {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }

  .version {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 16px;
    color: var(--fg-0);
  }

  .date {
    margin-left: auto;
    font-size: 11.5px;
    color: var(--fg-3);
  }

  .summary {
    margin: 6px 0 0;
    font-size: 13px;
    color: var(--fg-2);
  }

  .kind-section {
    margin-top: 20px;
  }

  .kind-title {
    display: flex;
    align-items: center;
    gap: 7px;
    margin: 0 0 8px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--fg-3);
  }

  .kind-icon {
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border-radius: var(--r-xs);
    background: var(--bg-3);
  }
  .kind-title.added .kind-icon { color: var(--success); }
  .kind-title.changed .kind-icon { color: var(--accent); }
  .kind-title.removed .kind-icon { color: var(--danger); }

  .kind-count {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 400;
    color: var(--fg-4);
  }

  .changes {
    list-style: none;
    margin: 0;
    padding: 0 0 0 25px;
    display: flex;
    flex-direction: column;
    gap: 7px;
  }

  .change {
    position: relative;
    font-size: 12.5px;
    color: var(--fg-1);
    line-height: 1.55;
  }
  .change::before {
    content: '';
    position: absolute;
    left: -13px;
    top: 8px;
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background: var(--fg-4);
  }
</style>
