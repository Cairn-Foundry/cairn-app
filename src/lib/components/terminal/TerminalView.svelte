<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n';
  import { activeInstance } from '$lib/stores/instance';
  import { activeProject } from '$lib/stores/project';
  import { prepareInstanceEnv } from '$lib/stores/env';
  import { terminalActive } from '$lib/stores/ui';
  import {
    terminalSessions,
    projectTerminals,
    activeTerminalId,
    splitTerminalId,
    splitTerminalRatio,
    openSplitTerminal,
    closeSplitTerminal,
    setSplitRatio,
    DEFAULT_SPLIT_RATIO,
    addTerminal,
    addProjectTerminal,
    removeTerminal,
    removeProjectTerminal,
    setActiveTerminal,
    renameTerminal,
    renameProjectTerminal,
    reorderTerminal,
    reorderProjectTerminal,
    shareTerminal,
    unshareTerminal,
    restoreTerminals,
    restoreProjectTerminals,
    terminalScope,
  } from '$lib/stores/terminal';
  import type { TerminalSession } from '$lib/stores/terminal';
  import * as manager from '$lib/utils/terminal/terminal-manager';
  import { computeTabInsertIndex } from '$lib/utils/files/files-tab-drag';

  type Section = 'project' | 'instance';

  let slotEl = $state<HTMLDivElement>();
  let splitSlotEl = $state<HTMLDivElement>();
  let panesEl = $state<HTMLDivElement>();
  let focusedPane = $state<0 | 1>(0);
  let editingId = $state<string | null>(null);
  let editValue = $state('');
  let ctxMenu = $state<{ x: number; y: number; session: TerminalSession; section: Section } | null>(null);

  let projectBodyEl = $state<HTMLDivElement>();
  let instanceBodyEl = $state<HTMLDivElement>();
  let drag = $state<{ id: string; from: Section; index: number } | null>(null);
  let dropAt = $state<{ section: Section; index: number } | null>(null);
  let dragActive = $state(false);
  let didDrag = false;
  let dragStartX = 0;
  let dragStartY = 0;

  const DRAG_THRESHOLD = 6;

  let activeId = $derived($activeInstance?.id ?? null);
  let projectId = $derived($activeInstance?.projectId ?? null);
  let worktreePath = $derived($activeInstance?.worktreePath ?? null);
  let scopeKey = $derived(
    projectId && activeId ? terminalScope(projectId, activeId) : null,
  );
  let instanceSessions = $derived(
    scopeKey ? ($terminalSessions[scopeKey] ?? []) : [],
  );

  let sessions = $derived(instanceSessions.filter((s) => !s.commandId));
  let commandSessions = $derived(instanceSessions.filter((s) => s.commandId));
  let shared = $derived(projectId ? ($projectTerminals[projectId] ?? []) : []);
  let allSessions = $derived([...shared, ...sessions, ...commandSessions]);
  let activeTid = $derived(
    scopeKey ? ($activeTerminalId[scopeKey] ?? allSessions[0]?.id ?? null) : null,
  );
  let rawSplitTid = $derived(scopeKey ? ($splitTerminalId[scopeKey] ?? null) : null);
  let splitTid = $derived(
    rawSplitTid && rawSplitTid !== activeTid && allSessions.some((s) => s.id === rawSplitTid)
      ? rawSplitTid
      : null,
  );
  let isSplit = $derived(splitTid !== null);
  let splitRatio = $derived(
    scopeKey ? ($splitTerminalRatio[scopeKey] ?? DEFAULT_SPLIT_RATIO) : DEFAULT_SPLIT_RATIO,
  );

  $effect(() => {
    if (!$terminalActive || !projectId || !activeId) return;
    const pid = projectId;
    const iid = activeId;
    const cwd = $activeInstance?.worktreePath ?? null;
    void prepareInstanceEnv($activeProject, $activeInstance).then(async (env) => {
      await restoreProjectTerminals(pid, env);
      await restoreTerminals(pid, iid, cwd, env);
    });
  });

  $effect(() => {
    if (!$terminalActive || !slotEl) return;
    if (activeTid) manager.attach(activeTid, slotEl);
    else slotEl.replaceChildren();
  });

  $effect(() => {
    if (!$terminalActive || !splitSlotEl) return;
    if (splitTid) manager.attach(splitTid, splitSlotEl);
    else splitSlotEl.replaceChildren();
  });

  $effect(() => {
    void splitRatio;
    void isSplit;
    requestAnimationFrame(() => {
      if (activeTid) manager.refit(activeTid);
      if (splitTid) manager.refit(splitTid);
    });
  });

  $effect(() => {
    if (!isSplit) focusedPane = 0;
  });

  function onResize() {
    if (activeTid) manager.refit(activeTid);
    if (splitTid) manager.refit(splitTid);
  }

  function sectionOf(id: string): Section {
    return shared.some((s) => s.id === id) ? 'project' : 'instance';
  }

  /**
   * The instance section only shows the shells, so its indices are not the ones
   * the store reorders. Translate them back to the stored list.
   */
  function storedIndex(filteredIndex: number): number {
    const target = sessions[filteredIndex];
    if (!target) return instanceSessions.length;
    return instanceSessions.findIndex((s) => s.id === target.id);
  }

  async function newTerminal() {
    if (!projectId || !activeId) return;
    const env = await prepareInstanceEnv($activeProject, $activeInstance);
    await addTerminal(projectId, activeId, worktreePath, env);
  }

  async function newProjectTerminal() {
    if (!projectId || !activeId) return;
    const env = await prepareInstanceEnv($activeProject, $activeInstance);
    await addProjectTerminal(projectId, activeId, worktreePath, env);
  }

  function selectTerminal(id: string) {
    if (!projectId || !activeId) return;
    if (isSplit && focusedPane === 1) {
      if (id === activeTid) { focusedPane = 0; return; }
      setActiveTerminal(projectId, activeId, id, 1);
      return;
    }
    if (id === splitTid) { focusedPane = 1; return; }
    setActiveTerminal(projectId, activeId, id, 0);
  }

  async function toggleSplit() {
    if (!projectId || !activeId) return;
    if (isSplit) {
      closeSplitTerminal(projectId, activeId);
      return;
    }
    const left = activeTid ?? (await createAndReturn());
    if (!left) return;
    const right = allSessions.find((s) => s.id !== left)?.id ?? (await createAndReturn());
    if (!right) return;
    setActiveTerminal(projectId, activeId, left, 0);
    openSplitTerminal(projectId, activeId, right);
    focusedPane = 1;
  }

  /** Spawns a shell and returns its id - addTerminal makes it the active one. */
  async function createAndReturn(): Promise<string | null> {
    await newTerminal();
    return activeTid;
  }

  function startSplitResize(e: PointerEvent) {
    if (!panesEl || !projectId || !activeId) return;
    e.preventDefault();
    const rect = panesEl.getBoundingClientRect();
    const pid = projectId;
    const iid = activeId;
    const onMove = (ev: PointerEvent) => {
      const ratio = (ev.clientX - rect.left) / rect.width;
      setSplitRatio(pid, iid, Math.max(0.15, Math.min(0.85, ratio)));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.classList.remove('dragging');
    };
    document.body.classList.add('dragging');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  async function doClose(id: string, section: Section) {
    if (!projectId || !activeId) return;
    if (section === 'project') await removeProjectTerminal(projectId, id);
    else await removeTerminal(projectId, activeId, id);
  }

  async function closeTerminal(id: string, section: Section, e: MouseEvent) {
    e.stopPropagation();
    await doClose(id, section);
  }

  function beginRename(s: TerminalSession) {
    editingId = s.id;
    editValue = s.title;
  }

  function startRename(s: TerminalSession, e: MouseEvent) {
    e.stopPropagation();
    beginRename(s);
  }

  function openCtxMenu(s: TerminalSession, section: Section, e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    ctxMenu = { x: e.clientX, y: e.clientY, session: s, section };
  }

  function closeCtxMenu() {
    ctxMenu = null;
  }

  async function closeOthers(s: TerminalSession) {
    closeCtxMenu();
    for (const other of allSessions.filter((o) => o.id !== s.id)) {
      await doClose(other.id, sectionOf(other.id));
    }
  }

  function toggleShared(s: TerminalSession, section: Section) {
    closeCtxMenu();
    if (!projectId || !activeId) return;
    if (section === 'instance') shareTerminal(projectId, activeId, s.id, worktreePath, shared.length);
    else unshareTerminal(projectId, activeId, s.id, sessions.length);
  }

  function commitRename() {
    if (!editingId) return;
    const title = editValue.trim();
    if (projectId && activeId && title) {
      if (sectionOf(editingId) === 'project') renameProjectTerminal(projectId, editingId, title);
      else renameTerminal(projectId, activeId, editingId, title);
    }
    editingId = null;
  }

  function onRenameKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      editingId = null;
    }
  }

  function autofocusSelect(node: HTMLInputElement) {
    node.focus();
    node.select();
  }

  function dragPointerDown(e: PointerEvent, section: Section, index: number, id: string) {
    if (editingId === id) return;
    if ((e.target as Element).closest('.term-item-close, .term-item-input')) return;
    e.preventDefault();
    drag = { id, from: section, index };
    dropAt = { section, index };
    dragActive = false;
    didDrag = false;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function sectionAt(y: number): Section | null {
    const bodies = [
      ['project', projectBodyEl],
      ['instance', instanceBodyEl],
    ] as const;
    for (const [section, el] of bodies) {
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (y >= r.top && y <= r.bottom) return section;
    }
    return null;
  }

  function dragPointerMove(e: PointerEvent) {
    if (!drag) return;
    if (!dragActive) {
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
      dragActive = true;
      document.body.classList.add('dragging');
    }
    didDrag = true;
    const section = sectionAt(e.clientY) ?? dropAt?.section ?? drag.from;
    const bodyEl = section === 'project' ? projectBodyEl : instanceBodyEl;
    dropAt = {
      section,
      index: computeTabInsertIndex(bodyEl ?? null, e.clientY, { selector: '.term-item', axis: 'y' }),
    };
  }

  function dragPointerUp() {
    if (drag && dropAt && dragActive && projectId && activeId) {
      const { id, from, index } = drag;
      if (from === dropAt.section) {
        if (from === 'project') reorderProjectTerminal(projectId, index, dropAt.index);
        else reorderTerminal(projectId, activeId, storedIndex(index), storedIndex(dropAt.index));
      } else if (from === 'instance') {
        shareTerminal(projectId, activeId, id, worktreePath, dropAt.index);
      } else {
        unshareTerminal(projectId, activeId, id, storedIndex(dropAt.index));
      }
    }
    drag = null;
    dropAt = null;
    dragActive = false;
    document.body.classList.remove('dragging');
  }

  function showsIndicator(section: Section, index: number): boolean {
    if (!dragActive || !drag || dropAt?.section !== section || dropAt.index !== index) return false;
    if (drag.from !== section) return true;
    return index !== drag.index && index !== drag.index + 1;
  }
</script>

<svelte:window onresize={onResize} />

<div class="terminal-split">
  <div class="term-list">
    <div class="term-section">
      <div class="term-list-head">
        <span>{t('terminal.projectSection')}</span>
        <button class="term-add" onclick={newProjectTerminal} disabled={!activeId} title={t('terminal.newShared') as string}>
          <Icon name="plus" size={13}/>
        </button>
      </div>
      <div class="term-list-body" bind:this={projectBodyEl}>
        {#each shared as s, i (s.id)}
          {#if showsIndicator('project', i)}<div class="term-drop"></div>{/if}
          <div
            class="term-item {s.id === activeTid || s.id === splitTid ? 'active' : ''} {dragActive && drag?.id === s.id ? 'dragging' : ''}"
            role="button"
            tabindex="0"
            onpointerdown={(e) => dragPointerDown(e, 'project', i, s.id)}
            onpointermove={dragPointerMove}
            onpointerup={dragPointerUp}
            onclick={() => { if (!didDrag) selectTerminal(s.id); didDrag = false; }}
            ondblclick={(e) => startRename(s, e)}
            oncontextmenu={(e) => openCtxMenu(s, 'project', e)}
            onkeydown={(e) => { if (e.key === 'Enter') selectTerminal(s.id); }}
          >
            <Icon name="terminal" size={13}/>
            {#if editingId === s.id}
              <input
                class="term-item-input"
                bind:value={editValue}
                use:autofocusSelect
                aria-label={t('terminal.rename') as string}
                onclick={(e) => e.stopPropagation()}
                onkeydown={onRenameKeydown}
                onblur={commitRename}
              />
            {:else}
              <span class="term-item-title" title={s.cwd ?? (t('terminal.renameHint') as string)}>{s.title}</span>
            {/if}
            <span
              class="term-item-close"
              role="button"
              tabindex="0"
              aria-label={t('terminal.close') as string}
              onclick={(e) => closeTerminal(s.id, 'project', e)}
              onkeydown={(e) => { if (e.key === 'Enter') closeTerminal(s.id, 'project', e as unknown as MouseEvent); }}
            >
              <Icon name="x" size={11}/>
            </span>
          </div>
        {/each}
        {#if showsIndicator('project', shared.length)}<div class="term-drop"></div>{/if}
        {#if shared.length === 0}
          <p class="term-section-empty">{t('terminal.sharedEmpty')}</p>
        {/if}
      </div>
    </div>

    <div class="term-section term-section-grow">
      <div class="term-list-head">
        <span>{t('terminal.instanceSection')}</span>
        <button class="term-add" onclick={newTerminal} disabled={!activeId} title={t('terminal.new') as string}>
          <Icon name="plus" size={13}/>
        </button>
      </div>
      <div class="term-list-body" bind:this={instanceBodyEl}>
        {#each sessions as s, i (s.id)}
          {#if showsIndicator('instance', i)}<div class="term-drop"></div>{/if}
          <div
            class="term-item {s.id === activeTid || s.id === splitTid ? 'active' : ''} {dragActive && drag?.id === s.id ? 'dragging' : ''}"
            role="button"
            tabindex="0"
            onpointerdown={(e) => dragPointerDown(e, 'instance', i, s.id)}
            onpointermove={dragPointerMove}
            onpointerup={dragPointerUp}
            onclick={() => { if (!didDrag) selectTerminal(s.id); didDrag = false; }}
            ondblclick={(e) => startRename(s, e)}
            oncontextmenu={(e) => openCtxMenu(s, 'instance', e)}
            onkeydown={(e) => { if (e.key === 'Enter') selectTerminal(s.id); }}
          >
            <Icon name="terminal" size={13}/>
            {#if editingId === s.id}
              <input
                class="term-item-input"
                bind:value={editValue}
                use:autofocusSelect
                aria-label={t('terminal.rename') as string}
                onclick={(e) => e.stopPropagation()}
                onkeydown={onRenameKeydown}
                onblur={commitRename}
              />
            {:else}
              <span
                class="term-item-title"
                title={t('terminal.renameHint') as string}
              >{s.title}</span>
            {/if}
            <span
              class="term-item-close"
              role="button"
              tabindex="0"
              aria-label={t('terminal.close') as string}
              onclick={(e) => closeTerminal(s.id, 'instance', e)}
              onkeydown={(e) => { if (e.key === 'Enter') closeTerminal(s.id, 'instance', e as unknown as MouseEvent); }}
            >
              <Icon name="x" size={11}/>
            </span>
          </div>
        {/each}
        {#if showsIndicator('instance', sessions.length)}<div class="term-drop"></div>{/if}
        {#if sessions.length === 0}
          <p class="term-section-empty">{t('terminal.instanceEmpty')}</p>
        {/if}
      </div>
    </div>

    <div class="term-section">
      <div class="term-list-head">
        <span>{t('terminal.commandsSection')}</span>
      </div>
      <div class="term-list-body">
        {#each commandSessions as s (s.id)}
          <div
            class="term-item {s.id === activeTid || s.id === splitTid ? 'active' : ''}"
            role="button"
            tabindex="0"
            onclick={() => selectTerminal(s.id)}
            onkeydown={(e) => { if (e.key === 'Enter') selectTerminal(s.id); }}
          >
            <Icon name={s.icon ?? 'command'} size={13}/>
            <span class="term-item-title" title={s.title}>{s.title}</span>
            <span
              class="term-item-close"
              role="button"
              tabindex="0"
              aria-label={t('terminal.close') as string}
              onclick={(e) => closeTerminal(s.id, 'instance', e)}
              onkeydown={(e) => { if (e.key === 'Enter') closeTerminal(s.id, 'instance', e as unknown as MouseEvent); }}
            >
              <Icon name="x" size={11}/>
            </span>
          </div>
        {/each}
        {#if commandSessions.length === 0}
          <p class="term-section-empty">{t('terminal.commandsEmpty')}</p>
        {/if}
      </div>
    </div>
  </div>

  <div class="term-main">
    <div class="term-toolbar">
      <button
        class="term-split-toggle"
        class:on={isSplit}
        onclick={toggleSplit}
        disabled={!activeId}
        title={(isSplit ? t('terminal.closeSplit') : t('terminal.split')) as string}
        aria-label={(isSplit ? t('terminal.closeSplit') : t('terminal.split')) as string}
      >
        <Icon name="columns" size={13}/>
      </button>
    </div>

    <div class="term-panes" bind:this={panesEl}>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="term-pane"
        class:focused={isSplit && focusedPane === 0}
        style={isSplit ? `flex: 0 0 ${splitRatio * 100}%` : ''}
        onpointerdown={() => { focusedPane = 0; }}
      >
        <div class="term-host-slot" bind:this={slotEl}></div>
      </div>

      {#if isSplit}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="term-split-handle" onpointerdown={startSplitResize}></div>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="term-pane"
          class:focused={focusedPane === 1}
          onpointerdown={() => { focusedPane = 1; }}
        >
          <div class="term-host-slot" bind:this={splitSlotEl}></div>
        </div>
      {/if}

    {#if allSessions.length === 0}
      <div class="term-empty">
        <div class="term-empty-icon"><Icon name="terminal" size={40}/></div>
        <p class="term-empty-text">
          {activeId ? t('terminal.emptyHint') : t('terminal.noInstance')}
        </p>
        {#if activeId}
          <button class="btn primary" onclick={newTerminal}>
            <Icon name="plus" size={14}/> {t('terminal.new')}
          </button>
        {/if}
      </div>
    {/if}
    </div>
  </div>
</div>

{#if ctxMenu}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="ctx-backdrop" onmousedown={closeCtxMenu} oncontextmenu={(e) => { e.preventDefault(); closeCtxMenu(); }}></div>
  <div class="ctx-menu" style="left: {ctxMenu.x}px; top: {ctxMenu.y}px">
    <button type="button" class="ctx-item" onclick={() => { const s = ctxMenu!.session; closeCtxMenu(); beginRename(s); }}>
      <Icon name="edit" size={13}/> {t('terminal.rename')}
    </button>
    <button type="button" class="ctx-item" onclick={() => toggleShared(ctxMenu!.session, ctxMenu!.section)}>
      <Icon name="folder" size={13}/>
      {ctxMenu.section === 'instance' ? t('terminal.share') : t('terminal.unshare')}
    </button>
    <div class="ctx-sep"></div>
    <button type="button" class="ctx-item" onclick={() => { closeCtxMenu(); newTerminal(); }}>
      <Icon name="plus" size={13}/> {t('terminal.new')}
    </button>
    <div class="ctx-sep"></div>
    <button type="button" class="ctx-item" onclick={() => { const { session, section } = ctxMenu!; closeCtxMenu(); doClose(session.id, section); }}>
      <Icon name="x" size={13}/> {t('terminal.close')}
    </button>
    {#if allSessions.length > 1}
      <button type="button" class="ctx-item" onclick={() => closeOthers(ctxMenu!.session)}>
        <Icon name="x" size={13}/> {t('terminal.closeOthers')}
      </button>
    {/if}
  </div>
{/if}

<style>
  .terminal-split {
    display: grid;
    grid-template-columns: 200px minmax(0, 1fr);
    flex: 1;
    min-height: 0;
  }

  .term-list {
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--stroke-0);
    background: var(--bg-1);
    min-height: 0;
  }

  .term-section {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .term-section-grow { flex: 1; }

  .term-list-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    border-bottom: 1px solid var(--stroke-0);
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--fg-3);
  }

  .term-add {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    padding: 0;
    background: transparent;
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-sm);
    color: var(--fg-2);
    cursor: pointer;
    transition: background 0.12s, color 0.12s, border-color 0.12s;
  }
  .term-add :global(svg) { display: block; }
  .term-add:hover:not(:disabled) {
    background: var(--accent-weak);
    border-color: var(--accent);
    color: var(--fg-0);
  }
  .term-add:disabled { opacity: 0.4; cursor: default; }

  .term-list-body {
    flex: 1;
    overflow-y: auto;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-height: 34px;
  }

  .term-section-empty {
    margin: 0;
    padding: 2px 8px;
    font-size: 11px;
    color: var(--fg-4);
    line-height: 1.4;
  }

  .term-drop {
    height: 2px;
    background: var(--accent, #6c8eff);
    border-radius: 1px;
    margin: 0 2px;
    pointer-events: none;
  }

  .term-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 8px;
    background: transparent;
    border: none;
    border-radius: var(--r-sm);
    color: var(--fg-2);
    font-size: 12px;
    cursor: pointer;
    text-align: left;
  }
  .term-item:hover { background: var(--bg-3); color: var(--fg-0); }
  .term-item.active { background: var(--accent-weak); color: var(--fg-0); }
  .term-item.dragging { opacity: 0.4; cursor: grabbing; }

  .term-item-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .term-item-input {
    flex: 1;
    min-width: 0;
    background: var(--bg-0);
    border: 1px solid var(--accent);
    border-radius: var(--r-xs);
    color: var(--fg-0);
    font-family: inherit;
    font-size: 12px;
    padding: 1px 4px;
    outline: none;
  }

  .term-item-close {
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border-radius: var(--r-xs);
    color: var(--fg-3);
    opacity: 0;
    transition: opacity 0.12s, background 0.12s, color 0.12s;
  }
  .term-item:hover .term-item-close { opacity: 1; }
  .term-item-close:hover { background: var(--bg-4); color: var(--fg-0); }

  .term-main {
    position: relative;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: var(--bg-0);
  }

  .term-toolbar {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--stroke-0);
  }

  .term-split-toggle {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    padding: 0;
    background: transparent;
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-sm);
    color: var(--fg-2);
    cursor: pointer;
    transition: background 0.12s, color 0.12s, border-color 0.12s;
  }
  .term-split-toggle :global(svg) { display: block; }
  .term-split-toggle:hover:not(:disabled) {
    background: var(--accent-weak);
    border-color: var(--accent);
    color: var(--fg-0);
  }
  .term-split-toggle.on {
    background: var(--accent-weak);
    border-color: var(--accent);
    color: var(--fg-0);
  }
  .term-split-toggle:disabled { opacity: 0.4; cursor: default; }

  .term-panes {
    position: relative;
    display: flex;
    flex: 1;
    min-height: 0;
    min-width: 0;
  }

  .term-pane {
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
  }
  .term-pane.focused { box-shadow: inset 0 1px 0 0 var(--accent); }

  .term-split-handle {
    flex: 0 0 4px;
    cursor: col-resize;
    background: var(--stroke-0);
    transition: background 0.12s;
  }
  .term-split-handle:hover { background: var(--accent); }

  .term-host-slot {
    position: absolute;
    inset: 0;
    padding: 8px 4px 8px 10px;
  }

  :global(.terminal-host) {
    width: 100%;
    height: 100%;
  }

  .term-empty {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    text-align: center;
    padding: 24px;
    background: var(--bg-0);
  }
  .term-empty-icon { color: var(--fg-4); opacity: 0.6; }
  .term-empty-text {
    font-size: 13px;
    color: var(--fg-3);
    margin: 0;
    max-width: 320px;
    line-height: 1.5;
  }

  /* Context menu */
  .ctx-backdrop {
    position: fixed;
    inset: 0;
    z-index: 9998;
  }
  .ctx-menu {
    position: fixed;
    z-index: 9999;
    background: var(--bg-2);
    border: 1px solid var(--stroke-1);
    border-radius: 6px;
    padding: 4px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    min-width: 148px;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .ctx-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 10px;
    border: none;
    background: none;
    border-radius: 4px;
    cursor: pointer;
    color: var(--fg-1);
    font-size: 12.5px;
    font-family: var(--font-ui);
    text-align: left;
    width: 100%;
  }
  .ctx-item:hover { background: var(--bg-4); color: var(--fg-0); }
  .ctx-sep { height: 1px; background: var(--stroke-0); margin: 3px 0; }
</style>
