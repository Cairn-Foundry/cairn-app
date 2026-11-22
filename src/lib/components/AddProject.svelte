<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * Multi-step modal registering a project, from a new folder, an existing one or
   * a clone. `mode` drives which steps are shown; dispatches `created` with the
   * new project id, or `close`.
   */
  import { createEventDispatcher } from 'svelte';
  import Icon from '#lib/components/Icon.svelte';
  import Spinner from '#lib/components/Spinner.svelte';
  import ProjectColorPicker from '#lib/components/ProjectColorPicker.svelte';
  import ProjectIntegrationsForm from '#lib/components/ProjectIntegrationsForm.svelte';
  import GitProfileSelect from '#lib/components/GitProfileSelect.svelte';
  import { validateDirectory, cloneRepository } from '#lib/services/project-service';
  import { getRemoteUrl } from '#lib/services/git-service';
  import { parseRemoteUrl } from '#lib/utils/git/remote-url';
  import { projects, registerProject } from '#lib/stores/project';
  import { EMPTY_BINDINGS, saveProjectIntegrations } from '#lib/stores/integrations';
  import type { Project } from '#lib/types/project';
  import type { ProjectIntegrations } from '#lib/types/integrations';
  import { t } from '#lib/i18n';

  export let mode: 'new' | 'open' | 'clone';
  export let initialPath = '';
  export let initialCloneUrl = '';

  const dispatch = createEventDispatcher<{
    close: void;
    created: { id: string };
  }>();

  // Step layout per mode:
  //   new:   [identity] -> [integrations] -> [location]               (3 steps)
  //   open:  [location] -> [identity]     -> [integrations]           (3 steps)
  //   clone: [source]   -> [identity]     -> [integrations] -> [dest] (4 steps)

  type StepId = 'identity' | 'integrations' | 'location' | 'source' | 'destination';

  const STEPS: Record<typeof mode, StepId[]> = {
    new:   ['identity', 'integrations', 'location'],
    open:  ['location', 'identity', 'integrations'],
    clone: ['source', 'identity', 'integrations', 'destination'],
  };

  const STEP_HINTS: Partial<Record<StepId, string>> = {
    integrations: t('addProject.hintIntegrations') as string,
    location:     t('addProject.hintLocation') as string,
  };

  let step = 0;
  $: steps = STEPS[mode];
  $: current = steps[step];
  $: isLastStep = step === steps.length - 1;

  let loading = false;
  let error = '';

  // -- Fields ----------------------------------------------------------------
  let name = '';
  let path = initialPath;
  let color = '#6366f1';
  let gitProfileId = '';
  let cloneUrl = initialCloneUrl;
  let bindings: ProjectIntegrations = EMPTY_BINDINGS;
  let openedRemoteUrl = '';
  let openedRemotePath = '';

  $: cloneProtocolHint = /^(git@|ssh:\/\/)/.test(cloneUrl.trim())
    ? t('addProject.sshHint') as string
    : /^https?:\/\//.test(cloneUrl.trim()) ? t('addProject.httpsHint') as string : '';
  $: remoteUrl = mode === 'clone' ? cloneUrl.trim() : openedRemoteUrl;
  $: hasBindings = bindings.tracker !== null || bindings.forge !== null || bindings.ci !== null;
  $: if (mode === 'open' && current === 'identity' && path && path !== openedRemotePath) void resolveOpenedRemote(path);

  async function resolveOpenedRemote(target: string) {
    openedRemotePath = target;
    openedRemoteUrl = await getRemoteUrl(target).catch(() => '');
  }

  if (path) inferNameFromPath();
  if (cloneUrl) inferNameFromUrl();


  // -- Directory picker -------------------------------------------------------
  async function pickDirectory() {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const picked = await open({ directory: true, title: 'Select folder' });
      if (picked) {
        path = picked as string;
        if (!name) name = (picked as string).split('/').at(-1) ?? '';
      }
    } catch {
      alert('File dialog not available in dev mode');
    }
  }

  // Auto-fill name from clone URL on blur
  function inferNameFromUrl() {
    if (name || !cloneUrl.trim()) return;
    const slug = cloneUrl.trim().split('/').at(-1)?.replace(/\.git$/, '') ?? '';
    if (slug) name = slug;
  }

  // Auto-fill name from manually typed path on blur
  function inferNameFromPath() {
    if (name || !path.trim()) return;
    const slug = path.trim().replace(/\/$/, '').split('/').at(-1) ?? '';
    if (slug) name = slug;
  }

  type Fields = { name: string; cloneUrl: string; path: string; linkedCount: number };

  function isStepComplete(id: StepId, f: Fields): boolean {
    if (id === 'identity') return f.name.trim().length > 0;
    if (id === 'source') return f.cloneUrl.trim().length > 0;
    if (id === 'location' || id === 'destination') return f.path.length > 0;
    return true;
  }

  /** What the rail recalls of a step already passed. */
  function stepSummary(id: StepId, f: Fields): string {
    if (id === 'identity') return f.name.trim();
    if (id === 'source') return parseRemoteUrl(f.cloneUrl)?.path || f.cloneUrl.trim();
    if (id === 'location') return lastSegment(f.path);
    if (id === 'destination') return `${lastSegment(f.path)}/${f.name.trim()}`;
    return f.linkedCount === 0
      ? t('addProject.noIntegration') as string
      : (t('addProject.linkedIntegrations') as (n: number) => string)(f.linkedCount);
  }

  function lastSegment(value: string): string {
    return value.trim().replace(/\/+$/, '').split('/').at(-1) ?? '';
  }

  $: linkedCount = [bindings.tracker, bindings.forge, bindings.ci].filter((b) => b !== null).length;
  $: fields = { name, cloneUrl, path, linkedCount };
  $: canNext = isStepComplete(current, fields);
  $: canSubmit = steps.every((id) => isStepComplete(id, fields));

  function next()  { if (canNext && !loading) step = Math.min(steps.length - 1, step + 1); }
  function back()  { if (!loading) { error = ''; step = Math.max(0, step - 1); } }
  function goTo(index: number) { if (!loading && isReachable(index, fields)) { error = ''; step = index; } }

  /** A step can be opened once every step before it holds what it needs. */
  function isReachable(index: number, f: Fields): boolean {
    return steps.slice(0, index).every((id) => isStepComplete(id, f));
  }

  let visited = new Set<number>([0]);
  $: visited = visited.add(step);
  function close() { if (!loading) dispatch('close'); }

  /** Resolves the path (cloning first when needed), rejects duplicates, then registers the project. */
  async function submit() {
    if (!canSubmit || loading) return;
    loading = true;
    error = '';
    try {
      let resolvedPath: string;

      if (mode === 'clone') {
        resolvedPath = await cloneRepository(cloneUrl.trim(), path, name.trim());
      } else {
        resolvedPath = await validateDirectory(path);
      }

      // Duplicate-path guard - surface a friendly message rather than a silent skip
      const duplicate = $projects.find(p => p.path === resolvedPath);
      if (duplicate) {
        error = (t('addProject.duplicateError') as (name: string) => string)(duplicate.name);
        return;
      }

      const id = crypto.randomUUID();
      const project: Project = { id, name: name.trim(), path: resolvedPath, color, activeInstanceId: null, gitProfileId };
      await registerProject(project);
      if (hasBindings) await saveProjectIntegrations(id, bindings).catch(() => undefined);
      dispatch('created', { id });
    } catch (err) {
      error = String(err) === 'git_not_installed' ? (t('addProject.gitNotInstalled') as string) : String(err);
    } finally {
      loading = false;
    }
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && !loading) close();
    if (e.key === 'Enter' && (e.target as HTMLElement).closest('button')) return;
    if (e.key === 'Enter' && canNext && !loading) { if (isLastStep) void submit(); else next(); }
  }
</script>

<svelte:window on:keydown={handleKey} />

<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<div
  class="modal-backdrop"
  role="dialog"
  aria-modal="true"
  aria-labelledby="ap-title"
  tabindex="-1"
  on:click={() => { if (!loading) close(); }}
  on:keydown={() => {}}
>
  <div class="modal ap-modal" on:click|stopPropagation role="presentation">

    <div class="modal-head ap-head">
      <h2 id="ap-title">{t(`addProject.modeLabels.${mode}`)}</h2>
      <button class="icon-btn close" on:click={close} aria-label={t('common.close') as string}>
        <Icon name="x" size={16}/>
      </button>
    </div>

    <div class="ap-main">
      <ol class="ap-steps">
        {#each steps as id, i (id)}
          {@const isDone = i !== step && visited.has(i) && isStepComplete(id, fields)}
          <li>
            <button
              class="ap-step"
              class:is-done={isDone}
              class:is-current={i === step}
              disabled={i === step || loading || !isReachable(i, fields)}
              aria-current={i === step ? 'step' : undefined}
              on:click={() => goTo(i)}
            >
              <span class="ap-step-mark">
                {#if isDone}<Icon name="check" size={13}/>{:else}{i + 1}{/if}
              </span>
              <span class="ap-step-text">
                <span class="ap-step-label">{t(`addProject.stepLabels.${id}`)}</span>
                {#if isDone}
                  <span class="ap-step-sub" title={id === 'location' || id === 'destination' ? path : undefined}>
                    {#if id === 'identity'}<span class="ap-swatch" style="background: {color}"></span>{/if}
                    <span class="ap-step-value">{stepSummary(id, fields)}</span>
                  </span>
                {:else if id === 'integrations'}
                  <span class="ap-step-sub">{t('addProject.optional')}</span>
                {/if}
              </span>
            </button>
          </li>
        {/each}
      </ol>

      <div class="modal-body ap-body">
        <h3 class:has-hint={STEP_HINTS[current]}>{t(`addProject.modalTitles.${current}`)}</h3>
        {#if STEP_HINTS[current]}<p class="ap-hint">{STEP_HINTS[current]}</p>{/if}

        {#if current === 'identity'}
          <div class="form-section">
            <label class="ap-label" for="{mode}-name">{t('addProject.projectName')}</label>
            <input
              id="{mode}-name"
              class="ap-input"
              bind:value={name}
              autocomplete="off"
            />
          </div>

          <div class="form-section">
            <div class="ap-label is-over-swatches">{t('addProject.color')}</div>
            <ProjectColorPicker bind:color idSuffix={mode} />
          </div>

        {:else if current === 'integrations'}
          <ProjectIntegrationsForm {remoteUrl} bind:bindings isTitled={false} />

          <GitProfileSelect bind:value={gitProfileId} label={t('addProject.gitProfile') as string} hint={t('addProject.gitProfileHint') as string} />

        {:else if current === 'location' || current === 'destination'}
          {#if current === 'destination'}
            <label class="ap-label" for="ap-path">{t('addProject.parentFolder')}</label>
          {/if}
          <div class="path-row">
            <input
              id="ap-path"
              aria-label={current === 'location' ? t('addProject.folder') as string : undefined}
              class="ap-input mono"
              bind:value={path}
              on:blur={current === 'location' ? inferNameFromPath : undefined}
              placeholder={t('addProject.pathInputPlaceholder') as string}
              autocomplete="off"
              spellcheck="false"
            />
            <button class="btn browse-btn" on:click={pickDirectory}>
              <Icon name="folder" size={14}/> {t('addProject.browse')}
            </button>
          </div>
          {#if current === 'destination' && path && name.trim()}
            <p class="path-result">{t('addProject.clonedInto')} <span class="selectable">{path.replace(/\/+$/, '')}/{name.trim()}</span></p>
          {/if}

        {:else if current === 'source'}
          <label class="ap-label" for="clone-url">{t('addProject.repoUrl')}</label>
          <input
            id="clone-url"
            class="ap-input mono"
            bind:value={cloneUrl}
            on:blur={inferNameFromUrl}
            placeholder={t('addProject.repoUrlPlaceholder') as string}
            autocomplete="off"
            spellcheck="false"
          />
          {#if cloneProtocolHint}<p class="method-hint">{cloneProtocolHint}</p>{/if}
        {/if}

        {#if error}
          <div class="ap-error" role="alert">
            <Icon name="info" size={14}/> {error}
          </div>
        {/if}
      </div>
    </div>

    <div class="modal-foot">
      <div class="spacer"></div>
      {#if step > 0}
        <button class="btn ghost" on:click={back} disabled={loading}>{t('common.back')}</button>
      {/if}
      {#if !isLastStep}
        <button class="btn primary" disabled={!canNext || loading} on:click={next}>
          {t('common.continue')} <Icon name="chev-r" size={14}/>
        </button>
      {:else}
        <button class="btn primary" disabled={!canSubmit || loading} on:click={submit}>
          {#if loading}
            <Spinner />
            {#if mode === 'clone'}{t('common.cloning')}{:else}{t('common.creating')}{/if}
          {:else if mode === 'clone'}
            {t('addProject.cloneAndOpen')}
          {:else}
            {t('addProject.addProject')}
          {/if}
        </button>
      {/if}
    </div>

  </div>
</div>

<style>
  .ap-modal {
    width: min(760px, 92vw);
    height: min(560px, 86vh);
  }
  .ap-head { padding-block: 14px; }
  .ap-head h2 {
    margin: 0;
    line-height: 1;
    font-family: var(--font-serif);
    font-size: 22px;
    font-weight: 400;
    color: var(--fg-0);
  }

  .ap-main {
    flex: 1;
    display: grid;
    grid-template-columns: 216px minmax(0, 1fr);
    min-height: 0;
  }

  /* -- Steps rail -- */
  .ap-steps {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    padding: 20px 0;
    list-style: none;
    background: var(--bg-0);
    border-right: 1px solid var(--stroke-0);
  }
  .ap-step {
    display: grid;
    grid-template-columns: 16px minmax(0, 1fr);
    gap: 10px;
    width: 100%;
    padding: 7px 20px 7px 22px;
    box-shadow: inset 2px 0 0 transparent;
    color: var(--fg-4);
    text-align: left;
  }
  .ap-step:disabled { cursor: default; opacity: 1; }
  .ap-step:not(:disabled):hover { color: var(--fg-0); }
  .ap-step:not(:disabled) { color: var(--fg-3); }
  .ap-step.is-done { color: var(--fg-2); }
  .ap-step.is-current { color: var(--fg-0); box-shadow: inset 2px 0 0 var(--accent); }
  .ap-step-mark {
    display: flex;
    align-items: center;
    height: 18px;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .ap-step.is-done .ap-step-mark { color: var(--fg-3); }
  .ap-step-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .ap-step-label { font-size: 13px; line-height: 18px; }
  .ap-step.is-current .ap-step-label { font-weight: 600; }
  .ap-step-sub {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    font-size: 11.5px;
    color: var(--fg-3);
  }
  .ap-step-value { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ap-swatch { flex: none; width: 7px; height: 7px; border-radius: 2px; }

  /* -- Step content -- */
  .ap-body { padding: 24px 32px; }
  .ap-body h3 {
    margin: 0 0 20px;
    font-size: 15px;
    font-weight: 600;
    color: var(--fg-0);
  }
  .ap-body h3.has-hint { margin-bottom: 4px; }
  .ap-hint {
    max-width: 60ch;
    margin: 0 0 24px;
    font-size: 12.5px;
    line-height: 1.55;
    color: var(--fg-3);
  }
  .form-section { margin-bottom: 28px; }
  .ap-label {
    display: block;
    margin-bottom: 10px;
    font-size: 12px;
    font-weight: 500;
    color: var(--fg-2);
  }

  .ap-label.is-over-swatches { margin-bottom: 14px; }

  .ap-input {
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
  .ap-input:focus { border-color: var(--accent-line); }
  .ap-input::placeholder { color: var(--fg-4); opacity: 1; }
  .ap-input.mono { font-family: var(--font-mono); font-size: 12.5px; }

  .path-row { display: flex; gap: 8px; }
  .browse-btn { flex: none; height: 32px; }
  .path-result {
    margin: 8px 0 0;
    font-size: 12px;
    color: var(--fg-3);
  }
  .path-result span { font-family: var(--font-mono); color: var(--fg-1); }

  .method-hint { margin: 8px 0 0; font-size: 12px; line-height: 1.5; color: var(--fg-3); }

  .ap-error {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin-top: 16px;
    padding: 10px 12px;
    background: var(--danger-weak, oklch(0.28 0.06 15));
    border: 1px solid var(--danger, oklch(0.62 0.18 15));
    border-radius: var(--r-sm);
    font-size: 12px;
    line-height: 1.5;
    color: var(--danger, oklch(0.75 0.18 15));
  }
</style>
