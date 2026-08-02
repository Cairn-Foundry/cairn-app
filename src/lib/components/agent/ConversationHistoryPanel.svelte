<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n';
  import type { ConversationMeta, ConversationScope } from '$lib/services/conversation-service';
  import { conversationMatches, sortConversations } from '$lib/utils/agent/conversation-export';
  import DeleteConversationModal from './DeleteConversationModal.svelte';

  interface Props {
    instanceConversations: ConversationMeta[];
    projectConversations: ConversationMeta[];
    activeId: string | null;
    runningIds: string[];
    doneId: string | null;
    onSelect: (id: string, scope: ConversationScope) => void;
    onCreate: (scope: ConversationScope) => void;
    onRename: (id: string, scope: ConversationScope, title: string) => void;
    onDelete: (id: string, scope: ConversationScope) => void;
    onDuplicate: (id: string, scope: ConversationScope) => void;
    onTogglePin: (id: string, scope: ConversationScope) => void;
    onToggleArchive: (id: string, scope: ConversationScope) => void;
    onDownload: (id: string, scope: ConversationScope) => void;
    onMoveScope: (from: ConversationScope, id: string) => void;
  }

  const {
    instanceConversations, projectConversations, activeId, runningIds, doneId,
    onSelect, onCreate, onRename, onDelete, onDuplicate,
    onTogglePin, onToggleArchive, onDownload, onMoveScope,
  }: Props = $props();

  interface Row {
    meta: ConversationMeta;
    scope: ConversationScope;
  }

  let query = $state('');
  let showArchived = $state(false);
  let collapsed = $state<Record<ConversationScope, boolean>>({ project: false, instance: false });
  let menuFor = $state<string | null>(null);
  let renamingId = $state<string | null>(null);
  let renameValue = $state('');
  let pendingDelete = $state<Row | null>(null);
  let dragged = $state<{ id: string; scope: ConversationScope } | null>(null);
  let dropScope = $state<ConversationScope | null>(null);
  let dragActive = $state(false);
  let didDrag = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let sectionEls = $state<Partial<Record<ConversationScope, HTMLElement>>>({});

  const DRAG_THRESHOLD = 6;

  function rowsOf(list: ConversationMeta[], scope: ConversationScope): Row[] {
    const visible = list.filter(
      (meta) => meta.archived === showArchived && conversationMatches(meta, query),
    );
    return sortConversations(visible).map((meta) => ({ meta, scope }));
  }

  let sections = $derived([
    {
      scope: 'project' as ConversationScope,
      label: t('terminal.projectSection'),
      newLabel: t('agent.history.newShared'),
      emptyLabel: t(showArchived ? 'agent.history.archivedEmpty' : 'agent.history.sharedEmpty'),
      rows: rowsOf(projectConversations, 'project'),
      total: projectConversations.length,
    },
    {
      scope: 'instance' as ConversationScope,
      label: t('terminal.instanceSection'),
      newLabel: t('agent.history.new'),
      emptyLabel: t(showArchived ? 'agent.history.archivedEmpty' : 'agent.history.instanceEmpty'),
      rows: rowsOf(instanceConversations, 'instance'),
      total: instanceConversations.length,
    },
  ]);

  let archivedCount = $derived(
    [...projectConversations, ...instanceConversations].filter((c) => c.archived).length,
  );

  function startRename(meta: ConversationMeta) {
    menuFor = null;
    renamingId = meta.id;
    renameValue = meta.title;
  }

  function commitRename(scope: ConversationScope) {
    if (!renamingId) return;
    const title = renameValue.trim();
    if (title) onRename(renamingId, scope, title);
    renamingId = null;
  }

  function confirmDelete() {
    if (!pendingDelete) return;
    onDelete(pendingDelete.meta.id, pendingDelete.scope);
    pendingDelete = null;
  }

  function dragPointerDown(e: PointerEvent, meta: ConversationMeta, scope: ConversationScope) {
    if (renamingId === meta.id) return;
    if ((e.target as Element).closest('.row-menu, .row-dropdown, .rename-input')) return;
    e.preventDefault();
    dragged = { id: meta.id, scope };
    dragActive = false;
    didDrag = false;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function scopeAt(y: number): ConversationScope | null {
    for (const scope of ['project', 'instance'] as const) {
      const el = sectionEls[scope];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (y >= rect.top && y <= rect.bottom) return scope;
    }
    return null;
  }

  function dragPointerMove(e: PointerEvent) {
    if (!dragged) return;
    if (!dragActive) {
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
      dragActive = true;
      document.body.classList.add('dragging');
    }
    didDrag = true;
    const over = scopeAt(e.clientY);
    dropScope = over && over !== dragged.scope ? over : null;
  }

  function dragPointerUp() {
    if (dragged && dropScope && dragActive) onMoveScope(dragged.scope, dragged.id);
    dragged = null;
    dropScope = null;
    dragActive = false;
    document.body.classList.remove('dragging');
  }
</script>

<svelte:window onclick={() => { menuFor = null; }}/>

{#snippet conversationRow(row: Row, draggable: boolean)}
  <div
    class="row"
    role="button"
    tabindex="0"
    class:active={row.meta.id === activeId}
    class:archived={row.meta.archived}
    class:dragging={dragActive && dragged?.id === row.meta.id}
    onpointerdown={(e) => draggable && dragPointerDown(e, row.meta, row.scope)}
    onpointermove={dragPointerMove}
    onpointerup={dragPointerUp}
    onclick={() => { if (!didDrag) onSelect(row.meta.id, row.scope); didDrag = false; }}
    onkeydown={(e) => { if (e.key === 'Enter') onSelect(row.meta.id, row.scope); }}
  >
    <div class="row-main">
      <span class="row-title">
        {#if row.meta.pinned}<Icon name="pin" size={10}/>{/if}
        {#if renamingId === row.meta.id}
          <!-- svelte-ignore a11y_autofocus -->
          <input
            class="rename-input selectable"
            autofocus
            bind:value={renameValue}
            onclick={(e) => e.stopPropagation()}
            onblur={() => commitRename(row.scope)}
            onkeydown={(e) => {
              if (e.key === 'Enter') commitRename(row.scope);
              if (e.key === 'Escape') renamingId = null;
            }}
          />
        {:else}
          <span class="row-label">{row.meta.title}</span>
        {/if}
        {#if runningIds.includes(row.meta.id)}
          <span class="conv-busy-dot" title={t('workspace.agentRunning') as string}></span>
        {:else if row.meta.id === doneId}
          <span class="conv-done-dot" title={t('workspace.agentFinished') as string}></span>
        {/if}
      </span>
      {#if row.meta.preview}
        <span class="row-sub">
          <span class="row-preview">{row.meta.preview}</span>
        </span>
      {/if}
    </div>

    <button
      class="icon-btn row-menu"
      title={t('agent.history.actions') as string}
      onclick={(e) => { e.stopPropagation(); menuFor = menuFor === row.meta.id ? null : row.meta.id; }}
    >
      <Icon name="dots-v" size={13}/>
    </button>

    {#if menuFor === row.meta.id}
      <div class="row-dropdown">
        <button onclick={() => startRename(row.meta)}>
          <Icon name="edit" size={12}/>{t('agent.history.rename')}
        </button>
        <button onclick={() => { menuFor = null; onDuplicate(row.meta.id, row.scope); }}>
          <Icon name="copy" size={12}/>{t('agent.history.duplicate')}
        </button>
        <button onclick={() => { menuFor = null; onTogglePin(row.meta.id, row.scope); }}>
          <Icon name="pin" size={12}/>{t(row.meta.pinned ? 'agent.history.unpin' : 'agent.history.pin')}
        </button>
        <button onclick={() => { menuFor = null; onToggleArchive(row.meta.id, row.scope); }}>
          <Icon name="folder" size={12}/>{t(row.meta.archived ? 'agent.history.unarchive' : 'agent.history.archive')}
        </button>
        <button onclick={() => { menuFor = null; onDownload(row.meta.id, row.scope); }}>
          <Icon name="download" size={12}/>{t('agent.history.downloadMarkdown')}
        </button>
        <div class="menu-sep"></div>
        <button class="danger" onclick={() => { menuFor = null; pendingDelete = row; }}>
          <Icon name="trash" size={12}/>{t('agent.history.delete')}
        </button>
      </div>
    {/if}
  </div>
{/snippet}

<div class="history">
  <div class="history-head">
    <span class="history-title">{t('agent.history.title')}</span>
  </div>

  <div class="history-filter">
    <button class:active={!showArchived} onclick={() => { showArchived = false; }}>
      {t('agent.history.activeFilter')}
    </button>
    <button class:active={showArchived} onclick={() => { showArchived = true; }}>
      {t('agent.history.archived')}
      {#if archivedCount > 0}<span class="filter-count">{archivedCount}</span>{/if}
    </button>
  </div>

  <div class="history-search">
    <Icon name="search" size={12}/>
    <input
      class="selectable"
      type="text"
      bind:value={query}
      placeholder={t('agent.history.searchPlaceholder') as string}
    />
    {#if query}
      <button class="icon-btn" title={t('agent.history.clearSearch') as string} onclick={() => { query = ''; }}>
        <Icon name="x" size={11}/>
      </button>
    {/if}
  </div>

  <div class="history-list">
    {#each sections as section (section.scope)}
      <div
        class="section"
        class:drop-target={dropScope === section.scope}
        bind:this={sectionEls[section.scope]}
      >
        <div class="section-head">
          <button
            class="section-toggle"
            aria-expanded={!collapsed[section.scope]}
            onclick={() => { collapsed[section.scope] = !collapsed[section.scope]; }}
          >
            <Icon name={collapsed[section.scope] ? 'chev-r' : 'chev-d'} size={11}/>
            {section.label}
            <span class="section-count">{section.rows.length}</span>
          </button>
          {#if !showArchived}
            <button class="icon-btn" title={section.newLabel as string} onclick={() => onCreate(section.scope)}>
              <Icon name="plus" size={12}/>
            </button>
          {/if}
        </div>

        {#if !collapsed[section.scope]}
          {#if section.rows.length === 0}
            <div class="section-empty">{section.emptyLabel}</div>
          {/if}

          {#each section.rows as row (row.meta.id)}
            {@render conversationRow(row, !showArchived)}
          {/each}
        {/if}
      </div>
    {/each}
  </div>
</div>

{#if pendingDelete}
  <DeleteConversationModal
    title={pendingDelete.meta.title}
    messageCount={pendingDelete.meta.messageCount}
    onClose={() => { pendingDelete = null; }}
    onConfirm={confirmDelete}
  />
{/if}

<style>
  .history {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
    background: var(--bg-1);
    border-right: 1px solid var(--stroke-0);
  }

  .history-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 8px 8px 12px;
    border-bottom: 1px solid var(--stroke-0);
  }

  .history-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--fg-1);
  }

  .history-filter {
    display: flex;
    gap: 2px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--stroke-0);
  }

  .history-filter button {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 9px;
    font-family: inherit;
    font-size: 11.5px;
    color: var(--fg-3);
    background: transparent;
    border: none;
    border-radius: var(--r-sm);
    cursor: pointer;
  }

  .history-filter button:hover { color: var(--fg-1); background: var(--bg-2); }

  .history-filter button.active {
    color: var(--fg-0);
    background: var(--bg-3);
  }

  .filter-count {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--fg-3);
  }

  .history-search {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px 6px 12px;
    color: var(--fg-3);
    border-bottom: 1px solid var(--stroke-0);
  }

  .history-search input {
    flex: 1;
    min-width: 0;
    padding: 2px 0;
    font-size: 12px;
    font-family: inherit;
    color: var(--fg-1);
    background: transparent;
    border: none;
    outline: none;
  }

  .history-list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--stroke-1) transparent;
  }

  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 8px 4px 8px;
  }

  .section-toggle {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    flex: 1;
    min-width: 0;
    padding: 2px 4px;
    font-family: inherit;
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--fg-3);
    background: transparent;
    border: none;
    border-radius: var(--r-xs);
    cursor: pointer;
    text-align: left;
  }

  .section-toggle:hover { color: var(--fg-1); background: var(--bg-2); }

  .section-count {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0;
    color: var(--fg-4, var(--fg-3));
  }

  .section-empty {
    padding: 4px 12px 8px;
    font-size: 11.5px;
    font-style: italic;
    color: var(--fg-3);
  }

  .row {
    position: relative;
    display: flex;
    align-items: center;
    padding-right: 4px;
    cursor: pointer;
  }

  .row:hover { background: var(--bg-2); }
  .row.dragging { opacity: 0.5; }
  .row.active { background: var(--bg-3); }
  .row.archived .row-label { color: var(--fg-3); }

  .row-main {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
    padding: 6px 4px 6px 12px;
    min-height: 0;
  }

  .conv-busy-dot,
  .conv-done-dot {
    flex-shrink: 0;
    width: 7px;
    height: 7px;
    margin-left: auto;
    border-radius: 50%;
    background: var(--accent);
  }

  .conv-busy-dot { animation: conv-pulse 1.5s ease-in-out infinite; }

  .conv-done-dot { background: var(--fg-2); }

  @keyframes conv-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.35; }
  }

  .row-title {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    font-size: 12px;
    color: var(--fg-1);
  }

  .row.active .row-title { color: var(--fg-0); }

  .row-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rename-input {
    flex: 1;
    min-width: 0;
    padding: 1px 4px;
    font: inherit;
    color: var(--fg-0);
    background: var(--bg-0);
    border: 1px solid var(--accent-line, var(--stroke-1));
    border-radius: var(--r-xs);
    outline: none;
  }

  .row-sub {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    font-size: 11px;
    color: var(--fg-3);
  }

  .row-preview {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 3px;
    color: var(--fg-3);
    background: transparent;
    border: none;
    border-radius: var(--r-xs);
    cursor: pointer;
  }

  .icon-btn:hover { color: var(--fg-0); background: var(--bg-3); }

  .row-menu { opacity: 0; }
  .row:hover .row-menu { opacity: 1; }

  .row-dropdown {
    position: absolute;
    top: calc(100% - 4px);
    right: 6px;
    z-index: 100;
    min-width: 180px;
    padding: 4px;
    display: flex;
    flex-direction: column;
    gap: 1px;
    background: var(--bg-2);
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-md);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  }

  .row-dropdown button {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 5px 8px;
    font-size: 12px;
    color: var(--fg-1);
    background: transparent;
    border: none;
    border-radius: var(--r-sm);
    cursor: pointer;
    text-align: left;
  }

  .row-dropdown button:hover { background: var(--bg-3); color: var(--fg-0); }
  .row-dropdown button.danger { color: #ff8080; }
  .row-dropdown button.danger:hover { background: rgba(255, 80, 80, 0.12); }

  .menu-sep {
    height: 1px;
    margin: 3px 4px;
    background: var(--stroke-0);
  }

  .section.drop-target {
    background: var(--accent-weak, var(--bg-2));
    box-shadow: inset 0 0 0 1px var(--accent-line, var(--stroke-2));
  }
</style>
