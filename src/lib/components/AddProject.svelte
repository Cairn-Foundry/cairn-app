<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { validateDirectory, cloneRepository } from '$lib/services/project-service';
  import { projects, registerProject } from '$lib/stores/project';
  import type { Project } from '$lib/types/project';

  export let mode: 'new' | 'open' | 'clone';

  const dispatch = createEventDispatcher<{
    close: void;
    created: { id: string };
  }>();

  // Step layout per mode:
  //   new:   [identity] → [location]          (2 steps)
  //   open:  [location] → [identity]          (2 steps)
  //   clone: [source]   → [identity] → [dest] (3 steps)

  const stepLabels: Record<typeof mode, string[]> = {
    new:   ['Identity',  'Location'],
    open:  ['Location',  'Identity'],
    clone: ['Source',    'Identity', 'Destination'],
  };

  const modalTitles: Record<typeof mode, string[]> = {
    new:   ['Name your project',    'Choose a folder'],
    open:  ['Choose a folder',      'Name your project'],
    clone: ['Repository source',    'Name your project', 'Choose destination'],
  };

  const modeLabel: Record<typeof mode, string> = {
    new:   'New project',
    open:  'Open project',
    clone: 'Clone from remote',
  };

  let step = 0;
  $: totalSteps = stepLabels[mode].length;
  $: isLastStep = step === totalSteps - 1;

  let loading = false;
  let error = '';

  // ── Fields ────────────────────────────────────────────────────────────────
  let name = '';
  let path = '';
  let color = '#6366f1';
  let cloneUrl = '';
  let cloneMethod: 'https' | 'ssh' = 'https';

  const presetColors = [
    '#6366f1', '#8b5cf6', '#ec4899', '#ef4444',
    '#f97316', '#eab308', '#22c55e', '#06b6d4',
  ];

  // ── Directory picker ───────────────────────────────────────────────────────
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

  // For "open", fire the picker immediately so opening the modal feels instant
  onMount(() => {
    if (mode === 'open') pickDirectory();
  });

  // Auto-fill name from clone URL on blur
  function inferNameFromUrl() {
    if (name || !cloneUrl.trim()) return;
    const slug = cloneUrl.trim().split('/').at(-1)?.replace(/\.git$/, '') ?? '';
    if (slug) name = slug;
  }

  // ── canNext ────────────────────────────────────────────────────────────────
  $: canNext = (() => {
    if (mode === 'new')   { if (step === 0) return name.trim().length > 0; return path.length > 0; }
    if (mode === 'open')  { if (step === 0) return path.length > 0;        return name.trim().length > 0; }
    if (mode === 'clone') {
      if (step === 0) return cloneUrl.trim().length > 0;
      if (step === 1) return name.trim().length > 0;
      return path.length > 0;
    }
    return false;
  })();

  function next()  { if (canNext && !loading) step = Math.min(totalSteps - 1, step + 1); }
  function back()  { if (!loading) { error = ''; step = Math.max(0, step - 1); } }
  function close() { if (!loading) dispatch('close'); }

  async function submit() {
    if (!canNext || loading) return;
    loading = true;
    error = '';
    try {
      let resolvedPath: string;

      if (mode === 'clone') {
        resolvedPath = await cloneRepository(cloneUrl.trim(), path, name.trim());
      } else {
        resolvedPath = await validateDirectory(path);
      }

      // Duplicate-path guard — surface a friendly message rather than a silent skip
      const duplicate = $projects.find(p => p.path === resolvedPath);
      if (duplicate) {
        error = `"${duplicate.name}" already uses this folder. Open it from the projects list.`;
        return;
      }

      const id = crypto.randomUUID();
      const project: Project = { id, name: name.trim(), path: resolvedPath, color, activeInstanceId: null };
      await registerProject(project);
      dispatch('created', { id });
    } catch (err) {
      error = String(err);
    } finally {
      loading = false;
    }
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && !loading) close();
    if (e.key === 'Enter' && canNext && !loading) { if (isLastStep) submit(); else next(); }
  }
</script>

<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<div
  class="modal-backdrop"
  role="dialog"
  aria-modal="true"
  tabindex="-1"
  on:click={() => { if (!loading) close(); }}
  on:keydown={handleKey}
>
  <div class="modal ap-modal" on:click|stopPropagation role="presentation">

    <!-- ── Head ── -->
    <div class="modal-head">
      <div>
        <div class="step-count">
          {modeLabel[mode]} · Step {step + 1} of {totalSteps} — {stepLabels[mode][step]}
        </div>
        <h3>{modalTitles[mode][step]}</h3>
      </div>
      <button class="icon-btn close" on:click={close} aria-label="Close">
        <Icon name="x" size={16}/>
      </button>
    </div>

    <!-- ── Body ── -->
    <div class="modal-body">

      <!-- ══ NEW — step 0: identity ══ -->
      {#if mode === 'new' && step === 0}

        <div class="form-section">
          <label class="ap-label" for="new-name">
            Project name <span class="req">*</span>
          </label>
          <input
            id="new-name"
            class="ap-input"
            bind:value={name}
            placeholder="My awesome project"
            autocomplete="off"
          />
        </div>

        <div class="form-section">
          <div class="ap-label">Color</div>
          <div class="color-row">
            {#each presetColors as c}
              <button
                class="color-swatch {color === c ? 'selected' : ''}"
                style="background:{c}"
                on:click={() => color = c}
                aria-label="Color {c}"
              ></button>
            {/each}
            <label for="color-new" class="color-custom-wrap" title="Custom color">
              <input id="color-new" type="color" bind:value={color} class="color-custom-input"/>
              <span class="color-custom-preview" style="background:{color}"></span>
            </label>
          </div>
        </div>

        <div class="preview-pill" style="border-color:{color}33;background:{color}14;">
          <span class="preview-dot" style="background:{color}"></span>
          <span class="preview-label" style="color:{color}">{name || 'Project name'}</span>
        </div>

      <!-- ══ NEW — step 1: location ══ -->
      {:else if mode === 'new' && step === 1}

        <p class="ap-hint">Pick the folder where this project lives. Any directory works — git is not required.</p>
        <button class="dir-btn {path ? 'has-path' : ''}" on:click={pickDirectory}>
          <Icon name="folder" size={18}/>
          <span class="dir-label">
            {#if path}
              <span class="dir-main">Folder selected</span>
              <span class="dir-sub">{path}</span>
            {:else}
              <span class="dir-main">Browse…</span>
              <span class="dir-sub">Click to open the folder picker</span>
            {/if}
          </span>
          {#if path}<Icon name="check" size={14}/>{/if}
        </button>

      <!-- ══ OPEN — step 0: location ══ -->
      {:else if mode === 'open' && step === 0}

        <p class="ap-hint">Select any local folder to open as a Cairn project.</p>
        <button class="dir-btn {path ? 'has-path' : ''}" on:click={pickDirectory}>
          <Icon name="folder" size={18}/>
          <span class="dir-label">
            {#if path}
              <span class="dir-main">Folder selected</span>
              <span class="dir-sub">{path}</span>
            {:else}
              <span class="dir-main">Browse…</span>
              <span class="dir-sub">Click to open the folder picker</span>
            {/if}
          </span>
          {#if path}<Icon name="check" size={14}/>{/if}
        </button>

      <!-- ══ OPEN — step 1: identity ══ -->
      {:else if mode === 'open' && step === 1}

        <div class="form-section">
          <label class="ap-label" for="open-name">
            Project name <span class="req">*</span>
          </label>
          <input
            id="open-name"
            class="ap-input"
            bind:value={name}
            placeholder="My awesome project"
            autocomplete="off"
          />
        </div>

        <div class="form-section">
          <div class="ap-label">Color</div>
          <div class="color-row">
            {#each presetColors as c}
              <button
                class="color-swatch {color === c ? 'selected' : ''}"
                style="background:{c}"
                on:click={() => color = c}
                aria-label="Color {c}"
              ></button>
            {/each}
            <label for="color-open" class="color-custom-wrap" title="Custom color">
              <input id="color-open" type="color" bind:value={color} class="color-custom-input"/>
              <span class="color-custom-preview" style="background:{color}"></span>
            </label>
          </div>
        </div>

        <div class="preview-pill" style="border-color:{color}33;background:{color}14;">
          <span class="preview-dot" style="background:{color}"></span>
          <span class="preview-label" style="color:{color}">{name || 'Project name'}</span>
        </div>

      <!-- ══ CLONE — step 0: source ══ -->
      {:else if mode === 'clone' && step === 0}

        <div class="form-section">
          <label class="ap-label" for="clone-url">
            Repository URL <span class="req">*</span>
          </label>
          <input
            id="clone-url"
            class="ap-input mono"
            bind:value={cloneUrl}
            on:blur={inferNameFromUrl}
            placeholder="https://github.com/user/repo.git"
            autocomplete="off"
          />
        </div>

        <div class="form-section">
          <div class="ap-label">Protocol</div>
          <div class="method-row">
            <button
              class="method-btn {cloneMethod === 'https' ? 'active' : ''}"
              on:click={() => cloneMethod = 'https'}
            >
              <Icon name="lock" size={14}/> HTTPS
            </button>
            <button
              class="method-btn {cloneMethod === 'ssh' ? 'active' : ''}"
              on:click={() => cloneMethod = 'ssh'}
            >
              <Icon name="key" size={14}/> SSH
            </button>
          </div>
          <p class="method-hint">
            {#if cloneMethod === 'https'}
              Clones over HTTPS. You may be prompted for credentials.
            {:else}
              Clones over SSH. Requires an SSH key configured for the remote host.
            {/if}
          </p>
        </div>

      <!-- ══ CLONE — step 1: identity ══ -->
      {:else if mode === 'clone' && step === 1}

        <div class="form-section">
          <label class="ap-label" for="clone-name">
            Project name <span class="req">*</span>
          </label>
          <input
            id="clone-name"
            class="ap-input"
            bind:value={name}
            placeholder="repo-name"
            autocomplete="off"
          />
        </div>

        <div class="form-section">
          <div class="ap-label">Color</div>
          <div class="color-row">
            {#each presetColors as c}
              <button
                class="color-swatch {color === c ? 'selected' : ''}"
                style="background:{c}"
                on:click={() => color = c}
                aria-label="Color {c}"
              ></button>
            {/each}
            <label for="color-clone" class="color-custom-wrap" title="Custom color">
              <input id="color-clone" type="color" bind:value={color} class="color-custom-input"/>
              <span class="color-custom-preview" style="background:{color}"></span>
            </label>
          </div>
        </div>

        <div class="preview-pill" style="border-color:{color}33;background:{color}14;">
          <span class="preview-dot" style="background:{color}"></span>
          <span class="preview-label" style="color:{color}">{name || 'Project name'}</span>
        </div>

      <!-- ══ CLONE — step 2: destination ══ -->
      {:else if mode === 'clone' && step === 2}

        <p class="ap-hint">Choose the parent folder where the repository will be cloned.</p>
        <button class="dir-btn {path ? 'has-path' : ''}" on:click={pickDirectory}>
          <Icon name="folder" size={18}/>
          <span class="dir-label">
            {#if path}
              <span class="dir-main">Destination selected</span>
              <span class="dir-sub">{path}/{name}</span>
            {:else}
              <span class="dir-main">Browse…</span>
              <span class="dir-sub">Click to open the folder picker</span>
            {/if}
          </span>
          {#if path}<Icon name="check" size={14}/>{/if}
        </button>

      {/if}

      {#if error}
        <div class="ap-error" role="alert">
          <Icon name="info" size={14}/> {error}
        </div>
      {/if}

    </div>

    <!-- ── Foot ── -->
    <div class="modal-foot">
      <div class="step-dots">
        {#each { length: totalSteps } as _, i}
          <span class="{i === step ? 'active' : i < step ? 'done' : ''}"></span>
        {/each}
      </div>
      <div class="spacer"></div>
      {#if step > 0}
        <button class="btn ghost" on:click={back} disabled={loading}>Back</button>
      {/if}
      {#if !isLastStep}
        <button class="btn primary" disabled={!canNext || loading} on:click={next}>
          Continue <Icon name="chev-r" size={14}/>
        </button>
      {:else}
        <button class="btn primary" disabled={!canNext || loading} on:click={submit}>
          {#if loading}
            <span class="ap-spinner"></span>
            {#if mode === 'clone'}Cloning…{:else}Creating…{/if}
          {:else if mode === 'clone'}
            <Icon name="download" size={14}/> Clone &amp; open
          {:else}
            <Icon name="sparkles" size={14}/> Add project
          {/if}
        </button>
      {/if}
    </div>

  </div>
</div>

<style>
  .ap-modal { width: min(520px, 92vw); }

  /* ── Labels & inputs ── */
  .ap-hint {
    font-size: 13px;
    color: var(--fg-3);
    margin: 0 0 20px;
    line-height: 1.55;
  }
  .form-section { margin-bottom: 22px; }
  .ap-label {
    display: block;
    font-size: 11px;
    font-weight: 700;
    color: var(--fg-3);
    letter-spacing: 0.07em;
    text-transform: uppercase;
    margin-bottom: 8px;
  }
  .req { color: var(--accent); }

  .ap-input {
    width: 100%;
    box-sizing: border-box;
    background: var(--bg-0);
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-sm);
    padding: 10px 12px;
    font-size: 14px;
    color: var(--fg-0);
    font-family: var(--font-ui);
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .ap-input:focus {
    border-color: var(--accent-line);
    box-shadow: 0 0 0 3px var(--accent-weak);
  }
  .ap-input::placeholder { color: var(--fg-4); opacity: 1; }
  .ap-input.mono { font-family: var(--font-mono); font-size: 13px; }

  /* ── Directory button ── */
  .dir-btn {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    box-sizing: border-box;
    padding: 16px 18px;
    background: var(--bg-0);
    border: 1.5px dashed var(--stroke-1);
    border-radius: var(--r-md);
    cursor: pointer;
    color: var(--fg-2);
    text-align: left;
    transition: border-color 0.15s, background 0.15s, color 0.15s;
  }
  .dir-btn:hover, .dir-btn:focus-visible {
    border-color: var(--accent-line);
    background: var(--accent-weak);
    color: var(--fg-0);
    outline: none;
  }
  .dir-btn.has-path {
    border-style: solid;
    border-color: var(--stroke-1);
    color: var(--fg-1);
  }
  .dir-label { flex: 1; min-width: 0; }
  .dir-main { display: block; font-size: 13px; font-weight: 500; }
  .dir-sub {
    display: block;
    font-size: 11px;
    font-family: var(--font-mono);
    color: var(--fg-3);
    margin-top: 3px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* ── Clone method ── */
  .method-row { display: flex; gap: 8px; margin-bottom: 10px; }
  .method-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 18px;
    border-radius: var(--r-sm);
    border: 1px solid var(--stroke-1);
    background: var(--bg-0);
    color: var(--fg-2);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.1s, border-color 0.1s, color 0.1s;
  }
  .method-btn:hover { background: var(--bg-3); color: var(--fg-0); }
  .method-btn.active { background: var(--accent-weak); border-color: var(--accent-line); color: var(--accent); }
  .method-hint { font-size: 12px; color: var(--fg-3); margin: 0; line-height: 1.5; }

  /* ── Color picker ── */
  .color-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

  .color-swatch {
    width: 28px; height: 28px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    transition: transform 0.1s, border-color 0.1s;
    flex-shrink: 0;
  }
  .color-swatch:hover { transform: scale(1.18); }
  .color-swatch.selected {
    border-color: var(--fg-0);
    box-shadow: 0 0 0 2px var(--bg-1);
  }

  .color-custom-wrap {
    position: relative;
    width: 28px; height: 28px;
    border-radius: 50%;
    overflow: hidden;
    cursor: pointer;
    flex-shrink: 0;
    border: 2px dashed var(--stroke-1);
  }
  .color-custom-input {
    position: absolute;
    inset: -4px;
    width: calc(100% + 8px);
    height: calc(100% + 8px);
    opacity: 0;
    cursor: pointer;
  }
  .color-custom-preview {
    display: block;
    width: 100%; height: 100%;
    border-radius: 50%;
  }

  /* ── Error banner ── */
  .ap-error {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin-top: 16px;
    padding: 10px 14px;
    background: var(--danger-weak, oklch(0.28 0.06 15));
    border: 1px solid var(--danger, oklch(0.62 0.18 15));
    border-radius: var(--r-md);
    font-size: 12px;
    color: var(--danger, oklch(0.75 0.18 15));
    line-height: 1.5;
  }

  /* ── Loading spinner ── */
  .ap-spinner {
    display: inline-block;
    width: 13px;
    height: 13px;
    border: 2px solid oklch(1 0 0 / 0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: ap-spin 0.6s linear infinite;
    flex-shrink: 0;
  }
  @keyframes ap-spin { to { transform: rotate(360deg); } }

  /* ── Preview pill ── */
  .preview-pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 14px 6px 8px;
    border-radius: 999px;
    border: 1px solid;
    margin-top: 4px;
    transition: background 0.2s, border-color 0.2s;
  }
  .preview-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
  .preview-label { font-size: 13px; font-weight: 500; }
</style>
