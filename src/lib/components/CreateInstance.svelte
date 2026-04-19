<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';

  const dispatch = createEventDispatcher<{ close: void; create: void }>();

  let step = 0;
  let source = 'jira';
  let selectedTicket: { id: string; title: string; labels: string[] } | null = null;
  let branchName = 'feat/totp-auth';
  let profile = 'feature';
  let envProfile = 'dev';

  const tickets = [
    { id: 'FEAT-42', title: 'Add TOTP authentication', labels: ['auth', 'security'] },
    { id: 'FEAT-43', title: 'Wire up OAuth provider switcher UI', labels: ['frontend'] },
    { id: 'BUG-118', title: 'Dropdown closes on scroll inside dialog', labels: ['bug'] },
    { id: 'BUG-121', title: 'Invoice PDF missing footer on long orders', labels: ['billing'] },
    { id: 'CHORE-08', title: 'Upgrade React to 18.3', labels: ['deps'] },
    { id: 'FEAT-47', title: 'Dark mode for onboarding flow', labels: ['ui'] },
  ];

  const headers = [
    { step: 'Source', title: 'Pick the work' },
    { step: 'Branch', title: 'Shape the worktree' },
    { step: 'Agent', title: 'Brief the agent' },
  ];

  const sources = [
    ['jira', 'Jira'], ['github', 'GitHub'], ['gitlab', 'GitLab'], ['linear', 'Linear'], ['internal', 'Internal'],
  ] as const;

  $: canNext = step === 0 ? !!selectedTicket : true;

  function next() { step = Math.min(2, step + 1); }
  function back() { step = Math.max(0, step - 1); }

  function selectTicket(t: typeof tickets[0]) {
    selectedTicket = t;
    if (t.id === 'FEAT-42') branchName = 'feat/totp-auth';
  }

  $: worktreePath = `~/.cairn/worktrees/${branchName.replace(/\//g, '-')}`;
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
        <div class="source-tabs">
          {#each sources as [k, label]}
            <button class={source === k ? 'active' : ''} on:click={() => source = k}>
              <Icon name="ticket" size={12}/> {label}
            </button>
          {/each}
        </div>
        <div class="ticket-search">
          <Icon name="search" size={14}/>
          <input placeholder="Search assigned tickets..." />
          <span class="dim mono" style="font-size: 10px;">⌘K</span>
        </div>
        <div class="ticket-pick-list">
          {#each tickets as t}
            <div
              class="ticket-pick-row {selectedTicket?.id === t.id ? 'selected' : ''}"
              on:click={() => selectTicket(t)}
              role="button"
              tabindex="0"
              on:keydown={(e) => e.key === 'Enter' && selectTicket(t)}
            >
              <span class="tid">{t.id}</span>
              <span class="tn">{t.title}</span>
              <div class="labels">
                {#each t.labels as l}
                  <span class="label">{l}</span>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      {/if}

      {#if step === 1}
        <div class="form-row">
          <label>Base branch</label>
          <input type="text" value="main" readonly style="color: var(--fg-2)"/>
        </div>
        <div class="form-row">
          <label>New branch name</label>
          <input type="text" bind:value={branchName}/>
        </div>
        <div class="form-row">
          <label>Environment profile</label>
          <div class="source-tabs" style="margin: 0;">
            {#each [['dev','Development'],['staging','Staging'],['prod','Production (read-only)']] as [k, l]}
              <button class={envProfile === k ? 'active' : ''} on:click={() => envProfile = k}>{l}</button>
            {/each}
          </div>
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
          <label>Agent profile</label>
          <div class="source-tabs" style="margin: 0;">
            {#each [['feature','Feature'],['refactor','Refactor'],['debug','Debug'],['docs','Documentation'],['review','Review']] as [k, l]}
              <button class={profile === k ? 'active' : ''} on:click={() => profile = k}>{l}</button>
            {/each}
          </div>
        </div>
        <div class="form-row">
          <label>Ticket context (auto-injected)</label>
          <div style="padding: 12px 14px; background: var(--bg-0); border-radius: var(--r-md); border: 1px solid var(--stroke-0); font-size: 12.5px; color: var(--fg-1); line-height: 1.6; font-family: var(--font-mono);">
            <div style="color: var(--accent); margin-bottom: 6px;">{selectedTicket?.id || 'FEAT-42'} — {selectedTicket?.title || 'Add TOTP authentication'}</div>
            <div style="color: var(--fg-2);">
              Implement time-based one-time password as a second factor. Users opt in from Settings → Security. Use otplib, store the secret encrypted, expose /auth/totp/enable and /auth/totp/verify endpoints.
            </div>
          </div>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
          <div class="summary-card">
            <div class="sum-row"><span class="label">Ticket</span><span class="val">{selectedTicket?.id || 'FEAT-42'}</span></div>
            <div class="sum-row"><span class="label">Branch</span><span class="val">{branchName}</span></div>
            <div class="sum-row"><span class="label">Env</span><span class="val">{envProfile}</span></div>
            <div class="sum-row"><span class="label">Profile</span><span class="val">{profile}</span></div>
          </div>
          <div class="summary-card">
            <div class="sum-row" style="color: var(--fg-2); font-size: 11px;">
              <Icon name="sparkles" size={13} style="color: var(--accent)"/>
              <span>When you click <b style="color: var(--fg-0)">Create instance</b>, Cairn will create the worktree, load env, and start the agent session with the ticket context.</span>
            </div>
          </div>
        </div>
      {/if}
    </div>

    <div class="modal-foot">
      <div class="step-dots">
        {#each [0, 1, 2] as i}
          <span class={i === step ? 'active' : (i < step ? 'done' : '')}/>
        {/each}
      </div>
      <div class="spacer"/>
      {#if step > 0}
        <button class="btn ghost" on:click={back}>Back</button>
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
        <button class="btn primary" on:click={() => dispatch('create')}>
          <Icon name="sparkles" size={14}/> Create instance
        </button>
      {/if}
    </div>
  </div>
</div>
