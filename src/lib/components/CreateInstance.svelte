<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { activeProject } from '$lib/stores/project';
  import { spawnInstance } from '$lib/stores/instance';
  import { listBranches } from '$lib/services/instance-service';

  const dispatch = createEventDispatcher<{ close: void; create: { instanceId: string } }>();

  let step = 0;
  let ticketId = '';
  let ticketTitle = '';
  let branchName = '';
  let baseBranch = 'main';
  let profile = 'feature';
  let availableBranches: string[] = [];
  let creating = false;
  let error = '';

  const headers = [
    { step: 'Ticket', title: 'Describe the work' },
    { step: 'Branch', title: 'Shape the worktree' },
    { step: 'Agent', title: 'Brief the agent' },
  ];

  onMount(async () => {
    if ($activeProject) {
      try {
        availableBranches = await listBranches($activeProject.path);
        if (availableBranches.includes('main')) baseBranch = 'main';
        else if (availableBranches.includes('master')) baseBranch = 'master';
        else if (availableBranches.length > 0) baseBranch = availableBranches[0];
      } catch {
        availableBranches = [];
      }
    }
  });

  $: if (ticketId) {
    const slug = ticketId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!branchName || branchName === prevSlug) branchName = `feat/${slug}`;
    prevSlug = `feat/${slug}`;
  }
  let prevSlug = '';

  $: worktreePath = `~/.cairn/worktrees/${branchName.replace(/\//g, '-')}`;
  $: canNext = step === 0 ? (ticketId.trim().length > 0 && ticketTitle.trim().length > 0) : true;

  function next() { error = ''; step = Math.min(2, step + 1); }
  function back() { error = ''; step = Math.max(0, step - 1); }

  async function handleCreate() {
    if (!$activeProject) return;
    creating = true;
    error = '';
    try {
      const instance = await spawnInstance({
        id: crypto.randomUUID(),
        projectId: $activeProject.id,
        projectPath: $activeProject.path,
        ticket: { id: ticketId.trim(), title: ticketTitle.trim() },
        branch: branchName.trim(),
        baseBranch,
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
        <div class="step-count">Step {step + 1} of 3 — {headers[step].step}</div>
        <h3>{headers[step].title}</h3>
      </div>
      <button class="icon-btn close" on:click={() => dispatch('close')}><Icon name="x" size={16}/></button>
    </div>

    <div class="modal-body">
      {#if step === 0}
        <div class="form-row">
          <label for="ticket-id">Ticket ID</label>
          <input id="ticket-id" type="text" bind:value={ticketId} placeholder="FEAT-42, BUG-118, …" />
        </div>
        <div class="form-row">
          <label for="ticket-title">Title</label>
          <input id="ticket-title" type="text" bind:value={ticketTitle} placeholder="Short description of the work" />
        </div>
      {/if}

      {#if step === 1}
        <div class="form-row">
          <label for="base-branch">Base branch</label>
          {#if availableBranches.length > 0}
            <select id="base-branch" bind:value={baseBranch}>
              {#each availableBranches as b}
                <option value={b}>{b}</option>
              {/each}
            </select>
          {:else}
            <input id="base-branch" type="text" bind:value={baseBranch} placeholder="main" />
          {/if}
        </div>
        <div class="form-row">
          <label for="branch-name">New branch name</label>
          <input id="branch-name" type="text" bind:value={branchName} />
        </div>
        <div style="padding: 12px 14px; background: var(--bg-0); border-radius: var(--r-md); border: 1px solid var(--stroke-0); font-size: 12px; color: var(--fg-2); line-height: 1.55; display: flex; gap: 10px;">
          <div style="color: var(--accent); margin-top: 2px;"><Icon name="info" size={14}/></div>
          <div>
            <strong style="color: var(--fg-0)">git worktree</strong> will create an isolated checkout at <span class="mono" style="color: var(--fg-0)">{worktreePath}</span>. Your main working tree stays untouched.
          </div>
        </div>
      {/if}

      {#if step === 2}
        <div class="form-row">
          <label for="profile-btn-feature">Agent profile</label>
          <div class="source-tabs" style="margin: 0;">
            {#each [['feature','Feature'],['refactor','Refactor'],['debug','Debug'],['docs','Documentation'],['review','Review']] as [k, l]}
              <button id={k === 'feature' ? 'profile-btn-feature' : undefined} class={profile === k ? 'active' : ''} on:click={() => profile = k}>{l}</button>
            {/each}
          </div>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 8px;">
          <div class="summary-card">
            <div class="sum-row"><span class="label">Ticket</span><span class="val">{ticketId}</span></div>
            <div class="sum-row"><span class="label">Branch</span><span class="val">{branchName}</span></div>
            <div class="sum-row"><span class="label">Base</span><span class="val">{baseBranch}</span></div>
            <div class="sum-row"><span class="label">Profile</span><span class="val">{profile}</span></div>
          </div>
          <div class="summary-card">
            <div class="sum-row" style="color: var(--fg-2); font-size: 11px;">
              <Icon name="sparkles" size={13} style="color: var(--accent)"/>
              <span>Cairn will create the branch, check out a worktree, and start the agent with ticket context.</span>
            </div>
          </div>
        </div>
        {#if error}
          <div style="margin-top: 12px; padding: 10px 14px; background: var(--bg-0); border: 1px solid var(--red, #e55); border-radius: var(--r-md); font-size: 12px; color: var(--red, #e55); font-family: var(--font-mono);">
            {error}
          </div>
        {/if}
      {/if}
    </div>

    <div class="modal-foot">
      <div class="step-dots">
        {#each [0, 1, 2] as i}
          <span class={i === step ? 'active' : (i < step ? 'done' : '')}></span>
        {/each}
      </div>
      <div class="spacer"></div>
      {#if step > 0}
        <button class="btn ghost" on:click={back} disabled={creating}>Back</button>
      {/if}
      {#if step < 2}
        <button
          class="btn primary"
          disabled={!canNext}
          on:click={next}
          style={!canNext ? 'opacity: 0.4; cursor: not-allowed;' : ''}
        >
          Continue <Icon name="chev-r" size={14}/>
        </button>
      {/if}
      {#if step === 2}
        <button class="btn primary" on:click={handleCreate} disabled={creating}>
          {#if creating}
            <Icon name="spinner" size={14}/> Creating…
          {:else}
            <Icon name="sparkles" size={14}/> Create instance
          {/if}
        </button>
      {/if}
    </div>
  </div>
</div>
