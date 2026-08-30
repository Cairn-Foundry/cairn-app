<script lang="ts">
  /**
   * Conversation list for the Agent view: two collapsible scopes, project then
   * instance, with rename, pin, archive and delete. Archiving filters those same
   * two groups, it never adds a third list, and order is never manual - dragging
   * a row only moves it between scopes.
   *
   * A conversation is a CLI running in a PTY, so a row shows which CLI owns it
   * rather than an excerpt of what was said, and its dot means "the CLI is
   * running" - there is no "finished, unread": Cairn does not read the output
   * and cannot tell an answer from a prompt.
   */
  import Icon from '$lib/components/Icon.svelte';
  import ProviderLogo from '$lib/components/home/agents/ProviderLogo.svelte';
  import SearchInput from '$lib/components/SearchInput.svelte';
  import { t } from '$lib/i18n';
  import type { ConversationMeta, ConversationScope } from '$lib/services/conversation-service';
  import { conversationMatches, sortConversations } from '$lib/utils/agent/conversation-list';
  import DeleteConversationModal from './DeleteConversationModal.svelte';

  interface Props {
    instanceConversations: ConversationMeta[];
    projectConversations: ConversationMeta[];
    activeId: string | null;
    /** Label to show for a CLI id, from the registry. */
    cliLabel: (cli: string) => string;
    onSelect: (id: string, scope: ConversationScope) => void;
    onNewSession: () => void;
    /** True while the view is on a session that has not been written down yet. */
    newSessionActive: boolean;
    onRename: (id: string, scope: ConversationScope, title: string) => void;
    onDelete: (id: string, scope: ConversationScope) => void;
    onTogglePin: (id: string, scope: ConversationScope) => void;
    onToggleArchive: (id: string, scope: ConversationScope) => void;
    onMoveScope: (from: ConversationScope, id: string) => void;
  }

  const {
    instanceConversations, projectConversations, activeId, cliLabel,
    onSelect, onNewSession, newSessionActive, onRename, onDelete,
    onTogglePin, onToggleArchive, onMoveScope,
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

  /** Rows of one scope: the Active/Archived filter and the search, then pinned first. */
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
      emptyLabel: t(showArchived ? 'agent.history.archivedEmpty' : 'agent.history.sharedEmpty'),
      rows: rowsOf(projectConversations, 'project'),
      total: projectConversations.length,
    },
    {
      scope: 'instance' as ConversationScope,
      label: t('terminal.instanceSection'),
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

  /** Arms a drag on pointer events - the HTML5 drag API is unusable in the webview. */
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

  /** Which section the pointer is over, used to pick the drop target. */
  function scopeAt(y: number): ConversationScope | null {
    for (const scope of ['project', 'instance'] as const) {
      const el = sectionEls[scope];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (y >= rect.top && y <= rect.bottom) return scope;
    }
    return null;
  }

  /** Starts the drag past the threshold, then highlights the other scope as target. */
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
    <span class="row-mark">
      <ProviderLogo id={row.meta.cli} size={16} fallback={cliLabel(row.meta.cli).slice(0, 1)}/>
    </span>

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
          <span class="row-label">{row.meta.title || t('agent.history.untitled')}</span>
        {/if}
      </span>
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
        <button onclick={() => { menuFor = null; onTogglePin(row.meta.id, row.scope); }}>
          <Icon name="pin" size={12}/>{t(row.meta.pinned ? 'agent.history.unpin' : 'agent.history.pin')}
        </button>
        <button onclick={() => { menuFor = null; onToggleArchive(row.meta.id, row.scope); }}>
          <Icon name="archive" size={12}/>{t(row.meta.archived ? 'agent.history.unarchive' : 'agent.history.archive')}
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

  <SearchInput
    bind:value={query}
    placeholder={t('agent.history.searchPlaceholder') as string}
  />

  <div class="history-list">
    {#if !showArchived}
      <button class="new-session" class:active={newSessionActive} onclick={onNewSession}>
        <Icon name="plus" size={12}/>
        {t('agent.newSession')}
      </button>
    {/if}
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
    min-height: 36px;
    padding: 8px 8px 8px 12px;
    border-bottom: 1px solid var(--stroke-0);
    box-sizing: border-box;
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

  .history-list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--stroke-1) transparent;
  }

  .new-session {
    align-items: center;
    background: none;
    border: 1px dashed var(--stroke-0);
    border-radius: 6px;
    color: var(--fg-2);
    cursor: pointer;
    box-sizing: border-box;
    display: flex;
    font-size: 12px;
    gap: 6px;
    /* A form control sizes to its content even as a flex container, so the
       width is stated. The section below already pads its head by 8px, which
       is the gap under the row - hence no bottom margin of its own. */
    margin: 8px 8px 0;
    padding: 8px 9px;
    text-align: left;
    width: calc(100% - 16px);
  }

  .new-session:hover {
    background: var(--bg-2);
    color: var(--fg-0);
  }

  .new-session.active {
    background: var(--bg-3);
    border-style: solid;
    color: var(--fg-0);
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

  /* The CLI's name left the row with its logo, but the height did not: a
     one-line row here would make the list jump against every other panel that
     sizes its rows the same way. */
  .row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    padding: 4px 4px 4px 12px;
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
    min-height: 0;
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

  .row-mark {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    flex-shrink: 0;
    color: var(--fg-2);
  }

  .row.active .row-mark { color: var(--fg-1); }

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

  /* Always visible: a row action the user has to hover to discover is one they
     do not know exists. Dimmed until the row is hovered so a long list still
     reads as titles rather than a column of buttons. */
  .row-menu {
    opacity: 0.45;
    flex-shrink: 0;
  }
  .row:hover .row-menu,
  .row-menu:focus-visible { opacity: 1; }

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
