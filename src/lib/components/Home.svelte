<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import CairnLogo from '$lib/components/layout/CairnLogo.svelte';
  import AddProject from '$lib/components/AddProject.svelte';
  import EditProject from '$lib/components/EditProject.svelte';
  import { draggableRegion } from '$lib/utils/window-drag.js';
  import { projects, unregisterProject, duplicateProjectInStore } from '$lib/stores/project';
  import { revealInFileManager } from '$lib/services/project-service';
  import { settings } from '$lib/stores/settings';
  import type { Project } from '$lib/types/project';
  import { shortcuts, SHORTCUT_DEFS, bindingToLabels, bindingKey } from '$lib/stores/shortcuts';
  import type { ShortcutId, ShortcutBinding } from '$lib/types/shortcuts';

  type HomeSection = 'projects' | 'checkpoints' | 'activity' | 'account' | 'settings';

  const dispatch = createEventDispatcher<{
    openProject: string;
    projectCreated: { id: string };
    sectionShown: void;
  }>();

  export let openSection: HomeSection | null = null;
  export let openSettingsTab: SettingsTab | null = null;

  let activeSection: HomeSection = 'projects';

  $: if (openSection !== null) {
    activeSection = openSection;
    if (openSettingsTab !== null) settingsTab = openSettingsTab;
    dispatch('sectionShown');
  }

  let addProjectMode: 'new' | 'open' | 'clone' | null = null;
  let search = '';

  $: filteredProjects = search.trim()
    ? $projects.filter(p =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.path.toLowerCase().includes(search.toLowerCase())
      )
    : $projects;

  // ── Project card menu ─────────────────────────────────────────────────────
  let menuProjectId: string | null = null;
  let editingProject: Project | null = null;
  let deletingProject: Project | null = null;

  // ── Settings tabs ─────────────────────────────────────────────────────────
  type SettingsTab = 'general' | 'appearance' | 'editor' | 'shortcuts';
  let settingsTab: SettingsTab = 'general';

  // ── Accent color helpers ───────────────────────────────────────────────────
  const ACCENT_PRESETS: { label: string; color: string }[] = [
    { label: 'Blue',   color: '#6c8eff' },
    { label: 'Purple', color: '#a855f7' },
    { label: 'Pink',   color: '#ec4899' },
    { label: 'Red',    color: '#ef4444' },
    { label: 'Orange', color: '#f97316' },
    { label: 'Yellow', color: '#eab308' },
    { label: 'Green',  color: '#22c55e' },
    { label: 'Teal',   color: '#14b8a6' },
    { label: 'Cyan',   color: '#06b6d4' },
  ];

  const FONT_OPTIONS: { label: string; stack: string; sample: string }[] = [
    { label: 'JetBrains Mono', stack: "'JetBrains Mono', ui-monospace, monospace", sample: 'Ag01' },
    { label: 'Fira Code',      stack: "'Fira Code', ui-monospace, monospace",      sample: 'Ag01' },
    { label: 'System Mono',    stack: 'ui-monospace, monospace',                   sample: 'Ag01' },
    { label: 'Menlo',          stack: "Menlo, ui-monospace, monospace",            sample: 'Ag01' },
    { label: 'Monaco',         stack: "Monaco, ui-monospace, monospace",           sample: 'Ag01' },
    { label: 'Consolas',       stack: "Consolas, ui-monospace, monospace",         sample: 'Ag01' },
    { label: 'Courier New',    stack: "'Courier New', monospace",                  sample: 'Ag01' },
  ];

  $: currentFont = $settings.fontFamily ?? FONT_OPTIONS[0].stack;

  $: accentIsPreset = ACCENT_PRESETS.some(p => p.color === ($settings.accentColor ?? '#6c8eff'));

  // ── Shortcut search ───────────────────────────────────────────────────────
  let shortcutSearch = '';

  $: filteredShortcutDefs = shortcutSearch.trim()
    ? SHORTCUT_DEFS.filter(d =>
        d.label.toLowerCase().includes(shortcutSearch.toLowerCase()) ||
        d.description.toLowerCase().includes(shortcutSearch.toLowerCase())
      )
    : SHORTCUT_DEFS;

  // ── Shortcut recording ────────────────────────────────────────────────────
  let recordingId: ShortcutId | null = null;

  const MODIFIER_KEYS = new Set(['Meta', 'Control', 'Shift', 'Alt', 'CapsLock', 'OS']);

  function startRecording(id: ShortcutId) { recordingId = id; }

  function handleRecordKeydown(e: KeyboardEvent) {
    if (!recordingId) return;
    if (MODIFIER_KEYS.has(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') { recordingId = null; return; }
    const isMac = navigator.platform.startsWith('Mac');
    const binding: ShortcutBinding = {
      key: e.key,
      mod: isMac ? e.metaKey : e.ctrlKey,
      shift: e.shiftKey,
      alt: e.altKey,
      ctrl: e.ctrlKey,
    };
    settings.save({ shortcuts: { ...$settings.shortcuts, [recordingId]: binding } });
    recordingId = null;
  }

  function resetBinding(id: ShortcutId) {
    const next = { ...$settings.shortcuts };
    delete next[id];
    settings.save({ shortcuts: next });
  }

  function resetAllBindings() { settings.save({ shortcuts: {} }); }

  function toggleShortcut(id: ShortcutId) {
    const disabled = $settings.disabledShortcuts ?? [];
    const next = disabled.includes(id)
      ? disabled.filter(d => d !== id)
      : [...disabled, id];
    settings.save({ disabledShortcuts: next });
  }

  $: conflictIds = (() => {
    const seen = new Map<string, ShortcutId[]>();
    for (const def of SHORTCUT_DEFS) {
      const k = bindingKey($shortcuts[def.id]);
      if (!seen.has(k)) seen.set(k, []);
      seen.get(k)!.push(def.id);
    }
    const result = new Set<ShortcutId>();
    for (const ids of seen.values()) {
      if (ids.length > 1) ids.forEach(id => result.add(id));
    }
    return result;
  })();

  function openMenu(e: MouseEvent, id: string) {
    e.stopPropagation();
    menuProjectId = menuProjectId === id ? null : id;
  }

  function closeMenu() { menuProjectId = null; }

  async function handleDuplicate(id: string) {
    closeMenu();
    await duplicateProjectInStore(id);
  }

  async function handleCopyPath(path: string) {
    closeMenu();
    await navigator.clipboard.writeText(path);
  }

  async function handleReveal(path: string) {
    closeMenu();
    await revealInFileManager(path);
  }

  async function handleDelete() {
    if (!deletingProject) return;
    await unregisterProject(deletingProject.id);
    deletingProject = null;
  }
</script>

<svelte:window on:keydown={handleRecordKeydown} />

<div class="home">
  <!-- Left sidebar — padding-top clears native macOS traffic lights -->
  <aside class="home-side" style="padding-top: 36px;" data-tauri-drag-region use:draggableRegion>
    <div class="home-logo">
      <CairnLogo size={26}/>
      <span class="name">Cairn</span>
    </div>

    <div class="section">Workspace</div>
    <button class="home-nav-item {activeSection === 'projects'    ? 'active' : ''}" on:click={() => activeSection = 'projects'}>
      <Icon name="folder" size={15}/> Projects
    </button>
    <button class="home-nav-item {activeSection === 'checkpoints' ? 'active' : ''}" on:click={() => activeSection = 'checkpoints'}>
      <Icon name="bookmark" size={15}/> Saved checkpoints
    </button>
    <button class="home-nav-item {activeSection === 'activity'    ? 'active' : ''}" on:click={() => activeSection = 'activity'}>
      <Icon name="clock" size={15}/> Activity
    </button>

    <div class="section">Account</div>
    <button class="home-nav-item {activeSection === 'account'     ? 'active' : ''}" on:click={() => activeSection = 'account'}>
      <Icon name="user" size={15}/> Benjamin
    </button>
    <button class="home-nav-item {activeSection === 'settings'    ? 'active' : ''}" on:click={() => activeSection = 'settings'}>
      <Icon name="settings" size={15}/> Settings
    </button>

    <div style="flex: 1"></div>
    <div style="padding: 0 8px; font-size: 11px; color: var(--fg-3); font-family: var(--font-mono);">
      v{__APP_VERSION__ ?? 'dev'}
    </div>
  </aside>

  <main class="home-main">

    <!-- ── PROJECTS ── -->
    {#if activeSection === 'projects'}
      <div class="home-hero">
        <h1>Good morning, Benjamin.<br/><em>Which cairn are you following today?</em></h1>
      </div>

      <div class="home-actions">
        <div class="home-action primary" role="button" tabindex="0"
             on:click={() => addProjectMode = 'new'}
             on:keydown={(e) => e.key === 'Enter' && (addProjectMode = 'new')}>
          <div class="aci"><Icon name="plus" size={22}/></div>
          <div class="at">New project</div>
          <div class="ad">Create a project from any local directory.</div>
        </div>
        <div class="home-action" role="button" tabindex="0"
             on:click={() => addProjectMode = 'open'}
             on:keydown={(e) => e.key === 'Enter' && (addProjectMode = 'open')}>
          <div class="aci"><Icon name="folder" size={22}/></div>
          <div class="at">Open project</div>
          <div class="ad">Import an existing local folder as a project.</div>
        </div>
        <div class="home-action" role="button" tabindex="0"
             on:click={() => addProjectMode = 'clone'}
             on:keydown={(e) => e.key === 'Enter' && (addProjectMode = 'clone')}>
          <div class="aci"><Icon name="download" size={22}/></div>
          <div class="at">Clone from remote</div>
          <div class="ad">GitHub, GitLab, or any Git URL.</div>
        </div>
      </div>

      <div class="home-section-title">
        <span class="section-label"><Icon name="folder" size={13}/> Projects <span class="count">— {$projects.length}</span></span>
        {#if $projects.length > 0}
          <div class="search-bar">
            <Icon name="search" size={13}/>
            <input
              class="search-input"
              bind:value={search}
              placeholder="Filter projects…"
              aria-label="Filter projects"
            />
            {#if search}
              <button class="search-clear" on:click={() => search = ''} aria-label="Clear search">
                <Icon name="x" size={11}/>
              </button>
            {/if}
          </div>
        {/if}
      </div>
      {#if $projects.length === 0}
        <div style="padding: 32px 0; color: var(--fg-3); font-size: 13px;">
          No projects yet — open a local folder or clone one to get started.
        </div>
      {:else if filteredProjects.length === 0}
        <div style="padding: 32px 0; color: var(--fg-3); font-size: 13px;">
          No projects match "<strong style="color: var(--fg-1)">{search}</strong>".
        </div>
      {:else}
        <!-- Click outside any open menu to close it -->
        {#if menuProjectId}
          <!-- svelte-ignore a11y-no-static-element-interactions -->
          <div class="menu-backdrop" on:click={closeMenu} on:keydown={() => {}}></div>
        {/if}

        <div class="projects-grid">
          {#each filteredProjects as p (p.id)}
            <div class="project-card" role="button" tabindex="0"
                 on:click={() => dispatch('openProject', p.id)}
                 on:keydown={(e) => e.key === 'Enter' && dispatch('openProject', p.id)}>

              <!-- Card content -->
              <div class="pname">
                <span class="swatch" style="background: {p.color}"></span>
                {p.name}
              </div>
              <div class="ppath">{p.path}</div>

              <!-- ⋯ menu button (visible on hover) -->
              <button
                class="card-more"
                aria-label="Project options"
                on:click={(e) => openMenu(e, p.id)}
              >
                <Icon name="more" size={15}/>
              </button>

              <!-- Dropdown -->
              {#if menuProjectId === p.id}
                <div class="card-menu" role="menu">
                  <button class="card-menu-item" role="menuitem"
                    on:click={(e) => { e.stopPropagation(); closeMenu(); editingProject = p; }}>
                    <Icon name="edit" size={13}/> Edit
                  </button>
                  <button class="card-menu-item" role="menuitem"
                    on:click={(e) => { e.stopPropagation(); handleDuplicate(p.id); }}>
                    <Icon name="copy" size={13}/> Duplicate
                  </button>
                  <button class="card-menu-item" role="menuitem"
                    on:click={(e) => { e.stopPropagation(); handleCopyPath(p.path); }}>
                    <Icon name="clipboard" size={13}/> Copy path
                  </button>
                  <button class="card-menu-item" role="menuitem"
                    on:click={(e) => { e.stopPropagation(); handleReveal(p.path); }}>
                    <Icon name="folder" size={13}/> Reveal in Finder
                  </button>
                  <div class="card-menu-sep"></div>
                  <button class="card-menu-item danger" role="menuitem"
                    on:click={(e) => { e.stopPropagation(); closeMenu(); deletingProject = p; }}>
                    <Icon name="trash" size={13}/> Delete
                  </button>
                </div>
              {/if}

            </div>
          {/each}
        </div>
      {/if}

    <!-- ── CHECKPOINTS ── -->
    {:else if activeSection === 'checkpoints'}
      <div class="home-hero" style="padding-bottom: 0">
        <h1 style="font-size: 22px">Saved checkpoints</h1>
        <div class="sub">Rewind any instance to a saved state.</div>
      </div>
      <div style="margin-top: 24px; color: var(--fg-3); font-size: 13px;">
        No checkpoints yet — they will appear here as instances run.
      </div>

    <!-- ── ACTIVITY ── -->
    {:else if activeSection === 'activity'}
      <div class="home-hero" style="padding-bottom: 0">
        <h1 style="font-size: 22px">Activity</h1>
        <div class="sub">Recent events across all instances.</div>
      </div>
      <div style="margin-top: 24px; color: var(--fg-3); font-size: 13px;">
        No activity yet — events will appear here as instances run.
      </div>

    <!-- ── ACCOUNT ── -->
    {:else if activeSection === 'account'}
      <div class="home-hero" style="padding-bottom: 0">
        <h1 style="font-size: 22px">Account</h1>
      </div>
      <div style="margin-top: 24px; display: flex; flex-direction: column; gap: 16px; max-width: 480px;">
        <div style="display: flex; align-items: center; gap: 16px; padding: 20px; background: var(--bg-2); border-radius: var(--r-lg); border: 1px solid var(--stroke-0);">
          <div style="width: 48px; height: 48px; border-radius: 50%; background: var(--accent-weak); border: 2px solid var(--accent-line); display: flex; align-items: center; justify-content: center; font-size: 20px; color: var(--accent);">B</div>
          <div>
            <div style="font-size: 15px; font-weight: 600; color: var(--fg-0);">Benjamin</div>
            <div style="font-size: 12px; color: var(--fg-3); margin-top: 2px;">benjamin_bonneton@icloud.com</div>
          </div>
        </div>
        <div style="padding: 14px 16px; background: var(--bg-2); border-radius: var(--r-md); border: 1px solid var(--stroke-0); font-size: 12px; color: var(--fg-3);">
          AI provider · <span style="color: var(--fg-1)">Claude Code CLI</span>
        </div>
      </div>

    <!-- ── SETTINGS ── -->
    {:else if activeSection === 'settings'}
      <div class="home-hero" style="padding-bottom: 0">
        <h1 style="font-size: 22px">Settings</h1>
      </div>

      <!-- Inner tab bar -->
      <div class="settings-tabs">
        <button class="settings-tab {settingsTab === 'general'    ? 'active' : ''}" on:click={() => { settingsTab = 'general';    recordingId = null; }}>General</button>
        <button class="settings-tab {settingsTab === 'appearance' ? 'active' : ''}" on:click={() => { settingsTab = 'appearance'; recordingId = null; }}>Appearance</button>
        <button class="settings-tab {settingsTab === 'editor'     ? 'active' : ''}" on:click={() => { settingsTab = 'editor';     recordingId = null; }}>Editor</button>
        <button class="settings-tab {settingsTab === 'shortcuts'  ? 'active' : ''}" on:click={() => { settingsTab = 'shortcuts';  recordingId = null; }}>Shortcuts</button>
      </div>

      <!-- ── General tab ── -->
      {#if settingsTab === 'general'}
        <div class="settings-group">
          <div class="settings-group-title">General</div>
          {#each [
            { label: 'AI provider',       value: 'Claude Code CLI',    desc: 'Agent Bridge driver' },
            { label: 'Default branch',    value: 'main',               desc: 'Base for new worktrees' },
            { label: 'Worktree location', value: '~/.cairn/worktrees', desc: 'Where git worktrees are created' },
            { label: 'Format on stage',   value: 'Prettier',           desc: 'Auto-format before staging' },
          ] as s}
            <div class="settings-row">
              <div class="settings-row-info">
                <span class="settings-row-label">{s.label}</span>
                <span class="settings-row-desc">{s.desc}</span>
              </div>
              <span class="settings-row-value">{s.value}</span>
            </div>
          {/each}
        </div>

      <!-- ── Appearance tab ── -->
      {:else if settingsTab === 'appearance'}
        <div class="settings-group">
          <div class="settings-group-title">Theme</div>
          <div class="theme-cards">
            {#each [['dark', 'Dark'], ['light', 'Light'], ['high-contrast', 'High contrast']] as [val, label]}
              <button
                class="theme-card {$settings.theme === val ? 'active' : ''}"
                on:click={() => settings.save({ theme: val as 'dark' | 'light' | 'high-contrast' })}
              >
                <div class="theme-preview theme-preview-{val}">
                  <div class="tp-bar"></div>
                  <div class="tp-content">
                    <div class="tp-line tp-line-wide"></div>
                    <div class="tp-line tp-line-med"></div>
                    <div class="tp-line tp-line-short"></div>
                  </div>
                </div>
                <span class="theme-card-label">{label}</span>
                {#if $settings.theme === val}
                  <span class="theme-card-check"><Icon name="check" size={11}/></span>
                {/if}
              </button>
            {/each}
          </div>
        </div>

        <div class="settings-group">
          <div class="settings-group-title">Accent color</div>
          <div class="accent-presets">
            {#each ACCENT_PRESETS as preset}
              <button
                class="accent-preset {($settings.accentColor ?? '#6c8eff') === preset.color && accentIsPreset ? 'active' : ''}"
                title={preset.label}
                style="background: {preset.color}"
                on:click={() => settings.save({ accentColor: preset.color })}
              ></button>
            {/each}
            <label
              class="accent-preset accent-preset-custom {!accentIsPreset ? 'active' : ''}"
              title="Custom color"
              style="background: {$settings.accentColor ?? '#6c8eff'}"
            >
              <input
                type="color"
                value={$settings.accentColor ?? '#6c8eff'}
                on:input={(e) => settings.save({ accentColor: (e.target as HTMLInputElement).value })}
              />
              {#if accentIsPreset}
                <span class="accent-custom-icon">+</span>
              {/if}
            </label>
          </div>
        </div>

        <div class="settings-group">
          <div class="settings-group-title">Font</div>
          <div class="font-cards">
            {#each FONT_OPTIONS as opt}
              <button
                class="font-card {currentFont === opt.stack ? 'active' : ''}"
                title={opt.label}
                on:click={() => settings.save({ fontFamily: opt.stack })}
              >
                <span class="font-card-preview" style="font-family: {opt.stack}">{opt.sample}</span>
                <span class="font-card-label">{opt.label}</span>
                {#if currentFont === opt.stack}
                  <span class="font-card-check"><Icon name="check" size={10}/></span>
                {/if}
              </button>
            {/each}
          </div>
        </div>

      <!-- ── Editor tab ── -->
      {:else if settingsTab === 'editor'}
        <div class="settings-group">
          <div class="settings-group-title">Layout</div>
          <div class="settings-row">
            <div class="settings-row-info">
              <span class="settings-row-label">File tree panel width</span>
              <span class="settings-row-desc">Width of the file explorer sidebar in the Files view.</span>
            </div>
            <div class="settings-row-control">
              <input
                class="settings-number-input"
                type="number"
                min="140"
                max="480"
                value={$settings.treePanelWidth}
                on:change={(e) => {
                  const v = parseInt((e.target as HTMLInputElement).value, 10);
                  if (!isNaN(v)) settings.save({ treePanelWidth: Math.max(140, Math.min(480, v)) });
                }}
              />
              <span class="settings-row-unit">px</span>
              <button class="settings-reset-btn" title="Reset to default (220 px)" on:click={() => settings.save({ treePanelWidth: 220 })}>
                <Icon name="undo" size={12}/>
              </button>
            </div>
          </div>
        </div>

        <div class="settings-group">
          <div class="settings-group-title">Code editor</div>
          <div class="settings-row">
            <div class="settings-row-info">
              <span class="settings-row-label">Font size</span>
              <span class="settings-row-desc">Base font size for the code editor.</span>
            </div>
            <div class="settings-row-control">
              <input
                class="settings-number-input"
                type="number"
                min="8"
                max="32"
                value={$settings.editorFontSize}
                on:change={(e) => {
                  const v = parseInt((e.target as HTMLInputElement).value, 10);
                  if (!isNaN(v)) settings.save({ editorFontSize: Math.max(8, Math.min(32, v)) });
                }}
              />
              <span class="settings-row-unit">px</span>
              <button class="settings-reset-btn" title="Reset to default (13 px)" on:click={() => settings.save({ editorFontSize: 13 })}>
                <Icon name="undo" size={12}/>
              </button>
            </div>
          </div>
          <div class="settings-row">
            <div class="settings-row-info">
              <span class="settings-row-label">Show minimap</span>
              <span class="settings-row-desc">Scrollbar overview panel on the right side of the code editor.</span>
            </div>
            <label class="settings-toggle" aria-label="Toggle minimap">
              <input
                type="checkbox"
                checked={$settings.showMinimap}
                on:change={(e) => settings.save({ showMinimap: (e.target as HTMLInputElement).checked })}
              />
              <span class="settings-toggle-track"><span class="settings-toggle-thumb"></span></span>
            </label>
          </div>
        </div>

      <!-- ── Shortcuts tab ── -->
      {:else}
        <div class="sc-toolbar">
          <div class="sc-search-bar">
            <Icon name="search" size={13}/>
            <input
              class="sc-search-input"
              bind:value={shortcutSearch}
              placeholder="Search shortcuts…"
              aria-label="Search shortcuts"
            />
            {#if shortcutSearch}
              <button class="search-clear" on:click={() => shortcutSearch = ''} aria-label="Clear search">
                <Icon name="x" size={11}/>
              </button>
            {/if}
          </div>
          {#if conflictIds.size > 0}
            <span class="sc-conflict-notice">
              <Icon name="alert" size={13}/> {conflictIds.size} conflicting binding{conflictIds.size > 1 ? 's' : ''}
            </span>
          {/if}
          <button class="btn ghost sc-reset-all" on:click={resetAllBindings}>
            <Icon name="undo" size={12}/> Reset all
          </button>
        </div>

        {#each ['files', 'editor'] as group}
          {@const label = group === 'files' ? 'Files' : 'Code Editor'}
          {@const defs = filteredShortcutDefs.filter(d => d.group === group)}
          {#if defs.length > 0}
            <div class="settings-group" style="margin-top: 20px; max-width: 640px;">
              <div class="settings-group-title">{label}</div>
              {#each defs as def}
                {@const binding = $shortcuts[def.id]}
                {@const isCustom = !!$settings.shortcuts?.[def.id]}
                {@const isConflict = conflictIds.has(def.id)}
                {@const isRecording = recordingId === def.id}
                {@const isDisabled = ($settings.disabledShortcuts ?? []).includes(def.id)}
                <!-- svelte-ignore a11y-no-static-element-interactions -->
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <div
                  class="sc-row"
                  class:sc-conflict={isConflict && !isDisabled}
                  class:sc-recording={isRecording}
                  class:sc-disabled={isDisabled}
                  on:click={() => { if (!isDisabled) startRecording(def.id); }}
                >
                  <!-- svelte-ignore a11y-click-events-have-key-events -->
                  <!-- svelte-ignore a11y-no-static-element-interactions -->
                  <div class="sc-toggle" on:click|stopPropagation>
                    <label class="settings-toggle" aria-label="Enable shortcut">
                      <input
                        type="checkbox"
                        checked={!isDisabled}
                        on:change={() => toggleShortcut(def.id)}
                      />
                      <span class="settings-toggle-track"><span class="settings-toggle-thumb"></span></span>
                    </label>
                  </div>

                  <div class="settings-row-info">
                    <span class="settings-row-label">
                      {def.label}
                      {#if isCustom && !isDisabled}<span class="sc-custom-dot" title="Customized"></span>{/if}
                    </span>
                    <span class="settings-row-desc">{def.description}</span>
                  </div>

                  <span class="sc-keys">
                    {#if isRecording}
                      <span class="sc-recording-hint">Press key combo…</span>
                    {:else if !isDisabled}
                      {#each bindingToLabels(binding) as kLabel, i}
                        {#if i > 0}<span class="sc-plus">+</span>{/if}
                        <kbd class="sc-kbd">{kLabel}</kbd>
                      {/each}
                      {#if isConflict}
                        <span class="sc-conflict-icon" title="Conflicts with another shortcut">
                          <Icon name="alert" size={12}/>
                        </span>
                      {/if}
                    {/if}
                  </span>

                  <button
                    class="settings-reset-btn"
                    title="Reset to default"
                    disabled={!isCustom || isDisabled}
                    on:click|stopPropagation={() => resetBinding(def.id)}
                    aria-label="Reset shortcut"
                  >
                    <Icon name="undo" size={12}/>
                  </button>
                </div>
              {/each}
            </div>
          {/if}
        {/each}
        {#if filteredShortcutDefs.length === 0}
          <div style="margin-top: 24px; color: var(--fg-3); font-size: 13px;">
            No shortcuts match "<strong style="color: var(--fg-1)">{shortcutSearch}</strong>".
          </div>
        {/if}
      {/if}
    {/if}

  </main>
</div>

{#if addProjectMode}
  <AddProject
    mode={addProjectMode}
    on:close={() => addProjectMode = null}
    on:created={(e) => { addProjectMode = null; dispatch('projectCreated', e.detail); }}
  />
{/if}

{#if editingProject}
  <EditProject
    project={editingProject}
    on:close={() => editingProject = null}
  />
{/if}

{#if deletingProject}
  <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
  <div
    class="modal-backdrop"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    on:click={() => deletingProject = null}
    on:keydown={(e) => e.key === 'Escape' && (deletingProject = null)}
  >
    <div class="modal del-modal" on:click|stopPropagation role="presentation">
      <div class="modal-head">
        <div>
          <div class="step-count">Confirm deletion</div>
          <h3>Remove "{deletingProject.name}"?</h3>
        </div>
        <button class="icon-btn close" on:click={() => deletingProject = null} aria-label="Close">
          <Icon name="x" size={16}/>
        </button>
      </div>
      <div class="modal-body">
        <p class="del-desc">
          This removes the project from Cairn and deletes all its instances and worktrees.
          <strong>Your files at <code>{deletingProject.path}</code> will not be touched.</strong>
        </p>
      </div>
      <div class="modal-foot">
        <div class="spacer"></div>
        <button class="btn ghost" on:click={() => deletingProject = null}>Cancel</button>
        <button class="btn danger" on:click={handleDelete}>
          <Icon name="trash" size={14}/> Delete project
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  /* ── Card menu ── */
  .menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
  }

  /* Card needs relative positioning for the absolute menu button + dropdown */
  :global(.project-card) {
    position: relative;
    overflow: visible !important;
  }

  .card-more {
    position: absolute;
    top: 10px;
    right: 10px;
    width: 26px;
    height: 26px;
    border-radius: var(--r-sm);
    background: none;
    border: none;
    cursor: pointer;
    color: var(--fg-3);
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.1s, background 0.1s, color 0.1s;
  }
  :global(.project-card:hover) .card-more,
  .card-more:focus-visible { opacity: 1; }
  .card-more:hover { background: var(--bg-4); color: var(--fg-0); }

  .card-menu {
    position: absolute;
    top: 36px;
    right: 10px;
    z-index: 100;
    background: var(--bg-3);
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-md);
    padding: 4px;
    min-width: 170px;
    box-shadow: 0 8px 24px oklch(0 0 0 / 0.4);
    animation: menu-pop 0.12s cubic-bezier(0.2, 1, 0.4, 1);
  }
  @keyframes menu-pop {
    from { opacity: 0; transform: scale(0.95) translateY(-4px); }
    to   { opacity: 1; transform: none; }
  }

  .card-menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 10px;
    border-radius: var(--r-sm);
    background: none;
    border: none;
    font-size: 13px;
    color: var(--fg-1);
    font-family: var(--font-ui);
    cursor: pointer;
    text-align: left;
    transition: background 0.08s, color 0.08s;
  }
  .card-menu-item:hover { background: var(--bg-4); color: var(--fg-0); }
  .card-menu-item.danger { color: var(--danger, oklch(0.75 0.18 15)); }
  .card-menu-item.danger:hover { background: var(--danger-weak, oklch(0.28 0.06 15)); }

  .card-menu-sep {
    height: 1px;
    background: var(--stroke-0);
    margin: 4px 0;
  }

  /* ── Delete modal ── */
  .del-modal { width: min(460px, 92vw); }
  .del-desc {
    font-size: 13px;
    color: var(--fg-2);
    line-height: 1.6;
    margin: 0;
  }
  .del-desc code {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-1);
    background: var(--bg-0);
    padding: 1px 5px;
    border-radius: 3px;
    word-break: break-all;
  }

  .section-label {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  /* ── Search bar ── */
  .search-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    background: var(--bg-0);
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-sm);
    color: var(--fg-3);
    transition: border-color 0.15s;
  }
  .search-bar:focus-within {
    border-color: var(--accent-line);
    color: var(--fg-1);
  }
  .search-input {
    background: transparent;
    border: none;
    outline: none;
    font-size: 12px;
    font-family: var(--font-ui);
    color: var(--fg-0);
    width: 160px;
  }
  .search-input::placeholder { color: var(--fg-4); }
  .search-clear {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    color: var(--fg-3);
    display: flex;
    align-items: center;
  }
  .search-clear:hover { color: var(--fg-0); }

  .home-nav-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 8px;
    background: none;
    border: none;
    border-radius: var(--r-sm);
    text-align: left;
    cursor: pointer;
    font-size: 13px;
    color: var(--fg-2);
    font-family: var(--font-ui);
  }
  .home-nav-item:hover { background: var(--bg-4); color: var(--fg-0); }
  .home-nav-item.active { background: var(--accent-weak); color: var(--fg-0); }

  /* ── Settings ──────────────────────────────────────────────────── */

  .settings-group {
    margin-top: 28px;
    max-width: 560px;
  }

  .settings-group-title {
    font-size: 10.5px;
    font-family: var(--font-mono);
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fg-3);
    margin-bottom: 10px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--stroke-0);
  }

  .settings-row {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 11px 14px;
    background: var(--bg-2);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-md);
    margin-bottom: 6px;
  }

  .settings-row-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .settings-row-label { font-size: 13px; color: var(--fg-0); }
  .settings-row-desc  { font-size: 11px; color: var(--fg-3); }
  .settings-row-value { font-family: var(--font-mono); font-size: 12px; color: var(--accent); white-space: nowrap; }

  .settings-row-control { display: flex; align-items: center; gap: 6px; }

  .settings-number-input {
    width: 64px;
    background: var(--bg-1);
    border: 1px solid var(--stroke-0);
    border-radius: 4px;
    color: var(--fg-0);
    font-size: 12px;
    font-family: var(--font-mono);
    padding: 4px 8px;
    outline: none;
    text-align: right;
  }
  .settings-number-input:focus { border-color: var(--accent); }
  .settings-number-input::-webkit-inner-spin-button,
  .settings-number-input::-webkit-outer-spin-button { -webkit-appearance: none; }

  .settings-row-unit { font-size: 11px; color: var(--fg-3); font-family: var(--font-mono); }

  .settings-reset-btn {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    background: none;
    border: 1px solid var(--stroke-0);
    border-radius: 4px;
    color: var(--fg-3);
    cursor: pointer;
    padding: 0;
    transition: color .12s, border-color .12s;
  }
  .settings-reset-btn:hover { color: var(--fg-0); border-color: var(--fg-2); }

  .settings-toggle { display: flex; align-items: center; cursor: pointer; flex-shrink: 0; }
  .settings-toggle input { position: absolute; opacity: 0; width: 0; height: 0; }
  .settings-toggle-track {
    position: relative;
    width: 32px;
    height: 18px;
    background: var(--bg-3);
    border: 1px solid var(--stroke-0);
    border-radius: 9px;
    transition: background .15s, border-color .15s;
  }
  .settings-toggle input:checked + .settings-toggle-track {
    background: var(--accent);
    border-color: var(--accent);
  }
  .settings-toggle-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 12px;
    height: 12px;
    background: var(--fg-3);
    border-radius: 50%;
    transition: transform .15s, background .15s;
  }
  .settings-toggle input:checked + .settings-toggle-track .settings-toggle-thumb {
    transform: translateX(14px);
    background: #fff;
  }

  /* ── Settings inner tabs ──────────────────────────────────────────────── */

  .settings-tabs {
    display: flex;
    gap: 2px;
    margin-top: 20px;
    padding: 3px;
    background: var(--bg-0);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-sm);
    width: fit-content;
  }

  .settings-tab {
    padding: 5px 14px;
    font-size: 12px;
    color: var(--fg-2);
    border-radius: 4px;
    transition: background .1s, color .1s;
    font-family: var(--font-ui);
  }
  .settings-tab:hover { color: var(--fg-0); }
  .settings-tab.active { background: var(--bg-3); color: var(--fg-0); }

  /* ── Shortcut editor ──────────────────────────────────────────────────── */

  .sc-toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 16px;
    max-width: 640px;
    flex-wrap: wrap;
  }

  .sc-search-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    background: var(--bg-0);
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-sm);
    color: var(--fg-3);
    transition: border-color 0.15s;
    flex: 1;
    min-width: 160px;
  }
  .sc-search-bar:focus-within {
    border-color: var(--accent-line);
    color: var(--fg-1);
  }
  .sc-search-input {
    background: transparent;
    border: none;
    outline: none;
    font-size: 12px;
    font-family: var(--font-ui);
    color: var(--fg-0);
    flex: 1;
    min-width: 0;
  }
  .sc-search-input::placeholder { color: var(--fg-4); }

  .sc-toggle { margin-right: 4px; }

  .sc-disabled { opacity: 0.45; cursor: default; }
  .sc-disabled:hover { background: var(--bg-2); border-color: var(--stroke-0); }

  .sc-conflict-notice {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 11.5px;
    color: var(--warning);
    flex: 1;
  }

  .sc-reset-all { margin-left: auto; font-size: 12px; }

  .sc-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    background: var(--bg-2);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-md);
    margin-bottom: 5px;
    cursor: pointer;
    transition: background .1s, border-color .1s;
    user-select: none;
  }
  .sc-row:hover { background: var(--bg-3); border-color: var(--stroke-1); }
  .sc-row.sc-recording {
    background: var(--accent-weak);
    border-color: var(--accent-line);
  }
  .sc-row.sc-conflict { border-color: oklch(0.80 0.14 75 / 0.5); }

  .sc-keys {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  .sc-plus {
    font-size: 10px;
    color: var(--fg-4);
    margin: 0 1px;
  }

  .sc-kbd {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 22px;
    height: 20px;
    padding: 0 6px;
    background: var(--bg-0);
    border: 1px solid var(--stroke-1);
    border-bottom-width: 2px;
    border-radius: var(--r-xs);
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--fg-1);
    line-height: 1;
  }

  .sc-recording-hint {
    font-size: 12px;
    color: var(--accent);
    font-style: italic;
    padding: 2px 8px;
    background: var(--accent-weak);
    border: 1px dashed var(--accent-line);
    border-radius: var(--r-xs);
  }

  .sc-conflict-icon {
    color: var(--warning);
    display: flex;
    align-items: center;
    margin-left: 4px;
  }

  .sc-custom-dot {
    display: inline-block;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--accent);
    margin-left: 5px;
    vertical-align: middle;
  }

  /* ── Appearance: theme cards ── */

  .theme-cards {
    display: flex;
    gap: 12px;
    margin-top: 4px;
  }
  .theme-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 10px;
    border-radius: var(--r-md);
    border: 2px solid var(--stroke-0);
    background: var(--bg-1);
    cursor: pointer;
    transition: border-color .12s, background .12s;
    position: relative;
    width: 110px;
  }
  .theme-card:hover { border-color: var(--stroke-2); background: var(--bg-2); }
  .theme-card.active { border-color: var(--accent); background: var(--bg-2); }

  .theme-preview {
    width: 88px;
    height: 58px;
    border-radius: 4px;
    overflow: hidden;
    border: 1px solid oklch(0 0 0 / 0.15);
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
  }
  .tp-bar { height: 12px; }
  .tp-content { flex: 1; padding: 6px 7px; display: flex; flex-direction: column; gap: 4px; }
  .tp-line { height: 4px; border-radius: 2px; }
  .tp-line-wide  { width: 80%; }
  .tp-line-med   { width: 55%; }
  .tp-line-short { width: 35%; }

  /* dark preview */
  .theme-preview-dark                 { background: oklch(0.16 0.008 70); }
  .theme-preview-dark .tp-bar         { background: oklch(0.185 0.008 70); }
  .theme-preview-dark .tp-line        { background: oklch(0.36 0.008 70); }
  .theme-preview-dark .tp-line-wide   { background: color-mix(in oklch, var(--accent) 55%, transparent); }

  /* light preview */
  .theme-preview-light                { background: oklch(0.97 0.006 80); }
  .theme-preview-light .tp-bar        { background: oklch(0.94 0.007 75); }
  .theme-preview-light .tp-line       { background: oklch(0.80 0.008 70); }
  .theme-preview-light .tp-line-wide  { background: color-mix(in oklch, var(--accent) 70%, transparent); }

  /* high-contrast preview */
  .theme-preview-high-contrast                { background: oklch(0.0 0 0); }
  .theme-preview-high-contrast .tp-bar        { background: oklch(0.08 0 0); }
  .theme-preview-high-contrast .tp-line       { background: oklch(0.40 0 0); }
  .theme-preview-high-contrast .tp-line-wide  { background: color-mix(in oklch, var(--accent) 80%, transparent); }

  .theme-card-label { font-size: 12px; color: var(--fg-1); }
  .theme-card.active .theme-card-label { color: var(--fg-0); }
  .theme-card-check {
    position: absolute;
    top: 6px; right: 6px;
    color: var(--accent);
    display: flex;
    align-items: center;
  }

  /* ── Appearance: font cards ── */

  .font-cards {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 4px;
  }

  .font-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 10px 12px;
    border-radius: var(--r-md);
    border: 2px solid var(--stroke-0);
    background: var(--bg-1);
    cursor: pointer;
    transition: border-color .12s, background .12s;
    position: relative;
    min-width: 88px;
  }
  .font-card:hover { border-color: var(--stroke-2); background: var(--bg-2); }
  .font-card.active { border-color: var(--accent); background: var(--bg-2); }

  .font-card-preview {
    font-size: 20px;
    line-height: 1;
    color: var(--fg-0);
    letter-spacing: -0.01em;
  }
  .font-card.active .font-card-preview { color: var(--accent); }

  .font-card-label {
    font-size: 10.5px;
    color: var(--fg-3);
    font-family: var(--font-ui);
    white-space: nowrap;
  }
  .font-card.active .font-card-label { color: var(--fg-1); }

  .font-card-check {
    position: absolute;
    top: 5px;
    right: 5px;
    color: var(--accent);
    display: flex;
    align-items: center;
  }

  /* ── Appearance: accent presets ── */

  .accent-presets {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 4px;
  }
  .accent-preset {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    transition: transform .1s, border-color .1s;
    flex-shrink: 0;
    position: relative;
  }
  .accent-preset:hover { transform: scale(1.15); }
  .accent-preset.active {
    border-color: var(--fg-0);
    transform: scale(1.1);
    box-shadow: 0 0 0 2px var(--bg-2);
  }

  .accent-preset-custom {
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  .accent-preset-custom input[type="color"] {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
    width: 100%;
    height: 100%;
    border: none;
    padding: 0;
  }
  .accent-custom-icon {
    font-size: 16px;
    color: oklch(1 0 0 / 0.7);
    line-height: 1;
    pointer-events: none;
    user-select: none;
  }
</style>
