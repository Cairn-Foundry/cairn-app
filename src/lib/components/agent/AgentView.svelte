<script lang="ts">
  /**
   * The Agent step: the conversation history on the left, the CLI itself on the
   * right.
   *
   * Cairn does not wrap the agent - it runs the CLI, as it is, in an embedded
   * terminal, and remembers only what it takes to relaunch it later. There is no
   * message to send from here, no model or permission setting: those belong to
   * the CLI, and a CLI update never breaks this view. Reopening a past
   * conversation relaunches its CLI with its resume argument.
   */
  import { onMount, untrack } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import ProviderLogo from '$lib/components/home/agents/ProviderLogo.svelte';
  import { t } from '$lib/i18n';
  import {
    type CliProviderDef,
    type CliProviderId,
    listCliProviders,
  } from '$lib/services/cli-provider-service';
  import type { ConversationScope } from '$lib/services/conversation-service';
  import {
    activeConversationId,
    type ConversationRef,
    closeConversation,
    conversationScopeKey,
    conversationTerminals,
    deleteConversation,
    findConversation,
    instanceConversations as instanceConversationsStore,
    moveConversationToScope,
    openConversation,
    projectConversations as projectConversationsStore,
    renameConversation,
    restoreConversations,
    selectConversation,
    startConversation,
    startIdleReaper,
    toggleArchived,
    togglePinned,
  } from '$lib/stores/conversation';
  import { agentDraftRequest, clearAgentDraft } from '$lib/stores/agent-draft';
  import { activeInstance } from '$lib/stores/instance';
  import { lastCli } from '$lib/stores/ui';
  import * as manager from '$lib/utils/terminal/terminal-manager';
  import ConversationHistoryPanel from './ConversationHistoryPanel.svelte';
  import NewConversationPicker from './NewConversationPicker.svelte';

  interface Props {
    /** Opens the hub page where the installed CLIs are listed. */
    onGoAgents: () => void;
  }

  const { onGoAgents }: Props = $props();

  let providers = $state<CliProviderDef[]>([]);
  let providersReady = $state(false);
  let starting = $state(false);
  let slotEl = $state<HTMLDivElement | undefined>();

  let instance = $derived($activeInstance);
  let scopeKey = $derived(
    instance ? conversationScopeKey(instance.projectId, instance.id) : '',
  );
  let instanceList = $derived($instanceConversationsStore[scopeKey] ?? []);
  let projectList = $derived(
    instance ? ($projectConversationsStore[instance.projectId] ?? []) : [],
  );
  let activeId = $derived($activeConversationId[scopeKey] ?? null);
  /**
   * Derived from the two lists rather than through `findConversation`: that one
   * reads the stores with `get()`, so nothing here would re-run when the
   * conversation is renamed and the header would keep the old title while the
   * list showed the new one.
   */
  let active = $derived.by(() => {
    if (!instance || !activeId) return null;
    const inInstance = instanceList.find((c) => c.id === activeId);
    if (inInstance) {
      return { meta: inInstance, ref: refOf('instance') };
    }
    const inProject = projectList.find((c) => c.id === activeId);
    return inProject ? { meta: inProject, ref: refOf('project') } : null;
  });
  let terminalId = $derived(activeId ? ($conversationTerminals[activeId] ?? null) : null);
  let preferred = $derived(($lastCli || null) as CliProviderId | null);

  /** Label of a CLI from the registry, falling back to its id for an unknown one. */
  function cliLabel(cli: string): string {
    return providers.find((p) => p.id === cli)?.label ?? cli;
  }

  /**
   * The registry, from the cache unless `refresh` is asked for. Detection runs
   * each installed CLI to read its version, so redoing it every time the picker
   * opens is a wait on a screen the user crosses often; the picker offers the
   * refresh as a button instead.
   */
  async function loadProviders(refresh = false) {
    if (refresh) providersReady = false;
    providers = await listCliProviders(refresh).catch(() => []);
    providersReady = true;
  }

  onMount(() => {
    void loadProviders();
    // Runs for the life of the app, not of this view: a conversation left
    // running is exactly the one whose view has been navigated away from.
    startIdleReaper();
  });

  // Restoring the index also restores which conversation was open; reopening it
  // is what relaunches its CLI, so a restart lands back in the same session.
  $effect(() => {
    const inst = instance;
    if (!inst) return;
    void untrack(async () => {
      await restoreConversations(inst.projectId, inst.id);
      const id = $activeConversationId[conversationScopeKey(inst.projectId, inst.id)];
      if (!id) return;
      const found = findConversation(inst.projectId, inst.id, id);
      if (found) await openConversation(found.ref, id).catch(() => {});
    });
  });

  // The DOM node is only a mount point: the xterm instance lives in the manager
  // and survives switching conversation, step or project.
  $effect(() => {
    if (!slotEl) return;
    if (terminalId) manager.attach(terminalId, slotEl);
    else slotEl.replaceChildren();
    const tid = terminalId;
    return () => { if (tid) manager.detach(tid); };
  });

  $effect(() => {
    if (terminalId) requestAnimationFrame(() => manager.focus(terminalId));
  });

  // A prompt composed by another step (a failing test, a red pipeline, a ticket)
  // is typed into the CLI without a newline: submitting it is the user's call.
  $effect(() => {
    const request = $agentDraftRequest;
    const tid = terminalId;
    if (!request || !tid || request.instanceId !== instance?.id) return;
    manager.paste(tid, request.text);
    clearAgentDraft();
  });

  /** The ref a row of the panel acts on. */
  function refOf(scope: ConversationScope): ConversationRef {
    return {
      projectId: instance?.projectId ?? '',
      instanceId: instance?.id ?? '',
      scope,
    };
  }

  async function pickCli(cli: CliProviderId) {
    const inst = instance;
    if (!inst || starting) return;
    starting = true;
    try {
      await startConversation(refOf('instance'), cli, inst.worktreePath);
    } finally {
      starting = false;
    }
  }

  async function select(id: string, scope: ConversationScope) {
    await openConversation(refOf(scope), id).catch(() => {});
  }

  /** Shows the picker without touching whichever CLI is still running. */
  function newConversation() {
    if (!instance) return;
    activeConversationId.update((m) => ({ ...m, [scopeKey]: null }));
  }

  let renaming = $state(false);
  let renameValue = $state('');

  function startRename() {
    if (!active) return;
    renameValue = active.meta.title;
    renaming = true;
  }

  /**
   * Archives the conversation and leaves it. Its CLI is stopped with it: an
   * archived conversation is one the user has put away, and a process still
   * running in the background would be a surprise rather than a convenience -
   * reopening it resumes exactly where it stopped.
   */
  function archiveConversation() {
    if (!active) return;
    const { ref, meta } = active;
    closeConversation(meta.id);
    toggleArchived(ref, meta.id);
    selectConversation(ref.projectId, ref.instanceId, null);
  }

  function commitRename() {
    if (!active) return;
    const title = renameValue.trim();
    if (title) renameConversation(active.ref, active.meta.id, title);
    renaming = false;
  }

  function onResize() {
    if (terminalId) manager.refit(terminalId);
  }
</script>

<svelte:window onresize={onResize}/>

<div class="agent-view">
  <ConversationHistoryPanel
    instanceConversations={instanceList}
    projectConversations={projectList}
    {activeId}
    {cliLabel}
    newSessionActive={activeId === null}
    onSelect={(id, scope) => void select(id, scope)}
    onNewSession={newConversation}
    onRename={(id, scope, title) => renameConversation(refOf(scope), id, title)}
    onDelete={(id, scope) => deleteConversation(refOf(scope), id)}
    onTogglePin={(id, scope) => togglePinned(refOf(scope), id)}
    onToggleArchive={(id, scope) => toggleArchived(refOf(scope), id)}
    onMoveScope={(from, id) => moveConversationToScope(refOf(from), id)}
  />

  <div class="agent-main">
    {#if active}
      <div class="conv-bar">
        <span class="conv-mark">
          <ProviderLogo
            id={active.meta.cli}
            size={16}
            fallback={cliLabel(active.meta.cli).slice(0, 1)}
          />
        </span>

        {#if renaming}
          <!-- svelte-ignore a11y_autofocus -->
          <input
            class="conv-rename selectable"
            autofocus
            bind:value={renameValue}
            onblur={commitRename}
            onkeydown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') renaming = false;
            }}
          />
        {:else}
          <button class="conv-title" onclick={startRename} title={t('agent.history.rename') as string}>
            {active.meta.title || t('agent.untitled')}
          </button>
        {/if}

        <div class="spacer"></div>

        <button
          class="icon-btn"
          onclick={() => archiveConversation()}
          title={t('agent.history.archive') as string}
          aria-label={t('agent.history.archive') as string}
        >
          <Icon name="archive" size={14}/>
        </button>
      </div>

      <div class="term-slot" bind:this={slotEl}></div>

      {#if !terminalId}
        <div class="conv-stopped">
          <p>{t('agent.stopped')}</p>
          <button class="btn" onclick={() => void select(active.meta.id, active.ref.scope)}>
            {t('agent.resume')}
          </button>
        </div>
      {/if}
    {:else if starting}
      <div class="starting"><Spinner size={18}/></div>
    {:else}
      <NewConversationPicker
        {providers}
        ready={providersReady}
        {preferred}
        onPick={(cli) => void pickCli(cli)}
        onRefresh={() => void loadProviders(true)}
        onOpenProviders={onGoAgents}
      />
    {/if}
  </div>
</div>

<style>
  /* `flex: 1` because `.step-view` is a flex container: without it this grid is
     a flex item sized to its content, the `1fr` column collapses to whatever the
     panel on the right happens to need, and everything inside it sits against
     the left edge of the step. The other views carry the same rule. */
  .agent-view {
    flex: 1;
    display: grid;
    grid-template-columns: 260px 1fr;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .agent-main {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: var(--bg-0);
  }

  .conv-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 36px;
    padding: 3px 8px 3px 12px;
    border-bottom: 1px solid var(--stroke-0);
    box-sizing: border-box;
  }

  .conv-mark {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    color: var(--fg-2);
  }

  .conv-title,
  .conv-rename {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--fg-0);
    background: none;
    border: none;
    padding: 2px 4px;
    border-radius: 4px;
    max-width: 40%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .conv-title { cursor: text; }
  .conv-title:hover { background: var(--bg-2); }

  .conv-rename {
    border: 1px solid var(--accent);
    min-width: 160px;
  }




  .spacer { flex: 1; }

  .term-slot {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .conv-stopped {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    flex: 1;
    min-height: 0;
    color: var(--fg-2);
    font-size: 12.5px;
  }

  .conv-stopped p { margin: 0; }

  .starting {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
  }
</style>
