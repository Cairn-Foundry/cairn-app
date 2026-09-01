<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * Connections to GitLab, GitHub and Jira: the list on the left, one connection
   * edited on the right. The form is driven by the kind descriptor the backend
   * returns; the token never comes back from Rust, only whether one is stored.
   */
  import { onMount } from 'svelte';
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { t, type TranslationKey } from '$lib/i18n';
  import Icon from '$lib/components/Icon.svelte';
  import Select from '$lib/components/Select.svelte';
  import SearchInput from '$lib/components/SearchInput.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import CopyButton from '$lib/components/CopyButton.svelte';
  import {
    connections, connectionsError, kindDescriptors, loadConnections, loadKinds,
  } from '$lib/stores/integrations';
  import {
    deleteIntegrationConnection, saveIntegrationConnection, testIntegrationConnection, toIntegrationError,
  } from '$lib/services/integration-service';
  import { buildTokenHelpUrl } from '$lib/utils/integrations/links';
  import type {
    IntegrationConnection, IntegrationError, IntegrationIdentity, IntegrationKind, IntegrationKindDescriptor,
  } from '$lib/types/integrations';

  let ready = false;
  let search = '';
  let selectedId: string | null = null;
  let draft: IntegrationConnection | null = null;
  let credentials: Record<string, string> = {};
  let isTesting = false;
  let isSaving = false;
  let isTestedOk = false;
  let error: IntegrationError | null = null;
  let failedTests: Record<string, IntegrationError> = {};
  let removeTarget: IntegrationConnection | null = null;
  let isRemoving = false;

  onMount(async () => {
    await Promise.all([loadKinds(), loadConnections()]);
    ready = true;
    const first = $connections[0];
    if (first) select(first);
  });

  $: descriptor = draft ? $kindDescriptors.find((d) => d.kind === draft?.kind) ?? null : null;
  $: kindOptions = $kindDescriptors.map((d) => ({ value: d.kind, label: d.label }));
  $: isNew = draft !== null && selectedId === null;
  $: query = search.trim().toLowerCase();
  $: visible = query === ''
    ? $connections
    : $connections.filter((c) => `${c.label} ${c.baseUrl} ${c.identity?.login ?? ''}`.toLowerCase().includes(query));
  $: stored = selectedId === null ? null : $connections.find((c) => c.id === selectedId) ?? null;
  $: hasCredentialInput = Object.values(credentials).some((v) => v.trim() !== '');
  $: isDirty = draft !== null && (
    isNew
    || hasCredentialInput
    || stored === null
    || draft.label !== stored.label
    || draft.baseUrl !== stored.baseUrl
    || draft.kind !== stored.kind
  );
  $: isHttp = draft !== null && /^http:\/\//i.test(draft.baseUrl.trim());
  $: hasNewToken = (credentials.token ?? '').trim() !== '';
  $: isIncomplete = draft === null
    || draft.label.trim() === ''
    || !/^https?:\/\/\S+/i.test(draft.baseUrl.trim())
    || (isNew && !hasNewToken)
    || (descriptor?.credentialFields ?? []).some((f) => f.key !== 'token' && !(credentials[f.key] ?? draft?.email ?? '').trim());

  function iconOf(kind: IntegrationKind): string {
    return $kindDescriptors.find((d) => d.kind === kind)?.icon ?? 'link';
  }

  function hostOf(url: string): string {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  }

  /**
   * Reactive rather than a plain function: the template only re-reads a call
   * when its arguments change, so a plain one never noticed `failedTests`
   * gaining an entry and the badge kept reading "ok" after a test had failed.
   */
  $: statusOf = (connection: IntegrationConnection): 'ok' | 'noToken' | 'failed' => {
    if (!connection.hasCredentials) return 'noToken';
    if (failedTests[connection.id]) return 'failed';
    return 'ok';
  };

  function blank(kind: IntegrationKindDescriptor): IntegrationConnection {
    return {
      id: '',
      kind: kind.kind,
      label: kind.label,
      baseUrl: kind.defaultBaseUrl ?? '',
      hasCredentials: false,
      identity: null,
      createdAt: 0,
    };
  }

  function create() {
    const first = $kindDescriptors[0];
    if (!first) return;
    selectedId = null;
    draft = blank(first);
    credentials = {};
    isTestedOk = false;
    error = null;
  }

  function select(connection: IntegrationConnection) {
    selectedId = connection.id;
    draft = { ...connection };
    credentials = {};
    isTestedOk = false;
    error = null;
  }

  function close() {
    selectedId = null;
    draft = null;
    credentials = {};
    error = null;
  }

  function setKind(kind: string) {
    if (!draft) return;
    const next = $kindDescriptors.find((d) => d.kind === kind);
    if (!next) return;
    const isDefaultLabel = $kindDescriptors.some((d) => d.label === draft?.label);
    const isDefaultUrl = $kindDescriptors.some((d) => d.defaultBaseUrl === draft?.baseUrl) || draft.baseUrl === '';
    draft = {
      ...draft,
      kind: next.kind,
      label: isDefaultLabel ? next.label : draft.label,
      baseUrl: isDefaultUrl ? next.defaultBaseUrl ?? '' : draft.baseUrl,
    };
    credentials = {};
    isTestedOk = false;
  }

  async function persist(): Promise<IntegrationConnection> {
    if (!draft) throw new Error('no draft');
    const saved = await saveIntegrationConnection(draft, credentials);
    await loadConnections();
    return saved;
  }

  /**
   * The backend only tests a stored connection, so a test writes the draft first.
   * A new connection whose test fails is removed again, so nothing is kept
   * unless the user forces it with "Save anyway".
   */
  async function runTest() {
    if (!draft || isIncomplete) return;
    isTesting = true;
    error = null;
    const wasNew = isNew;
    let saved: IntegrationConnection | null = null;
    try {
      saved = await persist();
      const identity: IntegrationIdentity = await testIntegrationConnection(saved.id);
      await loadConnections();
      const { [saved.id]: _, ...rest } = failedTests;
      failedTests = rest;
      selectedId = saved.id;
      draft = { ...saved, identity, hasCredentials: true };
      credentials = {};
      isTestedOk = true;
    } catch (e) {
      error = toIntegrationError(e);
      if (saved && wasNew) {
        await deleteIntegrationConnection(saved.id);
        await loadConnections();
        draft = { ...draft, id: '' };
      } else if (saved) {
        failedTests = { ...failedTests, [saved.id]: error };
        selectedId = saved.id;
        draft = { ...saved };
        credentials = {};
      }
    } finally {
      isTesting = false;
    }
  }

  async function save() {
    if (!draft || isIncomplete) return;
    isSaving = true;
    error = null;
    try {
      const saved = await persist();
      selectedId = saved.id;
      draft = { ...saved };
      credentials = {};
    } catch (e) {
      error = toIntegrationError(e);
    } finally {
      isSaving = false;
    }
  }

  async function testExisting(connection: IntegrationConnection) {
    select(connection);
    await runTest();
  }

  async function confirmRemove() {
    if (!removeTarget) return;
    isRemoving = true;
    try {
      await deleteIntegrationConnection(removeTarget.id);
      await loadConnections();
      if (selectedId === removeTarget.id) close();
    } catch (e) {
      error = toIntegrationError(e);
    } finally {
      isRemoving = false;
      removeTarget = null;
    }
  }

  function errorText(err: IntegrationError): string {
    const base = t(`integrations.errors.${err.code}`) as string;
    return err.message && err.message !== base ? `${base} ${err.message}` : base;
  }
</script>

<div class="ag-layout">
  <aside class="ag-master">
    <div class="ag-master-header">
      <span class="ag-master-title">{t('integrations.title')}</span>
      <span class="master-actions">
        <button class="icon-btn" on:click={loadConnections} title={t('integrations.refresh') as string}>
          <Icon name="refresh" size={13}/>
        </button>
        <button class="icon-btn" on:click={create} title={t('integrations.addConnection') as string} disabled={!ready}>
          <Icon name="plus" size={13}/>
        </button>
      </span>
    </div>

    {#if ready && $connections.length > 0}
      <SearchInput bind:value={search} placeholder={t('integrations.searchPlaceholder') as string}/>
    {/if}

    {#if !ready}
      <div class="master-skeleton"><Skeleton lines={3} height={34} gap={4}/></div>
    {:else if $connections.length === 0}
      <p class="ag-master-empty">{t('integrations.noConnections')}</p>
    {:else if visible.length === 0}
      <p class="ag-master-empty">{t('integrations.noResults')}</p>
    {:else}
      {#each visible as connection (connection.id)}
        {@const status = statusOf(connection)}
        <div class="conn-row">
          <button
            class="ag-item {selectedId === connection.id ? 'active' : ''}"
            aria-pressed={selectedId === connection.id}
            on:click={() => select(connection)}
          >
            <span class="ag-tile"><Icon name={iconOf(connection.kind)} size={14}/></span>
            <span class="ag-item-info">
              <span class="ag-item-name">
                {connection.label}
                <span class="ag-dot {status === 'ok' ? 'ok' : status === 'failed' ? 'ko' : 'off'}" title={t(`integrations.status.${status}`) as string}></span>
              </span>
              <span class="ag-item-sub">{connection.identity?.login ?? hostOf(connection.baseUrl)}</span>
            </span>
          </button>
          <button
            class="icon-btn"
            on:click={() => testExisting(connection)}
            disabled={isTesting || !connection.hasCredentials}
            title={t('integrations.actions.test') as string}
          >
            {#if isTesting && selectedId === connection.id}<Spinner size={11}/>{:else}<Icon name="zap" size={12}/>{/if}
          </button>
          <button
            class="icon-btn delete"
            on:click={() => removeTarget = connection}
            title={t('integrations.actions.remove') as string}
          >
            <Icon name="trash" size={12}/>
          </button>
        </div>
      {/each}
    {/if}
  </aside>

  <section class="ag-detail">
    {#if draft === null || descriptor === null}
      <div class="ag-empty">
        <span class="ag-empty-icon"><Icon name="link" size={30} sw={1.2}/></span>
        <p class="ag-empty-title">{t('integrations.noConnections')}</p>
        <p class="ag-empty-desc">{t('integrations.noConnectionsBody')}</p>
        <div class="empty-actions">
          <button class="btn primary" on:click={create} disabled={!ready}>
            <Icon name="plus" size={12}/> {t('integrations.addConnection')}
          </button>
        </div>
      </div>
    {:else}
      <div class="ag-head">
        <span class="ag-tile ag-tile-lg">
          {#if draft.identity?.avatarUrl}
            <img class="avatar" src={draft.identity.avatarUrl} alt=""/>
          {:else}
            <Icon name={descriptor.icon} size={20}/>
          {/if}
        </span>
        <div class="ag-head-text">
          <h2 class="ag-head-title">{isNew ? t('integrations.form.title') : draft.label}</h2>
          <p class="ag-head-desc">
            {#if draft.identity}
              {t('integrations.identity')} <span class="selectable">{draft.identity.displayName || draft.identity.login}</span>
              <span class="login selectable">@{draft.identity.login}</span>
              {(t('integrations.connectedOn') as (h: string) => string)(hostOf(draft.baseUrl))}
            {:else}
              {t('integrations.noIdentity')}
            {/if}
          </p>
        </div>
        <div class="head-actions">
          {#if !isNew}
            <span class="ag-badge {statusOf(draft) === 'ok' ? 'accent' : ''}">
              {t(`integrations.status.${statusOf(draft)}`)}
            </span>
          {/if}
          <button class="btn" on:click={runTest} disabled={isTesting || isSaving || isIncomplete}>
            {#if isTesting}<Spinner size={11}/>{:else}<Icon name="zap" size={12}/>{/if}
            {t('integrations.test')}
          </button>
        </div>
      </div>

      {#if error}
        <div class="banner bad">
          <Icon name="alert" size={13}/>
          <span>{errorText(error)}{#if isNew} {t('integrations.form.testFailedRemoved')}{/if}</span>
        </div>
      {:else if isTestedOk}
        <div class="banner ok"><Icon name="check" size={13}/><span>{t('integrations.testOk')}</span></div>
      {/if}

      {#if isHttp}
        <div class="banner warn"><Icon name="alert" size={13}/><span>{t('integrations.form.httpWarning')}</span></div>
      {/if}

      <div class="ag-group">
        <div class="ag-group-title">{t('integrations.form.section')}</div>

        <div class="ag-card">
          <div class="ag-field">
            <div class="ag-card-info">
              <span class="ag-label">{t('integrations.form.kind')}</span>
            </div>
            <Select
              value={draft.kind}
              options={kindOptions}
              disabled={!isNew}
              ariaLabel={t('integrations.form.kind') as string}
              on:change={(e) => setKind(e.detail)}
            />
          </div>
        </div>

        <div class="ag-card">
          <div class="ag-field">
            <div class="ag-card-info">
              <label class="ag-label" for="integration-label">{t('integrations.form.label')}</label>
            </div>
            <input
              id="integration-label"
              class="ag-input selectable"
              type="text"
              placeholder={t('integrations.form.labelPlaceholder') as string}
              bind:value={draft.label}
            />
          </div>
        </div>

        <div class="ag-card">
          <div class="ag-field">
            <div class="ag-card-info">
              <label class="ag-label" for="integration-url">{t('integrations.form.baseUrl')}</label>
            </div>
            <div class="url-row">
              <input
                id="integration-url"
                class="ag-input selectable"
                type="text"
                spellcheck="false"
                placeholder={descriptor.defaultBaseUrl ?? 'https://'}
                bind:value={draft.baseUrl}
                on:input={() => isTestedOk = false}
              />
              {#if draft.baseUrl.trim()}<CopyButton value={draft.baseUrl.trim()}/>{/if}
            </div>
          </div>
        </div>
      </div>

      <div class="ag-group">
        <div class="ag-group-title">{t('integrations.token')}</div>

        <div class="ag-card">
          <div class="ag-card-info stacked">
            <span class="ag-hint">{t('integrations.form.help')}</span>
            {#if draft.kind === 'jira'}
              <span class="ag-hint">{t('integrations.form.jiraGlobalKey')}</span>
            {/if}
          </div>
          <div class="help-row">
            <button class="btn ghost link" on:click={() => openUrl(buildTokenHelpUrl(descriptor, draft?.baseUrl ?? ''))}>
              <Icon name="external" size={12}/> {t('integrations.createToken')}
            </button>
            <span class="scopes">
              <span class="ag-hint">{t('integrations.scopes')}</span>
              {#each descriptor.requiredScopes as scope (scope)}
                <code class="scope selectable">{scope}</code>
              {/each}
            </span>
          </div>
        </div>

        {#each descriptor.credentialFields as field (field.key)}
          <div class="ag-card">
            <div class="ag-field">
              <div class="ag-card-info">
                <label class="ag-label" for={`integration-${field.key}`}>{t(field.labelKey as TranslationKey)}</label>
                {#if field.key === 'token' && draft.hasCredentials}
                  <span class="ag-hint">{t('integrations.form.tokenKeep')}</span>
                {/if}
              </div>
              <input
                id={`integration-${field.key}`}
                class="ag-input selectable"
                type={field.secret ? 'password' : 'text'}
                autocomplete="off"
                spellcheck="false"
                placeholder={field.key !== 'token' && draft.email ? draft.email : ''}
                value={credentials[field.key] ?? ''}
                on:input={(e) => { credentials = { ...credentials, [field.key]: e.currentTarget.value }; isTestedOk = false; }}
              />
            </div>
          </div>
        {/each}
      </div>

      {#if isDirty}
      <div class="save-bar">
        <span class="save-note">
          {#if isNew && !isTestedOk}
            <span class="ag-hint warn">{t('integrations.form.testFirst')}</span>
          {:else if isTestedOk}
            <span class="ag-hint">{t('integrations.form.testedOk')}</span>
          {/if}
        </span>
        <button class="btn ghost" on:click={close} disabled={isSaving || isTesting}>
          {t('integrations.form.cancel')}
        </button>
        {#if isNew && !isTestedOk}
          <button class="btn" on:click={save} disabled={isSaving || isTesting || isIncomplete}>
            {#if isSaving}<Spinner size={11}/>{/if}
            {t('integrations.form.saveAnyway')}
          </button>
          <button class="btn primary" on:click={runTest} disabled={isTesting || isSaving || isIncomplete}>
            {#if isTesting}<Spinner size={11}/>{:else}<Icon name="zap" size={12}/>{/if}
            {t('integrations.test')}
          </button>
        {:else}
          <button class="btn primary" on:click={save} disabled={isSaving || isTesting || isIncomplete}>
            {#if isSaving}<Spinner size={11}/>{:else}<Icon name="save" size={12}/>{/if}
            {t('integrations.form.save')}
          </button>
        {/if}
      </div>
      {/if}
    {/if}
  </section>
</div>

{#if $connectionsError}
  <div class="banner bad floating"><Icon name="alert" size={13}/><span>{errorText($connectionsError)}</span></div>
{/if}

{#if removeTarget}
  <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
  <div
    class="modal-backdrop"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    on:click={() => removeTarget = null}
    on:keydown={(e) => e.key === 'Escape' && (removeTarget = null)}
  >
    <div class="modal remove-modal" on:click|stopPropagation role="presentation">
      <div class="modal-head">
        <div>
          <div class="step-count">{t('integrations.remove')}</div>
          <h3>{removeTarget.label}</h3>
        </div>
        <button class="icon-btn close" on:click={() => removeTarget = null} aria-label={t('common.close') as string}>
          <Icon name="x" size={16}/>
        </button>
      </div>
      <div class="modal-body">
        <p class="remove-desc">{(t('integrations.removeConfirm') as (l: string) => string)(removeTarget.label)}</p>
      </div>
      <div class="modal-foot">
        <div class="spacer"></div>
        <button class="btn ghost" on:click={() => removeTarget = null}>{t('common.cancel')}</button>
        <button class="btn danger" on:click={confirmRemove} disabled={isRemoving}>
          {#if isRemoving}<Spinner size={12}/>{:else}<Icon name="trash" size={14}/>{/if}
          {t('integrations.remove')}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .master-actions { display: flex; align-items: center; gap: 2px; }

  .icon-btn {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    flex-shrink: 0;
    padding: 0;
    background: none;
    border: 1px solid transparent;
    border-radius: var(--r-sm);
    color: var(--fg-3);
    cursor: pointer;
    transition: background .12s, color .12s, border-color .12s;
  }
  .icon-btn:hover:not(:disabled) { background: var(--bg-3); color: var(--fg-0); border-color: var(--stroke-0); }
  .icon-btn.delete:hover:not(:disabled) { background: var(--danger-weak); color: var(--danger); border-color: transparent; }
  .icon-btn:disabled { opacity: .5; cursor: default; }

  .master-skeleton { padding: 4px 8px; }

  .conn-row {
    display: flex;
    align-items: center;
    gap: 2px;
    border-radius: var(--r-md);
  }
  .conn-row :global(.ag-item) { min-width: 0; }

  .ag-dot.off { background: var(--fg-4); }

  .avatar {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: inherit;
  }

  .login {
    margin: 0 6px 0 4px;
    font-family: var(--font-mono);
    color: var(--fg-2);
  }

  .head-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }

  .banner {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 28px;
    max-width: 620px;
    padding: 9px 12px;
    border-radius: var(--r-md);
    font-size: 12px;
  }
  .banner.bad { background: var(--danger-weak); color: var(--danger); }
  .banner.warn { background: var(--warning-weak); color: var(--warning); }
  .banner.ok { background: color-mix(in oklch, var(--success) 14%, transparent); color: var(--success); }
  .banner.floating {
    position: fixed;
    right: 24px;
    bottom: 24px;
    z-index: 20;
    margin: 0;
    max-width: 420px;
  }
  .banner + .banner { margin-top: 8px; }

  .url-row { display: flex; align-items: center; gap: 6px; }
  .url-row :global(.ag-input) { flex: 1; min-width: 0; }

  .ag-card-info.stacked { margin-bottom: 8px; }

  .help-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px 14px;
  }
  .btn.link { padding-left: 6px; }
  .scopes { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; }
  .scope {
    padding: 1px 6px;
    background: var(--bg-3);
    border: 1px solid var(--stroke-0);
    border-radius: 99px;
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--fg-2);
  }

  .save-bar {
    position: sticky;
    bottom: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: 620px;
    margin: 8px -4px -4px;
    padding: 12px 4px;
    background: linear-gradient(to top, var(--bg-0) 70%, transparent);
  }
  .save-note { flex: 1; min-width: 0; }

  .empty-actions { display: flex; align-items: center; gap: 8px; }

  .remove-modal { width: min(460px, 92vw); }
  .remove-desc {
    margin: 0;
    font-size: 13px;
    color: var(--fg-2);
    line-height: 1.6;
  }
</style>
