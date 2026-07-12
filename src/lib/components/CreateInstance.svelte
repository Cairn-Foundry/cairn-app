<script lang="ts">
  import { createEventDispatcher, onMount, tick } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import { t } from '$lib/i18n';
  import { activeProject } from '$lib/stores/project';
  import { spawnInstance, instances } from '$lib/stores/instance';
  import { listBranchesDetailed } from '$lib/services/instance-service';
  import { matchesSearch } from '$lib/utils/files/files-search';
  import { slugify } from '$lib/utils/format';

  const dispatch = createEventDispatcher<{ close: void; create: { instanceId: string } }>();

  // step: 0 = ticket, 1 = mode, 2 = git config (skipped for local)
  let step = 0;
  let ticketId = '';
  let ticketTitle = '';
  let useGit = true;
  let branchName = '';
  let baseBranch = 'main';
  let availableBranches: string[] = [];
  let remoteBranches: string[] = [];
  let branchSearch = '';
  let isGitRepo = false;
  let creating = false;
  let error = '';
  let prevSlug = '';

  let refreshingBranches = false;

  async function loadBranchList() {
    if (!$activeProject) return;
    refreshingBranches = true;
    try {
      const { local, remote } = await listBranchesDetailed($activeProject.path);
      availableBranches = local;
      remoteBranches = remote;
      isGitRepo = true;
      const all = [...local, ...remote];
      if (!all.includes(baseBranch)) {
        if (local.includes('main')) baseBranch = 'main';
        else if (local.includes('master')) baseBranch = 'master';
        else if (local.length > 0) baseBranch = local[0];
        else if (remote.length > 0) baseBranch = remote[0];
      }
    } catch {
      availableBranches = [];
      remoteBranches = [];
      isGitRepo = false;
      useGit = false;
    } finally {
      refreshingBranches = false;
    }
  }

  onMount(loadBranchList);

  $: if (ticketId) {
    const slug = slugify(ticketId);
    const generated = `feat/${slug}`;
    if (!branchName || branchName === prevSlug) branchName = generated;
    prevSlug = generated;
  }

  $: worktreePath = useGit
    ? `~/.cairn/worktrees/${branchName.replace(/\//g, '-')}`
    : `~/.cairn/worktrees/${slugify(ticketId)}`;

  $: totalSteps = useGit ? 3 : 2;

  $: displayStep = step + 1;

  const stepMeta: Record<number, { label: string; title: string }> = {
    0: { label: t('createInstance.stepLabels.ticket') as string, title: t('createInstance.stepTitles.ticket') as string },
    1: { label: t('createInstance.stepLabels.mode') as string,   title: t('createInstance.stepTitles.mode') as string },
    2: { label: t('createInstance.stepLabels.branch') as string, title: t('createInstance.stepTitles.branch') as string },
  };

  $: duplicateBranch = useGit && branchName.trim().length > 0
    && $instances.some(i => i.branch === branchName.trim());

  $: canNext =
    step === 0 ? ticketId.trim().length > 0 && ticketTitle.trim().length > 0 :
    step === 2 ? branchName.trim().length > 0 && !duplicateBranch :
    true;

  function next() {
    error = '';
    step = Math.min(2, step + 1);
  }

  function back() {
    error = '';
    step = Math.max(0, step - 1);
  }

  $: dots = useGit ? [0, 1, 2] : [0, 1];

  async function handleCreate() {
    if (!$activeProject) return;
    creating = true;
    error = '';
    await tick();
    await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    try {
      const instance = await spawnInstance({
        id: crypto.randomUUID(),
        projectId: $activeProject.id,
        projectPath: $activeProject.path,
        ticket: { id: ticketId.trim(), title: ticketTitle.trim() },
        useGit,
        ...(useGit ? { branch: branchName.trim(), baseBranch } : {}),
      });
      dispatch('create', { instanceId: instance.id });
    } catch (err) {
      error = String(err);
      creating = false;
    }
  }
</script>

<div class="modal-backdrop" on:click={() => dispatch('close')} role="button" tabindex="-1" on:keydown={() => {}}>
  <div class="modal" on:click|stopPropagation role="presentation">
    <div class="modal-head">
      <div>
        <div class="step-count">{(t('common.stepOf') as (s: number, t: number) => string)(displayStep, totalSteps)} - {stepMeta[step].label}</div>
        <h3>{stepMeta[step].title}</h3>
      </div>
      <button class="icon-btn close" on:click={() => dispatch('close')}><Icon name="x" size={16}/></button>
    </div>

    <div class="modal-body" class:loading={creating}>
      {#if creating}
        <div class="creating-overlay">
          <Spinner size={28} stroke={3} trackColor="var(--stroke-1)" color="var(--accent)" />
          <span class="creating-label">{t('createInstance.settingUp')}</span>
        </div>
      {/if}

      {#if step === 0}
        <div class="form-row">
          <label for="ticket-id">{t('createInstance.ticketId')}</label>
          <input id="ticket-id" type="text" bind:value={ticketId} placeholder={t('createInstance.ticketIdPlaceholder') as string} />
        </div>
        <div class="form-row">
          <label for="ticket-title">{t('createInstance.title')}</label>
          <input id="ticket-title" type="text" bind:value={ticketTitle} placeholder={t('createInstance.titlePlaceholder') as string} />
        </div>
      {/if}

      {#if step === 1}
        <div class="mode-grid">
          <button
            class="mode-card {useGit ? 'active' : ''} {!isGitRepo ? 'disabled' : ''}"
            disabled={!isGitRepo}
            on:click={() => { if (isGitRepo) useGit = true; }}
          >
            <span class="mode-icon"><Icon name="branch" size={22}/></span>
            <span class="mode-label">{t('createInstance.gitWorktree')}</span>
            <span class="mode-desc">
              {#if isGitRepo}
                {t('createInstance.gitWorktreeDesc')}
              {:else}
                {t('createInstance.gitWorktreeUnavailable')}
              {/if}
            </span>
          </button>
          <button
            class="mode-card {!useGit ? 'active' : ''}"
            on:click={() => useGit = false}
          >
            <span class="mode-icon"><Icon name="folder" size={22}/></span>
            <span class="mode-label">{t('createInstance.localOnly')}</span>
            <span class="mode-desc">{t('createInstance.localOnlyDesc')}</span>
          </button>
        </div>
      {/if}

      {#if step === 2}
        <div class="form-row">
          <div class="field-label">{t('createInstance.baseBranch')}</div>
          {#if availableBranches.length > 0 || remoteBranches.length > 0}
            {@const localMatches = availableBranches.filter(b => matchesSearch(b, branchSearch))}
            {@const remoteMatches = remoteBranches.filter(b => matchesSearch(b, branchSearch))}
            <div class="branch-list-wrap">
              <div class="branch-search-row">
                <Icon name="search" size={13}/>
                <input
                  class="branch-search"
                  type="text"
                  bind:value={branchSearch}
                  placeholder={t('createInstance.filterBranches') as string}
                  autocomplete="off"
                />
                <button
                  class="branch-refresh"
                  type="button"
                  title={t('createInstance.refreshBranches') as string}
                  disabled={refreshingBranches}
                  on:click={loadBranchList}
                >
                  {#if refreshingBranches}
                    <Spinner size={12} trackColor="var(--stroke-1)" color="var(--accent)"/>
                  {:else}
                    <Icon name="refresh" size={13}/>
                  {/if}
                </button>
              </div>
              <div class="branch-list">
                {#if localMatches.length === 0 && remoteMatches.length === 0}
                  <div class="branch-empty">{(t('createInstance.noBranchesMatch') as (q: string) => string)(branchSearch)}</div>
                {/if}
                {#if localMatches.length > 0}
                  <div class="branch-group-label">{t('createInstance.localBranches')}</div>
                  {#each localMatches as b}
                    <button
                      class="branch-item {baseBranch === b ? 'active' : ''}"
                      on:click={() => baseBranch = b}
                    >
                      <Icon name="branch" size={13}/>
                      <span class="branch-name">{b}</span>
                      {#if baseBranch === b}<Icon name="check" size={12}/>{/if}
                    </button>
                  {/each}
                {/if}
                {#if remoteMatches.length > 0}
                  <div class="branch-group-label">{t('createInstance.remoteBranches')}</div>
                  {#each remoteMatches as b}
                    <button
                      class="branch-item {baseBranch === b ? 'active' : ''}"
                      on:click={() => baseBranch = b}
                    >
                      <Icon name="branch" size={13}/>
                      <span class="branch-name">{b}</span>
                      {#if baseBranch === b}<Icon name="check" size={12}/>{/if}
                    </button>
                  {/each}
                {/if}
              </div>
            </div>
          {:else}
            <input id="base-branch" type="text" bind:value={baseBranch} placeholder={t('createInstance.baseBranchPlaceholder') as string} />
          {/if}
        </div>
        <div class="form-row">
          <label for="branch-name">{t('createInstance.newBranchName')}</label>
          <input
            id="branch-name"
            type="text"
            bind:value={branchName}
            class:input-error={duplicateBranch}
          />
          {#if duplicateBranch}
            <div class="field-error">
              <Icon name="info" size={12}/>
              {(t('createInstance.duplicateBranch') as (name: string) => string)(branchName.trim())}
            </div>
          {/if}
        </div>
        <div class="info-box">
          <div class="info-icon"><Icon name="info" size={14}/></div>
          <div>
            <strong style="color: var(--fg-0)">git worktree</strong> {t('createInstance.worktreeInfoPrefix')}
            <span class="mono" style="color: var(--fg-0)">{worktreePath}</span>.
            {t('createInstance.worktreeInfoSuffix')}
          </div>
        </div>
      {/if}

      {#if error}
        <div class="error-box">{error}</div>
      {/if}

    </div>

    <div class="modal-foot">
      <div class="step-dots">
        {#each dots as d}
          <span class={d === step ? 'active' : (d < step ? 'done' : '')}></span>
        {/each}
      </div>
      <div class="spacer"></div>
      {#if step > 0}
        <button class="btn ghost" on:click={back} disabled={creating}>{t('common.back')}</button>
      {/if}
      {#if step < (useGit ? 2 : 1)}
        <button
          class="btn primary"
          disabled={!canNext}
          on:click={next}
          style={!canNext ? 'opacity: 0.4; cursor: not-allowed;' : ''}
        >
          {t('common.continue')} <Icon name="chev-r" size={14}/>
        </button>
      {:else}
        <button class="btn primary" on:click={handleCreate} disabled={creating}>
          {#if creating}
            <Spinner /> {t('common.creating')}
          {:else}
            <Icon name="sparkles" size={14}/> {t('createInstance.createInstance')}
          {/if}
        </button>
      {/if}
    </div>
  </div>
</div>

<style>
  .mode-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  .mode-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    padding: 16px;
    background: var(--bg-0);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-md);
    cursor: pointer;
    text-align: left;
    transition: border-color 0.15s, background 0.15s;
    color: var(--fg-1);
  }

  .mode-card:hover {
    border-color: var(--fg-3);
    background: var(--bg-2);
  }

  .mode-card.active {
    border-color: var(--accent);
    background: var(--accent-weak);
  }

  .mode-card.disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .mode-card.disabled:hover {
    border-color: var(--stroke-0);
    background: var(--bg-0);
  }

  .mode-icon {
    color: var(--fg-2);
    margin-bottom: 2px;
  }

  .mode-card.active .mode-icon { color: var(--accent); }

  .mode-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--fg-0);
  }

  .mode-desc {
    font-size: 11px;
    color: var(--fg-3);
    line-height: 1.5;
  }

  :global(input.input-error) {
    border-color: var(--danger, oklch(0.62 0.18 15)) !important;
    box-shadow: 0 0 0 3px var(--danger-weak, oklch(0.28 0.06 15));
  }

  .field-error {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
    font-size: 12px;
    color: var(--danger, oklch(0.75 0.18 15));
  }

  .info-box {
    padding: 12px 14px;
    background: var(--bg-0);
    border-radius: var(--r-md);
    border: 1px solid var(--stroke-0);
    font-size: 12px;
    color: var(--fg-2);
    line-height: 1.55;
    display: flex;
    gap: 10px;
  }

  .info-icon { color: var(--accent); margin-top: 2px; }

  .error-box {
    margin-top: 12px;
    padding: 10px 14px;
    background: var(--bg-0);
    border: 1px solid var(--red, #e55);
    border-radius: var(--r-md);
    font-size: 12px;
    color: var(--red, #e55);
    font-family: var(--font-mono);
  }

  .field-label {
    font-size: 11px;
    font-family: var(--font-mono);
    color: var(--fg-3);
    letter-spacing: 0.04em;
  }

  /* Branch list */
  .branch-list-wrap {
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-md);
    background: var(--bg-0);
    overflow: hidden;
  }

  .branch-search-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    border-bottom: 1px solid var(--stroke-0);
    color: var(--fg-3);
  }

  .branch-search {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    font-size: 12px;
    color: var(--fg-0);
    font-family: var(--font-ui);
  }
  .branch-search::placeholder { color: var(--fg-4); }

  .branch-refresh {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    background: none;
    border: none;
    border-radius: var(--r-sm);
    color: var(--fg-3);
    cursor: pointer;
    transition: background 0.1s, color 0.1s;
  }
  .branch-refresh:hover { background: var(--bg-3); color: var(--fg-0); }
  .branch-refresh:disabled { cursor: default; opacity: 0.6; }

  .branch-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 148px;
    overflow-y: auto;
    padding: 4px;
  }

  .branch-empty {
    padding: 10px;
    font-size: 12px;
    color: var(--fg-3);
    text-align: center;
  }

  .branch-group-label {
    padding: 6px 10px 2px;
    font-size: 10px;
    font-family: var(--font-mono);
    color: var(--fg-4);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .branch-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    border-radius: var(--r-sm);
    border: none;
    background: none;
    color: var(--fg-2);
    font-size: 12px;
    font-family: var(--font-mono);
    cursor: pointer;
    text-align: left;
    transition: background 0.1s, color 0.1s;
  }
  .branch-item:hover { background: var(--bg-3); color: var(--fg-0); }
  .branch-item.active { background: var(--accent-weak); color: var(--fg-0); }
  .branch-item.active :global(svg) { color: var(--accent); }
  .branch-name { flex: 1; }

  /* Loading overlay */
  :global(.modal-body.loading) { position: relative; }

  .creating-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    background: var(--bg-1);
    border-radius: var(--r-md);
    z-index: 10;
  }

  .creating-label {
    font-size: 13px;
    color: var(--fg-2);
  }

</style>
