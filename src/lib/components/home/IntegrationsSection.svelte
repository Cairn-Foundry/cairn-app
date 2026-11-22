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
  import { openUrl } from '#lib/services/opener-service';
  import { t, type TranslationKey } from '#lib/i18n';
  import Icon from '#lib/components/Icon.svelte';
  import Select from '#lib/components/Select.svelte';
  import SearchInput from '#lib/components/SearchInput.svelte';
  import SearchEmpty from '#lib/components/SearchEmpty.svelte';
  import RemoveConnectionModal from './RemoveConnectionModal.svelte';
  import SplitPanel from '#lib/components/SplitPanel.svelte';
  import Spinner from '#lib/components/Spinner.svelte';
  import Skeleton from '#lib/components/Skeleton.svelte';
  import CopyButton from '#lib/components/CopyButton.svelte';
  import {
    connections, connectionsError, kindDescriptors, loadConnections, loadKinds,
  } from '#lib/stores/integrations';
  import {
    deleteIntegrationConnection, saveIntegrationConnection, testIntegrationConnection, toIntegrationError,
  } from '#lib/services/integration-service';
  import { buildTokenHelpUrl } from '#lib/utils/integrations/links';
  import type {
    IntegrationConnection, IntegrationError, IntegrationIdentity, IntegrationKind, IntegrationKindDescriptor,
  } from '#lib/types/integrations';

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

{#if ready && $connections.length === 0 && draft === null}
  <header class="in-head"><h1>{t('integrations.title')}</h1></header>
  <section class="in-empty">
    <Icon name="link" size={22}/>
    <h2>{t('integrations.noConnections')}</h2>
    <p>{t('integrations.noConnectionsBody')}</p>
    <button class="btn primary in-add" on:click={create}>
      <Icon name="plus" size={12}/> {t('integrations.addConnection')}
    </button>
  </section>
{:else}
<SplitPanel title={t('integrations.title') as string} count={$connections.length}>
  <svelte:fragment slot="list">
    <div class="in-list-tools">
      <SearchInput bind:value={search} placeholder={t('integrations.searchPlaceholder') as string}/>
    </div>

    <div class="in-list-items">
      {#if !ready}
        <Skeleton lines={3} height={36} gap={6}/>
      {:else}
        {#each visible as connection (connection.id)}
          {@const status = statusOf(connection)}
          <button
            class="in-item"
            class:is-active={selectedId === connection.id}
            aria-pressed={selectedId === connection.id}
            on:click={() => select(connection)}
          >
            <span class="in-tile"><Icon name={iconOf(connection.kind)} size={14}/></span>
            <span class="in-item-text">
              <span class="in-item-name">{connection.label}</span>
              <span class="in-item-sub">{connection.identity?.login ?? hostOf(connection.baseUrl)}</span>
            </span>
            <span class="in-dot {status === 'ok' ? 'ok' : status === 'failed' ? 'ko' : 'off'}" title={t(`integrations.status.${status}`) as string}></span>
          </button>
        {/each}
        {#if visible.length === 0 && query !== ''}
          <SearchEmpty
            isCompact
            title={t('integrations.noResults') as string}
            text={(t('integrations.noResultsText') as (q: string) => string)(search.trim())}
            clearLabel={t('common.clearSearch') as string}
            on:clear={() => (search = '')}
          />
        {/if}
        <!-- The connection being added sits in the list like the others, so the
             ones already there stay in view. -->
        {#if isNew && draft && descriptor}
          <button class="in-item is-active" aria-pressed="true">
            <span class="in-tile"><Icon name={descriptor.icon} size={14}/></span>
            <span class="in-item-text">
              <span class="in-item-name">{draft.label.trim() || t('integrations.form.title')}</span>
              <span class="in-item-sub">{t('integrations.form.title')}</span>
            </span>
          </button>
        {:else if visible.length > 0 || query === ''}
          <button class="in-item in-add" on:click={create} disabled={!ready}>
            <span class="in-tile is-dashed"><Icon name="plus" size={14}/></span>
            <span class="in-item-name">{t('integrations.addConnection')}</span>
          </button>
        {/if}
      {/if}
    </div>
  </svelte:fragment>

    {#if draft === null || descriptor === null}
      <div class="in-detail-none">
        <span class="in-none-tiles" aria-hidden="true">
          {#each $kindDescriptors as kind (kind.kind)}
            <span class="in-tile"><Icon name={kind.icon} size={16}/></span>
          {/each}
        </span>
        <h2>{t('integrations.pickTitle')}</h2>
        <p>{t('integrations.pickConnection')}</p>
        <button class="btn" on:click={create} disabled={!ready}>
          <Icon name="plus" size={12}/> {t('integrations.addConnection')}
        </button>
      </div>
    {:else}
      <div class="in-detail-head">
        <span class="in-tile is-large">
          {#if draft.identity?.avatarUrl}
            <img class="avatar" src={draft.identity.avatarUrl} alt=""/>
          {:else}
            <Icon name={descriptor.icon} size={18}/>
          {/if}
        </span>
        <div class="in-detail-title">
          <div class="in-title-row">
            <h2>{isNew ? t('integrations.form.title') : draft.label}</h2>
            {#if !isNew}
              {@const status = statusOf(draft)}
              <span class="in-status">
                <span class="in-dot {status === 'ok' ? 'ok' : status === 'failed' ? 'ko' : 'off'}"></span>
                {t(`integrations.status.${status}`)}
              </span>
            {/if}
          </div>
          <p>
            {#if draft.identity}
              <span class="account selectable">{draft.identity.login}</span>
              {(t('integrations.connectedOn') as (h: string) => string)(hostOf(draft.baseUrl))}
            {:else}
              {t('integrations.noIdentity')}
            {/if}
          </p>
        </div>
        <!-- A new connection is tested from the save bar, which also saves it. -->
        {#if !isNew}
          <button class="btn" on:click={runTest} disabled={isTesting || isSaving || isIncomplete}>
            {#if isTesting}<Spinner size={11}/>{:else}<Icon name="zap" size={12}/>{/if}
            {t('integrations.test')}
          </button>
        {/if}
        {#if !isNew && stored}
          <button
            class="btn ghost in-icon-btn delete"
            on:click={() => removeTarget = stored}
            aria-label={t('integrations.actions.remove') as string}
            title={t('integrations.actions.remove') as string}
          >
            <Icon name="trash" size={13}/>
          </button>
        {/if}
      </div>

      <div class="in-detail-body">

        <div class="in-section">
          <div class="in-section-head"><h3>{t('integrations.form.section')}</h3></div>

          <div class="in-field">
            <span class="in-label">{t('integrations.form.kind')}</span>
            <Select
              value={draft.kind}
              options={kindOptions}
              disabled={!isNew}
              ariaLabel={t('integrations.form.kind') as string}
              on:change={(e) => setKind(e.detail)}
            />
          </div>

          <div class="in-field">
            <label class="in-label" for="integration-label">{t('integrations.form.label')}</label>
            <input
              id="integration-label"
              class="in-input selectable"
              type="text"
              placeholder={t('integrations.form.labelPlaceholder') as string}
              bind:value={draft.label}
            />
          </div>

          <div class="in-field">
            <label class="in-label" for="integration-url">{t('integrations.form.baseUrl')}</label>
            <input
              id="integration-url"
              class="in-input selectable"
              type="text"
              spellcheck="false"
              placeholder={descriptor.defaultBaseUrl ?? 'https://'}
              bind:value={draft.baseUrl}
              on:input={() => isTestedOk = false}
            />
            {#if draft.baseUrl.trim()}<CopyButton value={draft.baseUrl.trim()}/>{/if}
          </div>
        </div>

        <div class="in-section">
          <div class="in-section-head">
            <h3>{t('integrations.token')}</h3>
            <button class="in-link" on:click={() => openUrl(buildTokenHelpUrl(descriptor, draft?.baseUrl ?? ''))}>
              {t('integrations.createToken')} <Icon name="external" size={12}/>
            </button>
          </div>
          {#if draft.kind === 'jira'}
            <p class="in-note">{t('integrations.form.jiraGlobalKey')}</p>
          {/if}

          {#each descriptor.credentialFields as field (field.key)}
            <div class="in-field">
              <label class="in-label" for={`integration-${field.key}`}>{t(field.labelKey as TranslationKey)}</label>
              <div class="in-control">
                <input
                  id={`integration-${field.key}`}
                  class="in-input selectable"
                  type={field.secret ? 'password' : 'text'}
                  autocomplete="off"
                  spellcheck="false"
                  placeholder={field.key !== 'token' && draft.email ? draft.email : ''}
                  value={credentials[field.key] ?? ''}
                  on:input={(e) => { credentials = { ...credentials, [field.key]: e.currentTarget.value }; isTestedOk = false; }}
                />
                {#if field.key === 'token' && draft.hasCredentials}
                  <span class="in-hint">{t('integrations.form.tokenKeep')}</span>
                {/if}
              </div>
            </div>
          {/each}

          {#if descriptor.requiredScopes.length > 0}
            <div class="in-field">
              <span class="in-label">{t('integrations.scopes')}</span>
              <span class="scopes">
                {#each descriptor.requiredScopes as scope (scope)}
                  <code class="scope selectable">{scope}</code>
                {/each}
              </span>
            </div>
          {/if}
        </div>
      </div>

      {#if error || isTestedOk || isHttp}
        <div class="in-notices">
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
        </div>
      {/if}

      {#if isDirty}
        <div class="save-bar">
          <span class="save-note">
            {#if isNew && !isTestedOk}
              <span class="in-hint warn">{t('integrations.form.testFirst')}</span>
            {:else if isTestedOk}
              <span class="in-hint">{t('integrations.form.testedOk')}</span>
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
</SplitPanel>
{/if}

{#if $connectionsError}
  <div class="banner bad floating"><Icon name="alert" size={13}/><span>{errorText($connectionsError)}</span></div>
{/if}

{#if removeTarget}
  <RemoveConnectionModal
    connection={removeTarget}
    icon={iconOf(removeTarget.kind)}
    host={hostOf(removeTarget.baseUrl)}
    isRemoving={isRemoving}
    on:close={() => removeTarget = null}
    on:confirm={confirmRemove}
  />
{/if}

<style>
  /* -- head -- */
  .in-head { margin-bottom: 32px; }
  .in-head h1 {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0;
    font-family: var(--font-ui);
    font-size: 18px;
    font-weight: 600;
    color: var(--fg-0);
  }
  .in-icon-btn { flex: none; width: 28px; height: 28px; padding: 0; justify-content: center; }
  .in-icon-btn.delete:hover { background: var(--danger-weak); color: var(--danger); }

  /* -- nothing connected -- */
  .in-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 64px 0;
    text-align: center;
    color: var(--fg-3);
  }
  .in-empty h2 { margin: 8px 0 0; font-size: 15px; font-weight: 600; color: var(--fg-0); }
  .in-empty p { max-width: 52ch; margin: 0 0 8px; font-size: 13px; line-height: 1.55; color: var(--fg-2); }

  /* -- list -- */
  .in-list-tools { padding: 12px 12px 8px; }
  .in-list-tools :global(.ag-search) { height: 28px; box-sizing: border-box; margin: 0; }
  .in-list-items {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-height: 0;
    padding: 4px 12px 12px;
    overflow-y: auto;
  }
  .in-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-width: 0;
    flex-shrink: 0;
    padding: 7px 10px;
    border-radius: var(--r-sm);
    text-align: left;
    color: var(--fg-1);
  }
  .in-item:hover { background: var(--bg-2); }
  .in-item.is-active { background: var(--bg-2); color: var(--fg-0); }
  .in-item.in-add { color: var(--fg-2); }
  .in-item.in-add:hover { color: var(--fg-0); }
  .in-item-text { display: flex; flex: 1; flex-direction: column; min-width: 0; }
  .in-item-name,
  .in-item-sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .in-item-name { font-size: 13px; font-weight: 500; }
  .in-item-sub { font-size: 11.5px; color: var(--fg-3); }

  .in-tile {
    display: grid;
    flex: none;
    place-items: center;
    width: 28px;
    height: 28px;
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-sm);
    background: var(--bg-2);
    color: var(--fg-1);
  }
  .in-tile.is-dashed { border: 1px dashed var(--stroke-1); background: transparent; color: var(--fg-3); }
  .in-tile.is-large { width: 40px; height: 40px; border-radius: var(--r-md); }
  .avatar { width: 100%; height: 100%; object-fit: cover; border-radius: inherit; }

  .in-dot { flex: none; width: 7px; height: 7px; border-radius: 50%; }
  .in-dot.ok { background: var(--success); }
  .in-dot.ko { background: var(--danger); }
  .in-dot.off { border: 1.5px solid var(--fg-4); box-sizing: border-box; }

  /* -- detail -- */
  .in-detail-none {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 32px;
    text-align: center;
  }
  .in-none-tiles { display: flex; gap: 8px; margin-bottom: 12px; }
  .in-none-tiles .in-tile { width: 36px; height: 36px; border-radius: var(--r-md); color: var(--fg-3); }
  .in-detail-none h2 { margin: 0; font-size: 14px; font-weight: 600; color: var(--fg-0); }
  .in-detail-none p { max-width: 40ch; margin: 0 0 8px; font-size: 12.5px; line-height: 1.55; color: var(--fg-3); }
  .in-detail-head {
    display: flex;
    flex: none;
    align-items: center;
    gap: 12px;
    padding: 16px 24px;
    border-bottom: 1px solid var(--stroke-0);
  }
  .in-detail-title { flex: 1; min-width: 0; }
  .in-title-row { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .in-title-row h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: var(--fg-0);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .in-detail-title p { margin: 3px 0 0; font-size: 12px; color: var(--fg-3); }
  .account { color: var(--fg-1); }
  .in-status {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 6px;
    padding: 0 8px;
    font-size: 11.5px;
    line-height: 20px;
    color: var(--fg-2);
    border: 1px solid var(--stroke-0);
    border-radius: 10px;
  }
  .in-detail-body { flex: 1; min-height: 0; overflow-y: auto; padding-bottom: 12px; }

  .in-section { padding: 20px 24px 6px; }
  .in-section + .in-section { border-top: 1px solid var(--stroke-0); }
  .in-section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 16px;
  }
  .in-section-head h3 { margin: 0; font-size: 13px; font-weight: 600; color: var(--fg-0); }
  .in-note { max-width: 70ch; margin: -6px 0 16px; font-size: 12px; line-height: 1.55; color: var(--fg-3); }

  /* Three columns: the last one holds the copy button of the server URL and
     stays empty elsewhere, so every field ends on the same edge. */
  .in-field {
    display: grid;
    grid-template-columns: 172px minmax(0, 1fr) 28px;
    align-items: start;
    column-gap: 12px;
    margin-bottom: 14px;
  }
  .in-field > :nth-child(2) { grid-column: 2; }
  .in-label { padding-top: 7px; font-size: 12.5px; color: var(--fg-2); }
  .in-control { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .in-input {
    width: 100%;
    box-sizing: border-box;
    height: 32px;
    padding: 0 10px;
    background: var(--bg-0);
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-sm);
    font-family: var(--font-ui);
    font-size: 13px;
    color: var(--fg-0);
    outline: none;
  }
  .in-input:focus { border-color: var(--accent-line); }
  .in-input::placeholder { color: var(--fg-4); opacity: 1; }
  .in-field :global(.copy-btn) { align-self: center; justify-self: center; }
  .in-hint { font-size: 12px; color: var(--fg-3); }
  .in-hint.warn { color: var(--warning); }

  .in-link {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 0;
    font-size: 12.5px;
    color: var(--accent);
  }
  .in-link:hover { text-decoration: underline; }
  .scopes { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; padding-top: 5px; }
  .scope {
    padding: 1px 6px;
    background: var(--bg-2);
    border: 1px solid var(--stroke-0);
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-2);
  }

  .in-notices { display: flex; flex: none; flex-direction: column; gap: 8px; padding: 0 24px 16px; }
  .banner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 12px;
    border-radius: var(--r-sm);
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

  .save-bar {
    display: flex;
    flex: none;
    align-items: center;
    gap: 8px;
    padding: 12px 24px;
    border-top: 1px solid var(--stroke-0);
    background: var(--bg-0);
  }
  .save-note { flex: 1; min-width: 0; }

</style>
