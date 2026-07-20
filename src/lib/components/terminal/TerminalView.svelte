<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n';
  import { activeInstance } from '$lib/stores/instance';
  import { terminalActive } from '$lib/stores/ui';
  import {
    terminalSessions,
    activeTerminalId,
    addTerminal,
    removeTerminal,
    setActiveTerminal,
    renameTerminal,
    restoreTerminals,
    terminalScope,
  } from '$lib/stores/terminal';
  import type { TerminalSession } from '$lib/stores/terminal';
  import * as manager from '$lib/utils/terminal/terminal-manager';

  let slotEl = $state<HTMLDivElement>();
  let editingId = $state<string | null>(null);
  let editValue = $state('');
  let ctxMenu = $state<{ x: number; y: number; session: TerminalSession } | null>(null);

  let activeId = $derived($activeInstance?.id ?? null);
  let projectId = $derived($activeInstance?.projectId ?? null);
  let scopeKey = $derived(
    projectId && activeId ? terminalScope(projectId, activeId) : null,
  );
  let sessions = $derived(scopeKey ? ($terminalSessions[scopeKey] ?? []) : []);
  let activeTid = $derived(
    scopeKey ? ($activeTerminalId[scopeKey] ?? sessions[0]?.id ?? null) : null,
  );

  $effect(() => {
    if (!$terminalActive || !projectId || !activeId) return;
    void restoreTerminals(projectId, activeId, $activeInstance?.worktreePath ?? null);
  });

  $effect(() => {
    if (!$terminalActive || !slotEl) return;
    if (activeTid) manager.attach(activeTid, slotEl);
    else slotEl.replaceChildren();
  });

  function onResize() {
    if (activeTid) manager.refit(activeTid);
  }

  async function newTerminal() {
    if (!projectId || !activeId) return;
    await addTerminal(projectId, activeId, $activeInstance?.worktreePath ?? null);
  }

  function selectTerminal(id: string) {
    if (projectId && activeId) setActiveTerminal(projectId, activeId, id);
  }

  async function doClose(id: string) {
    if (projectId && activeId) await removeTerminal(projectId, activeId, id);
  }

  async function closeTerminal(id: string, e: MouseEvent) {
    e.stopPropagation();
    await doClose(id);
  }

  function beginRename(s: TerminalSession) {
    editingId = s.id;
    editValue = s.title;
  }

  function startRename(s: TerminalSession, e: MouseEvent) {
    e.stopPropagation();
    beginRename(s);
  }

  function openCtxMenu(s: TerminalSession, e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    ctxMenu = { x: e.clientX, y: e.clientY, session: s };
  }

  function closeCtxMenu() {
    ctxMenu = null;
  }

  async function closeOthers(s: TerminalSession) {
    closeCtxMenu();
    if (!projectId || !activeId) return;
    for (const t of sessions.filter((o) => o.id !== s.id)) {
      await removeTerminal(projectId, activeId, t.id);
    }
  }

  function commitRename() {
    if (!editingId) return;
    const title = editValue.trim();
    if (projectId && activeId && title) renameTerminal(projectId, activeId, editingId, title);
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
</script>

<svelte:window onresize={onResize} />

<div class="terminal-split">
  <div class="term-list">
    <div class="term-list-head">
      <span>{t('terminal.title')}</span>
      <button class="term-add" onclick={newTerminal} disabled={!activeId} title={t('terminal.new') as string}>
        <Icon name="plus" size={13}/>
      </button>
    </div>
    <div class="term-list-body">
      {#each sessions as s (s.id)}
        <div
          class="term-item {s.id === activeTid ? 'active' : ''}"
          role="button"
          tabindex="0"
          onclick={() => selectTerminal(s.id)}
          ondblclick={(e) => startRename(s, e)}
          oncontextmenu={(e) => openCtxMenu(s, e)}
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
            onclick={(e) => closeTerminal(s.id, e)}
            onkeydown={(e) => { if (e.key === 'Enter') closeTerminal(s.id, e as unknown as MouseEvent); }}
          >
            <Icon name="x" size={11}/>
          </span>
        </div>
      {/each}
    </div>
  </div>

  <div class="term-main">
    <div class="term-host-slot" bind:this={slotEl}></div>
    {#if sessions.length === 0}
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

{#if ctxMenu}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="ctx-backdrop" onmousedown={closeCtxMenu} oncontextmenu={(e) => { e.preventDefault(); closeCtxMenu(); }}></div>
  <div class="ctx-menu" style="left: {ctxMenu.x}px; top: {ctxMenu.y}px">
    <button type="button" class="ctx-item" onclick={() => { const s = ctxMenu!.session; closeCtxMenu(); beginRename(s); }}>
      <Icon name="edit" size={13}/> {t('terminal.rename')}
    </button>
    <div class="ctx-sep"></div>
    <button type="button" class="ctx-item" onclick={() => { closeCtxMenu(); newTerminal(); }}>
      <Icon name="plus" size={13}/> {t('terminal.new')}
    </button>
    <div class="ctx-sep"></div>
    <button type="button" class="ctx-item" onclick={() => { const s = ctxMenu!.session; closeCtxMenu(); doClose(s.id); }}>
      <Icon name="x" size={13}/> {t('terminal.close')}
    </button>
    {#if sessions.length > 1}
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

  .term-list-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    border-bottom: 1px solid var(--stroke-0);
    font-size: 12px;
    font-weight: 500;
    color: var(--fg-1);
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
    min-width: 0;
    min-height: 0;
    background: var(--bg-0);
  }

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
