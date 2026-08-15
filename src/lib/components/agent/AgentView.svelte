<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import { get } from 'svelte/store';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import Icon from '$lib/components/Icon.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import { t, getLocale } from '$lib/i18n';
  import { activeInstance, instancesWithBase } from '$lib/stores/instance';
  import { activeProject, projects } from '$lib/stores/project';
  import { recordUsage } from '$lib/stores/usage';
  import { prepareInstanceEnv } from '$lib/stores/env';
  import { settings } from '$lib/stores/settings';
  import { respondPermission, sendMessage, stopAgent, type RunOptions } from '$lib/services/agent-service';
  import { mentionToken } from '$lib/utils/agent/mention';
  import { messageClock, messageDate } from '$lib/utils/agent/message-time';
  import { buildHandoffTranscript, priorTurns, withHandoffContext } from '$lib/utils/agent/handoff';
  import { quickSearch, type QuickSearchHit } from '$lib/services/file-service';
  import { getFileState } from '$lib/services/file-state-service';
  import { listAgentCommands, type AgentSlashCommand } from '$lib/services/ai-provider-service';
  import {
    aiProviders, effortsOf, loadAiProviders, modelsOf, permissionModesOf,
    providerCapabilities, refreshProviderModels,
  } from '$lib/stores/ai-providers';
  import { contextWindowOf, prettyModelName, providerById } from '$lib/components/home/agents/providers-data';
  import { effortLabel, permissionModeLabel } from '$lib/utils/agent/run-options';
  import { groupModelFamilies } from '$lib/utils/agent/model-families';
  import ConversationHistoryPanel from './ConversationHistoryPanel.svelte';
  import AgentRunsPanel from './AgentRunsPanel.svelte';
  import TurnBlocks from './TurnBlocks.svelte';
  import PermissionCard from './PermissionCard.svelte';
  import AgentThreadConfirmModal from './AgentThreadConfirmModal.svelte';
  import AgentThreadView from './AgentThreadView.svelte';
  import { conversationToMarkdown, deriveConversationTitle, markdownFileName } from '$lib/utils/agent/conversation-export';
  import type { ConversationScope } from '$lib/services/conversation-service';
  import {
    activeConversationId, conversationScopeKey, conversationsOf, findConversation,
    instanceConversations as instanceConversationsStore,
    projectConversations as projectConversationsStore,
    restoreConversations, selectConversation, deleteConversation, duplicateConversation,
    loadConversationBody,
    createConversation as createStoredConversation, updateConversationContent,
    setConversationProvider, setConversationRunOptions, setConversationSession, conversationSession,
    lastProviderOf, setLastProvider,
    renameConversation,
    togglePinned, toggleArchived, moveConversationToScope,
    type ConversationRef,
  } from '$lib/stores/conversation';
  import {
    addAgentRun, agentTurnsOf, clearAgentPermission, findAgentRun,
    agentPermissionRequests, appendAgentBlock, closeAgentToolBlocks,
    deleteAgentThread, finishAgentToolBlock,
    patchAgentRun,
    isInFlight, restoreAgentRuns, setAgentPermission,
    agentRuns, agentThreadRuns, agentThreadsOf, lastTextOf, type AgentRun,
  } from '$lib/stores/agent-runs';
  import { buildPermissionResponse } from '$lib/utils/agent/permission-response';
  import { closeDelegation, closeToolBlock, openDelegation } from '$lib/utils/agent/delegation';
  import { mergeIntoDraft } from '$lib/utils/agent/prompt-queue';
  import { loadNativeAgents, nativeAgents } from '$lib/stores/native-agents';
  import type { AgentBlock } from '$lib/services/conversation-service';
  import {
    setAgentBusy, setAgentDone, pingAgentCompletion, doneConversationOf,
    agentActivityKey, agentBusyConversations, agentDoneConversation,
  } from '$lib/stores/agent-activity';
  import { writeFile } from '$lib/services/file-service';
  import { activeStep, terminalActive, commandsActive, openAgentId } from '$lib/stores/ui';
  import { PROVIDERS } from '$lib/components/home/agents/providers-data';
  import { IS_MAC, MOD_LABEL } from '$lib/utils/platform';
  import { formatCount } from '$lib/utils/format';
  import { shortenPaths } from '$lib/utils/agent/tool-label';
  import type { Instance } from '$lib/types/instance';
  import { responseStats } from '$lib/utils/agent/response-stats';
  import { marked } from 'marked';

  marked.use({ async: false, gfm: true });

  function renderMarkdown(content: string): string {
    return marked.parse(content, { async: false }) as string;
  }

  /**
   * Only a provider the user turned on in Settings > Agents can be picked here:
   * a disabled - or never configured - provider has no key and no binary, so
   * offering its models would only produce a failing run.
   */
  let selectableProviders = $derived(
    PROVIDERS.filter((p) => p.status !== 'coming-soon' && $aiProviders.providers[p.id]?.enabled),
  );

  interface MessageUsage {
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
    /** The window the provider itself reported for this model, when it does. */
    contextWindow?: number;
    costUsd?: number;
    durationMs?: number;
    numTurns?: number;
  }

  interface Message {
    role: 'system' | 'user' | 'agent';
    content: string;
    /** When the turn happened, in milliseconds. */
    ts: number;
    /** Legacy clock face, read for what is already on disk, never written. */
    time?: string;
    streaming?: boolean;
    thinking?: string;
    usage?: MessageUsage;
    /** What the turn did, in the order it did it. Absent on older messages. */
    blocks?: AgentBlock[];
    /** The prompt an agent was given, kept on its answer so it reads as a reply. */
    replyTo?: string;
    /** Where that prompt sits, so the quote leads back to it. */
    replyToIndex?: number;
    /** Set on the line that acknowledges an agent was launched. */
    agentStarted?: boolean;
    /** The agent that answered, kept as written so a later rename cannot rewrite history. */
    agentName?: string;
    /** The run that produced it, so its full work stays one click away. */
    agentRunId?: string;
  }

  interface ActivityEntry {
    /** When the line happened, in milliseconds. */
    ts: number;
    /** Legacy clock face, read for what is already on disk, never written. */
    time?: string;
    icon: string;
    label: string;
    source: 'stdin' | 'tool' | 'system';
    done?: boolean;
    failed?: boolean;
    agentRunId?: string;
    /** The message this line stands for, so clicking it goes straight there. */
    messageIndex?: number;
  }

  interface Conversation {
    id: string;
    scope: ConversationScope;
    /** Not written down yet: a new session exists on screen until it is used. */
    pending: boolean;
    messages: Message[];
    activity: ActivityEntry[];
    draft: string;
    busy: boolean;
    error: string;
    providerId: string;
    modelId: string;
    effort: string;
    permissionMode: string;
  }

  interface Run {
    instanceId: string;
    conversationId: string;
    scope: ConversationScope;
    messages: Message[];
    activity: ActivityEntry[];
    /** Whose session this run belongs to, when it reports one back. */
    providerId: string;
    projectId: string;
    workingDir: string;
    /**
     * Where this run's message sits in `messages`, and what the run has written
     * so far. The blocks belong to the run, and the message is rewritten from
     * them: mutating an object read out of reactive state is easy to get wrong,
     * assigning the element back is not.
     */
    answerIndex: number;
    blocks: AgentBlock[];
    thinking: string;
    /**
     * The subagents this run started, by the `tool_use_id` of the delegation
     * that started them. Their output is attributed to that id, so this is how
     * an attributed event finds the thread it belongs to.
     */
    subagents: Record<string, string>;
  }

  interface PermissionRequest {
    runId: string;
    requestId: string;
    toolName: string;
    displayName?: string;
    input: Record<string, unknown>;
    description?: string;
    suggestions?: unknown[];
  }

  interface RateLimitInfo {
    status?: string;
    resetsAt?: number;
    rateLimitType?: string;
  }

  /**
   * The base instance carries the same id in every project, so the live
   * conversation has to be keyed by the project too or project B shows what
   * was open in project A.
   */
  function liveKey(inst: Instance): string {
    return `${inst.projectId}:${inst.id}`;
  }

  let conversations = $state<Record<string, Conversation>>({});
  let runs = $state<Record<string, Run>>({});
  let permissions = $state<Record<string, PermissionRequest>>({});
  let rateLimit = $state<RateLimitInfo | null>(null);

  function runOfConversation(conversationId: string): [string, Run] | undefined {
    return Object.entries(runs).find(([, run]) => run.conversationId === conversationId);
  }
  let historyOpen = $state(true);
  let loadingConversation = $state(false);
  let drafts = $state<Record<string, string>>({});
  /**
   * Prompts written while an answer was still coming, by conversation. They
   * leave in order as soon as that answer lands, so a follow-up can be written
   * the moment it is thought of instead of being held until the agent is free.
   */
  let queued = $state<Record<string, string[]>>({});
  /** Absent while an agent thread has taken the pane over, so every use guards. */
  let scrollEl = $state<HTMLElement | undefined>();
  let activityEl: HTMLElement;
  let textareaEl = $state<HTMLTextAreaElement>();
  let unlisten: UnlistenFn | undefined;
  let copiedKey = $state<string | null>(null);

  let activityWidth = $state(300);
  let isActivityResizing = $state(false);
  let resizeStartX = 0;
  let resizeStartWidth = 0;

  $effect(() => {
    const w = $settings.agentActivityWidth;
    if (!untrack(() => isActivityResizing)) activityWidth = w;
  });

  let activeId = $derived($activeInstance?.id ?? null);
  let current = $derived($activeInstance ? conversations[liveKey($activeInstance)] : undefined);
  let historyScopeKey = $derived(
    $activeInstance ? conversationScopeKey($activeInstance.projectId, $activeInstance.id) : '',
  );
  let historyInstanceList = $derived($instanceConversationsStore[historyScopeKey] ?? []);
  let activityKey = $derived(
    $activeInstance ? agentActivityKey($activeInstance.projectId, $activeInstance.id) : '',
  );
  let runningConversationIds = $derived($agentBusyConversations[activityKey] ?? []);
  let conversationBusy = $derived(!!current && runningConversationIds.includes(current.id));
  let doneConversationId = $derived($agentDoneConversation[activityKey] ?? null);
  let historyProjectList = $derived(
    $activeInstance ? ($projectConversationsStore[$activeInstance.projectId] ?? []) : [],
  );
  let currentProvider = $derived(
    selectableProviders.find((p) => p.id === current?.providerId)
      ?? selectableProviders.find((p) => p.id === $aiProviders.defaultProviderId)
      ?? selectableProviders[0],
  );
  let currentProviderDef = $derived(currentProvider ? providerById(currentProvider.id) : undefined);
  let modelOptions = $derived(
    currentProvider ? modelsOf(currentProvider.id, $providerCapabilities) : [],
  );

  function providerLabel(providerId: string): string {
    return PROVIDERS.find((p) => p.id === providerId)?.name ?? providerId;
  }

  /**
   * What the agent answered with, as the user names it: the model's own display
   * name when the provider gave one, a readable form of its id otherwise.
   */
  function modelLabel(providerId: string, modelId: string): string {
    const known = modelsOf(providerId, $providerCapabilities).find((m) => m.id === modelId);
    if (known && known.label !== known.id) return known.label;
    return prettyModelName(modelId);
  }

  let modelFamilies = $derived(groupModelFamilies(modelOptions));

  /** Models the user added by hand, offered next to the provider's families. */
  let customModels = $derived(
    currentProvider
      ? ($aiProviders.providers[currentProvider.id]?.customModels ?? [])
      : [],
  );

  /**
   * Who answered, and with what: "codd (Sonnet 4.6)". Without an agent the
   * model stands alone, and without a model the provider does.
   */
  function answerLabel(m: Message): string {
    const modelId = m.usage?.model || current?.modelId || '';
    const model = modelId
      ? modelLabel(currentProvider?.id ?? '', modelId)
      : (currentProvider?.name ?? (t('agent.agentRole') as string));
    return m.agentName ? `${m.agentName} (${model})` : model;
  }
  let effortOptions = $derived(
    effortsOf(currentProvider?.id ?? '', $providerCapabilities, current?.effort ?? ''),
  );
  let permissionOptions = $derived(
    permissionModesOf(currentProvider?.id ?? '', $providerCapabilities, current?.permissionMode ?? ''),
  );
  let supportsEffort = $derived(currentProviderDef?.supportsEffort ?? false);
  let supportsPermissionMode = $derived(currentProviderDef?.supportsPermissionMode ?? false);
  let lastUsage = $derived(
    current?.messages.findLast((m) => m.role === 'agent' && m.usage)?.usage,
  );
  /**
   * The whole prompt plus the answer: tokens freshly sent, tokens read from the
   * cache, and tokens written to it. Leaving the cache writes out understates a
   * first turn by everything it just put in context.
   */
  let contextTokens = $derived(
    lastUsage
      ? (lastUsage.inputTokens ?? 0)
        + (lastUsage.cacheReadTokens ?? 0)
        + (lastUsage.cacheCreationTokens ?? 0)
        + (lastUsage.outputTokens ?? 0)
      : 0,
  );
  /**
   * The provider's own figure first: Claude Code reports the window of the
   * model it actually used, which is the only thing that tells a 200k model
   * from its 1M variant. Cairn's table is the fallback, and when neither knows,
   * the chip shows tokens rather than a percentage measured against a guess.
   */
  let contextWindow = $derived(
    lastUsage?.contextWindow
      ?? contextWindowOf(currentProvider?.id ?? '', lastUsage?.model || current?.modelId || ''),
  );
  let contextPct = $derived(
    contextWindow ? Math.min(100, Math.round((contextTokens / contextWindow) * 100)) : null,
  );

  interface PopupEntry {
    kind: 'agent' | 'command' | 'file';
    label: string;
    detail?: string;
    color?: string;
    insert: string;
  }

  let slashCommands = $state<AgentSlashCommand[]>([]);
  let fileHits = $state<QuickSearchHit[]>([]);
  /** What the editor opened last here, offered before anything is typed. */
  let recentFiles = $state<string[]>([]);
  const RECENT_FILES_SHOWN = 4;
  let popupOpen = $state(false);
  let popupKind = $state<'agent' | 'command'>('agent');
  let popupIndex = $state(0);
  let popupEl = $state<HTMLElement | null>(null);
  let popupQuery = $state('');
  let popupItems = $derived.by((): PopupEntry[] => {
    const q = popupQuery.toLowerCase();
    if (popupKind === 'command') {
      // A namespaced entry (`plugin:name`, `dir:name`) is also reachable by the
      // part the user actually remembers, the one after the colon.
      // Every match, like the agent roster: a list cut short hides the command
      // the user opened it to find.
      return slashCommands
        .filter((c) => {
          const name = c.name.toLowerCase();
          return name.startsWith(q) || name.split(':').some((part) => part.startsWith(q));
        })
        .map((c) => ({
          kind: 'command' as const,
          label: `/${c.name}`,
          detail: c.description,
          insert: `/${c.name} `,
        }));
    }
    // Every agent, not a first few: `@` is where the user goes to see who they
    // can call, and a roster cut short hides the one they were looking for.
    const agents = agentRoster
      .filter((a) => a.name && mentionToken(a.name).toLowerCase().startsWith(q))
      .map((a) => ({
        kind: 'agent' as const,
        label: `@${mentionToken(a.name)}`,
        detail: a.description,
        color: a.color,
        insert: mentionInsert(a.name),
      }));
    // With nothing typed yet there is nothing to search for, so the files on
    // offer are the ones just worked on.
    const paths = q.length === 0
      ? recentFiles.slice(0, RECENT_FILES_SHOWN)
      : fileHits.filter((h) => !h.isDir).slice(0, 8).map((h) => h.path);
    const files = paths.map((path) => ({
      kind: 'file' as const,
      label: `@${path}`,
      insert: `@${path} `,
    }));
    return [...agents, ...files];
  });

  $effect(() => {
    const inst = $activeInstance;
    const open = popupOpen && popupKind === 'agent';
    const q = popupQuery;
    if (!inst || !open || q.length === 0) {
      fileHits = [];
      if (inst && open) {
        void getFileState(inst.projectId, inst.id).then((state) => {
          recentFiles = state?.recentFiles ?? [];
        });
      }
      return;
    }
    void quickSearch(inst.worktreePath, q, false, false, 10)
      .then((hits) => { fileHits = hits; })
      .catch(() => { fileHits = []; });
  });

  /**
   * The definitions this conversation can name: the ones of the project it
   * works in, plus the ones defined for the home directory.
   *
   * Empty on an API provider - a name in the prompt reaches nothing there,
   * since delegation is the CLI's, so the popup does not open at all rather
   * than completing something nobody consumes.
   */
  let agentRoster = $derived.by(() => {
    if (PROVIDERS.find((p) => p.id === current?.providerId)?.kind !== 'cli') return [];
    const inst = $activeInstance;
    return $nativeAgents.filter(
      (a) => a.scope === 'global' || (inst && a.projectId === inst.projectId),
    );
  });

  /**
   * What naming an agent leaves in the prompt. The CLI reads a bare `@name` as
   * a request for that subagent, so the mention is the text - it is not
   * consumed, not turned into a chip, and several of them in one prompt are
   * several agents asked for.
   */
  function mentionInsert(name: string): string {
    return `@${mentionToken(name)} `;
  }

  function refOf(inst: Instance, scope: ConversationScope): ConversationRef {
    return { projectId: inst.projectId, instanceId: inst.id, scope };
  }

  function defaultProviderId(): string {
    const stored = get(aiProviders).defaultProviderId;
    return selectableProviders.some((p) => p.id === stored)
      ? stored
      : (selectableProviders[0]?.id ?? PROVIDERS[0].id);
  }

  /**
   * A new session is only on screen: nothing is written until the first message
   * is sent, so opening one costs nothing and leaves no empty conversation
   * behind if the user changes their mind.
   */
  function startConversation(inst: Instance, scope: ConversationScope): Conversation {
    const conv: Conversation = {
      id: crypto.randomUUID(),
      scope,
      pending: true,
      messages: [],
      activity: [],
      draft: '',
      busy: false,
      error: '',
      providerId: defaultProviderId(),
      modelId: '',
      effort: '',
      permissionMode: '',
    };
    conversations[liveKey(inst)] = conv;
    // Nothing is selected while a session is a draft, so a restart comes back
    // to a new session instead of reopening whatever was open before it.
    selectConversation(inst.projectId, inst.id, null);
    return conv;
  }

  function ensureConversation(inst: Instance): Conversation {
    return conversations[liveKey(inst)] ?? startConversation(inst, 'instance');
  }

  function syncLive(inst: Instance) {
    const conv = conversations[liveKey(inst)];
    // A draft session has no entry in the index yet, so writing its body would
    // leave an orphan file for a conversation that may never exist.
    if (!conv || conv.pending) return;
    updateConversationContent(
      refOf(inst, conv.scope),
      conv.id,
      $state.snapshot(conv.messages),
      $state.snapshot(conv.activity),
    );
  }

  async function openConversation(inst: Instance, id: string, scope: ConversationScope) {
    const found = findConversation(inst.projectId, inst.id, id);
    if (!found) return;
    const previous = conversations[liveKey(inst)];
    if (previous) {
      syncLive(inst);
      drafts[previous.id] = previous.draft;
    }

    const found_run = runOfConversation(id);
    const run = found_run?.[1];
    const rejoining = !!run;

    let messages: Message[];
    let activity: ActivityEntry[];
    if (rejoining && run) {
      messages = run.messages;
      activity = run.activity;
    } else {
      loadingConversation = true;
      const body = await loadConversationBody(found.ref, id);
      loadingConversation = false;
      messages = body.messages;
      activity = body.activity;
    }

    conversations[liveKey(inst)] = {
      id: found.meta.id,
      scope,
      messages,
      activity,
      draft: drafts[found.meta.id] ?? '',
      busy: rejoining,
      error: '',
      providerId: found.meta.providerId || defaultProviderId(),
      modelId: found.meta.modelId ?? '',
      effort: found.meta.effort ?? '',
      permissionMode: found.meta.permissionMode ?? '',
      pending: false,
    };
    selectConversation(inst.projectId, inst.id, id);
    await autoscroll();
  }

  async function hydrate(inst: Instance) {
    void getFileState(inst.projectId, inst.id).then((state) => {
      recentFiles = state?.recentFiles ?? [];
    });
    await restoreConversations(inst.projectId, inst.id);
    await restoreAgentRuns(inst.projectId);
    if (conversations[liveKey(inst)]) return;

    const scopeKey = conversationScopeKey(inst.projectId, inst.id);
    const activeStoredId = get(activeConversationId)[scopeKey];
    const found = activeStoredId
      ? findConversation(inst.projectId, inst.id, activeStoredId)
      : null;

    if (found) {
      await openConversation(inst, found.meta.id, found.ref.scope);
    } else {
      startConversation(inst, 'instance');
    }
  }

  function instanceById(instanceId: string): Instance | undefined {
    return get(instancesWithBase).find((i) => i.id === instanceId);
  }

  function setBusy(inst: Instance, conversationId: string, busy: boolean) {
    const live = conversations[liveKey(inst)];
    if (live?.id === conversationId) live.busy = busy;
    setAgentBusy(inst.projectId, inst.id, busy, conversationId);
  }

  function persistRun(inst: Instance, run: Run) {
    updateConversationContent(
      refOf(inst, run.scope),
      run.conversationId,
      $state.snapshot(run.messages),
      $state.snapshot(run.activity),
    );
  }

  /**
   * Adds a piece of a turn where it happened, then writes the message the run
   * owns. Text and reasoning continue the block they extend; a tool call always
   * opens its own, so the order the turn worked in is the order it reads in.
   */
  function pushBlock(run: Run, block: AgentBlock) {
    const last = run.blocks[run.blocks.length - 1];
    if (block.kind !== 'tool' && last?.kind === block.kind) last.text += block.text;
    else run.blocks.push(block);
    if (block.kind === 'thinking') run.thinking += block.text;
    commitAnswer(run);
  }

  function closeTool(run: Run, failed: boolean, toolUseId = '') {
    closeToolBlock(run.blocks, failed, toolUseId);
    commitAnswer(run);
  }

  /**
   * Rewrites the run's message from what it has written. The element is
   * assigned back rather than mutated in place, and a message that went missing
   * - a conversation reloaded under a run still in flight - is created again
   * instead of silently swallowing everything that follows.
   */
  function commitAnswer(run: Run, fields: Partial<Message> = {}) {
    if (run.answerIndex < 0 || !run.messages[run.answerIndex]) {
      run.messages.push({ role: 'agent', content: '', ts: now(), streaming: true });
      run.answerIndex = run.messages.length - 1;
    }
    run.messages[run.answerIndex] = {
      ...run.messages[run.answerIndex],
      blocks: [...run.blocks],
      thinking: run.thinking || undefined,
      // The answer is the last thing written, not everything written: the notes
      // between two tool calls belong to the turn, not to the reply.
      content: lastTextOf(run.blocks),
      ...fields,
    };
  }

  /**
   * Ends the run's message, and closes whatever tool was still open: a run that
   * was stopped mid-tool would otherwise show it spinning for ever.
   */
  function endStreaming(run: Run) {
    if (run.answerIndex < 0) return;
    // A run stopped mid-tool never gets its result, and the line would spin on.
    // A delegation left open is the same: the provider died with it.
    for (const block of run.blocks) {
      if ((block.kind === 'tool' || block.kind === 'agent') && !block.done) block.done = true;
    }
    commitAnswer(run, { streaming: false });
  }

  function isViewingAgent(inst: Instance): boolean {
    return inst.id === $activeInstance?.id && $activeStep === 'agent' && !$terminalActive && !$commandsActive;
  }

  function notifyAgentCompletion(inst: Instance, conversationId: string) {
    if (isViewingAgent(inst) && conversations[liveKey(inst)]?.id === conversationId) return;
    setAgentDone(inst.projectId, inst.id, true, conversationId);
    pingAgentCompletion();
  }

  $effect(() => {
    const inst = $activeInstance;
    const openId = inst ? conversations[liveKey(inst)]?.id : undefined;
    if (!inst || $activeStep !== 'agent' || $terminalActive || $commandsActive) return;
    const pending = doneConversationOf(inst.projectId, inst.id);
    if (pending === null) return;
    if (pending === '' || pending === openId) {
      setAgentDone(inst.projectId, inst.id, false);
    }
  });

  function resizeTextarea() {
    if (!textareaEl) return;
    textareaEl.style.height = 'auto';
    textareaEl.style.height = textareaEl.scrollHeight + 'px';
  }

  const locale = getLocale();

  function now(): number {
    return Date.now();
  }

  function iconForTool(tool?: string): string {
    switch ((tool ?? '').toLowerCase()) {
      case 'read': return 'file';
      case 'write':
      case 'edit':
      case 'multiedit': return 'edit';
      case 'bash': return 'terminal';
      case 'grep':
      case 'glob': return 'search';
      default: return 'zap';
    }
  }

  async function copyText(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      copiedKey = key;
      setTimeout(() => { if (copiedKey === key) copiedKey = null; }, 1500);
    } catch {}
  }

  function startActivityResize(e: PointerEvent) {
    isActivityResizing = true;
    resizeStartX = e.clientX;
    resizeStartWidth = activityWidth;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onActivityResizeMove(e: PointerEvent) {
    if (!isActivityResizing) return;
    const delta = resizeStartX - e.clientX;
    activityWidth = Math.max(240, Math.min(640, resizeStartWidth + delta));
  }

  function stopActivityResize() {
    if (!isActivityResizing) return;
    isActivityResizing = false;
    settings.save({ agentActivityWidth: Math.round(activityWidth) });
  }

  async function autoscroll() {
    await tick();
    if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
    if (activityEl && get(settings).agentActivityAutoScroll) {
      activityEl.scrollTop = activityEl.scrollHeight;
    }
  }

  let chipOpen = $state<'' | 'provider' | 'model' | 'effort' | 'perm' | 'stats'>('');

  function onWindowClick() {
    if (chipOpen) chipOpen = '';
  }

  interface ModelStats {
    inTok: number;
    outTok: number;
    cost: number;
  }

  /**
   * What this conversation cost, by model and by agent. An agent runs in its
   * own process but on the user's own quota, so its turns are counted here like
   * any other - and listed under its name, since that is the cost the user can
   * actually act on.
   */
  let sessionStats = $derived.by(() => {
    const models: Record<string, ModelStats> = {};
    const agents: Record<string, ModelStats> = {};
    let cost = 0;
    let inTok = 0;
    let outTok = 0;
    let any = false;
    for (const m of current?.messages ?? []) {
      const u = m.usage;
      if (!u) continue;
      any = true;
      const i = (u.inputTokens ?? 0) + (u.cacheReadTokens ?? 0);
      const o = u.outputTokens ?? 0;
      const c = u.costUsd ?? 0;
      const buckets = [models[u.model ?? '?'] ??= { inTok: 0, outTok: 0, cost: 0 }];
      if (m.agentRunId && m.agentName) {
        buckets.push(agents[m.agentName] ??= { inTok: 0, outTok: 0, cost: 0 });
      }
      for (const entry of buckets) {
        entry.inTok += i;
        entry.outTok += o;
        entry.cost += c;
      }
      inTok += i;
      outTok += o;
      cost += c;
    }
    return any ? { models, agents, cost, inTok, outTok } : null;
  });

  /**
   * The session the view is on. A draft has no name yet, and saying so beats
   * showing a placeholder title that is not in any list.
   */
  let paneTitle = $derived.by(() => {
    if (!current || current.pending) return t('agent.newSessionTitle') as string;
    const inst = $activeInstance;
    const meta = inst ? findConversation(inst.projectId, inst.id, current.id)?.meta : null;
    return meta?.title || (t('agent.newSessionTitle') as string);
  });

  /**
   * What a tool line does not need to repeat: the user is inside this worktree,
   * and its path is the same on every single line.
   */
  let pathRoots = $derived(
    $activeInstance
      ? [$activeInstance.worktreePath, $activeProject?.path ?? ''].filter(Boolean)
      : [],
  );

  let activityEntries = $derived(current?.activity ?? []);

  /**
   * Which message each activity entry belongs to. A prompt entry points at the
   * message it carries; everything the agent did afterwards points at the answer
   * that turn produced, so clicking a tool call lands on the reply it served.
   */
  let activityTargets = $derived.by(() => {
    const messages = current?.messages ?? [];
    const promptIndexes = messages.flatMap((m, i) => (m.role === 'user' ? [i] : []));
    const targets: number[] = [];
    let turnPrompt = -1;
    let turnAnswer = -1;
    let promptsSeen = 0;
    for (const entry of activityEntries) {
      if (entry.source === 'stdin') {
        turnPrompt = promptIndexes[promptsSeen] ?? -1;
        promptsSeen += 1;
        turnAnswer = messages.findIndex((m, i) => i > turnPrompt && m.role === 'agent');
        targets.push(turnPrompt);
      } else {
        targets.push(turnAnswer >= 0 ? turnAnswer : turnPrompt);
      }
    }
    return targets;
  });

  let flashedMessage = $state(-1);
  let flashTimer: ReturnType<typeof setTimeout> | null = null;

  /** A line that names its own message goes there; the rest follow their turn. */
  function activateActivity(entry: ActivityEntry, target: number) {
    revealMessage(entry.messageIndex ?? target);
  }

  function revealMessage(index: number) {
    if (index < 0 || !scrollEl) return;
    const target = scrollEl.querySelector<HTMLElement>(`[data-msg="${index}"]`);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    flashedMessage = index;
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { flashedMessage = -1; }, 1200);
  }
  let runningCount = $derived(
    conversationBusy
      ? activityEntries.filter((e) => e.source === 'tool' && !e.done && !e.failed).length
      : 0,
  );

  function fmtTokens(n: number): string {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
  }

  $effect(() => {
    const inst = $activeInstance;
    if (!inst) return;
    if (!untrack(() => conversations[liveKey(inst)])) void hydrate(inst);
    tick().then(resizeTextarea);
  });

  interface UsagePayload {
    model?: string;
    contextWindow?: number;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
    totalCostUsd?: number;
    durationMs?: number;
    numTurns?: number;
  }

  /**
   * A subagent the provider just started. It becomes a run of its own, of the
   * same kind the panel and the thread view already draw, and is reachable by
   * both the ids the stream uses: `tool_use_id` tags the events it produces,
   * `task_id` tags its status and its result.
   */
  function openThread(
    inst: Instance,
    run: Run,
    runId: string,
    data: Record<string, unknown> | undefined,
  ) {
    const toolUseId = String(data?.toolUseId ?? '');
    const taskId = String(data?.taskId ?? '');
    if (!toolUseId && !taskId) return;

    const name = String(data?.subagentType ?? '') || (t('agents.unnamedSubagent') as string);
    const threadId = `${runId}:${taskId || toolUseId}`;
    // A subagent the model invented for one task has no definition on disk. It
    // still gets a thread, in a neutral colour rather than none.
    const known = $nativeAgents.find((a) => mentionToken(a.name) === mentionToken(name));

    if (toolUseId) run.subagents[toolUseId] = threadId;
    if (taskId) run.subagents[taskId] = threadId;

    openDelegation(run.blocks, {
      toolUseId,
      name,
      color: known?.color || 'var(--accent)',
      agentRunId: threadId,
    });
    commitAnswer(run);

    addAgentRun(inst.projectId, {
      id: threadId,
      agentId: name,
      agentName: name,
      color: known?.color || 'var(--accent)',
      icon: 'sparkles',
      instanceId: inst.id,
      instanceName: inst.ticket.title,
      conversationId: run.conversationId,
      conversationTitle: conversationTitleOf(inst, run.conversationId),
      scope: run.scope,
      providerId: run.providerId,
      model: '',
      workingDir: run.workingDir,
      prompt: String(data?.prompt ?? data?.description ?? ''),
      startedAt: Date.now(),
      endedAt: null,
      status: 'running',
      result: '',
      thinking: '',
      blocks: [],
      usage: null,
      error: '',
    });
  }

  /** What a subagent produced, on its own thread rather than in the conversation. */
  function routeToThread(
    inst: Instance,
    threadId: string,
    source: string,
    line: string,
    summary: string | undefined,
    data: Record<string, unknown> | undefined,
  ) {
    if (source === 'assistant') {
      appendAgentBlock(inst.projectId, threadId, { kind: 'text', text: line });
    } else if (source === 'thinking') {
      appendAgentBlock(inst.projectId, threadId, {
        kind: 'thinking',
        text: String(data?.text ?? ''),
      });
    } else if (source === 'tool') {
      appendAgentBlock(inst.projectId, threadId, {
        kind: 'tool',
        text: line,
        icon: iconForTool(summary),
        done: false,
      });
    } else if (source === 'tool_result') {
      finishAgentToolBlock(inst.projectId, threadId, data?.isError === true);
    }
  }

  /**
   * The delegation returned. `task_notification` carries the summary and the
   * usage, so the thread is closed from it rather than from the tool result -
   * the answer and what it cost arrive together.
   */
  function finishThread(inst: Instance, run: Run, data: Record<string, unknown> | undefined) {
    const threadId = run.subagents[String(data?.taskId ?? '')];
    if (!threadId) return;
    closeAgentToolBlocks(inst.projectId, threadId);
    clearAgentPermission(threadId);

    const usage = data?.usage as { total_tokens?: number; duration_ms?: number } | undefined;
    const failed = String(data?.status ?? '') !== 'completed';
    const result = String(data?.summary ?? '');
    patchAgentRun(inst.projectId, threadId, {
      status: failed ? 'error' : 'done',
      endedAt: Date.now(),
      result,
      usage: usage
        ? { outputTokens: usage.total_tokens, durationMs: usage.duration_ms }
        : null,
    });

    if (closeDelegation(run.blocks, threadId, { result, failed })) commitAnswer(run);
  }

  /**
   * A run ending takes its subagents with it: the provider owns their
   * lifetime, so one that never reported a result never will.
   */
  function closeOpenThreads(inst: Instance, run: Run, reason: 'done' | 'stopped') {
    for (const threadId of new Set(Object.values(run.subagents))) {
      const thread = findAgentRun(threadId);
      if (!thread || !isInFlight(thread.status)) continue;
      closeAgentToolBlocks(inst.projectId, threadId);
      clearAgentPermission(threadId);
      patchAgentRun(inst.projectId, threadId, {
        status: reason === 'stopped' ? 'stopped' : 'interrupted',
        endedAt: Date.now(),
      });
    }
  }

  onMount(async () => {
    void loadAiProviders();
    // The composer completes from these, so they cannot wait for the Agents
    // section to be opened first.
    void loadNativeAgents();
    unlisten = await listen<{
      line: string;
      source: string;
      summary?: string;
      workingDir?: string;
      runId?: string;
      data?: Record<string, unknown>;
      agent?: string;
      toolId?: string;
    }>('claude-output', (e) => {
      const { source, line, summary, runId, data, agent, toolId } = e.payload;
      if (!runId) return;

      const run = runs[runId];
      if (!run) return;

      const inst = instanceById(run.instanceId);
      if (!inst) return;

      const live = conversations[liveKey(inst)];
      const isLive = live?.id === run.conversationId;

      // Produced inside a subagent the provider started: it belongs to that
      // thread, not to the conversation, which only ever sees the answer the
      // subagent hands back.
      const threadId = agent ? run.subagents[agent] : undefined;
      if (threadId) {
        routeToThread(inst, threadId, source, line, summary, data);
        return;
      }

      if (source === 'system') {
        if (line === '[done]') {
          clearRunPermission(run, runId);
          endStreaming(run);
          closeOpenThreads(inst, run, 'done');
          setBusy(inst, run.conversationId, false);
          notifyAgentCompletion(inst, run.conversationId);
          persistRun(inst, run);
          delete runs[runId];
          void flushQueued(inst, run.conversationId);
          return;
        }
        if (line === '[session stopped]') {
          clearRunPermission(run, runId);
          endStreaming(run);
          // The provider owns a subagent's lifetime: killing the run kills
          // whatever it had started, so their threads stop with it.
          closeOpenThreads(inst, run, 'stopped');
          setBusy(inst, run.conversationId, false);
          persistRun(inst, run);
          delete runs[runId];
          // Interrupting is a decision about what comes next, so what was
          // waiting goes back to the composer instead of leaving on its own.
          returnQueued(inst, run.conversationId);
          return;
        }
        if (line.startsWith('[error:')) {
          reportRunError(inst, run, runId, line, isLive ? live : undefined);
        }
      } else if (source === 'error') {
        const message = String(data?.message ?? 'Unknown error');
        reportRunError(inst, run, runId, message, isLive ? live : undefined);
      } else if (source === 'usage') {
        const payload = data as UsagePayload;
        const usage: MessageUsage = {
          model: payload?.model,
          inputTokens: payload?.usage?.input_tokens,
          outputTokens: payload?.usage?.output_tokens,
          cacheReadTokens: payload?.usage?.cache_read_input_tokens,
          cacheCreationTokens: payload?.usage?.cache_creation_input_tokens,
          contextWindow: payload?.contextWindow ?? undefined,
          costUsd: payload?.totalCostUsd,
          durationMs: payload?.durationMs,
          numTurns: payload?.numTurns,
        };
        commitAnswer(run, { usage });
        recordTurnUsage(inst, run, runId, usage);
      } else if (source === 'thinking') {
        pushBlock(run, { kind: 'thinking', text: String(data?.text ?? '') });
      } else if (source === 'tool_result') {
        const pending = run.activity.find((a) => a.source === 'tool' && !a.done);
        if (pending) {
          pending.done = true;
          pending.failed = data?.isError === true;
        }
        closeTool(run, data?.isError === true, String(data?.toolUseId ?? ''));
      } else if (source === 'permission_request') {
        const request: PermissionRequest = {
          runId,
          requestId: String(data?.requestId ?? ''),
          toolName: String(data?.toolName ?? 'tool'),
          displayName: data?.displayName ? String(data.displayName) : undefined,
          input: (data?.input as Record<string, unknown>) ?? {},
          description: data?.description ? String(data.description) : undefined,
          suggestions: Array.isArray(data?.suggestions) ? data.suggestions : undefined,
        };
        // A request raised inside a subagent is answered from its own thread:
        // the card in the conversation could not say who was asking.
        const askingThread = data?.toolUseId ? run.subagents[String(data.toolUseId)] : undefined;
        if (askingThread) {
          setAgentPermission(askingThread, request);
          patchAgentRun(inst.projectId, askingThread, { status: 'awaiting-permission' });
        } else {
          permissions[run.conversationId] = request;
        }
      } else if (source === 'rate_limit') {
        rateLimit = data as RateLimitInfo;
        return;
      } else if (source === 'agent_start') {
        openThread(inst, run, runId, data);
        return;
      } else if (source === 'agent_status') {
        const thread = run.subagents[String(data?.taskId ?? '')];
        if (thread && String(data?.status ?? '') === 'in_progress') {
          patchAgentRun(inst.projectId, thread, { status: 'running' });
        }
        return;
      } else if (source === 'agent_result') {
        finishThread(inst, run, data);
        return;
      } else if (source === 'init') {
        // reserved: model and tool inventory of the run
      } else if (source === 'assistant') {
        pushBlock(run, { kind: 'text', text: line });
      } else if (source === 'tool') {
        // Tools run sequentially: a new tool means the previous one finished.
        const pending = run.activity.find((a) => a.source === 'tool' && !a.done);
        if (pending) pending.done = true;
        run.activity.push({ ts: now(), icon: iconForTool(summary), label: line, source: 'tool' });
        pushBlock(run, { kind: 'tool', text: line, icon: iconForTool(summary), done: false, toolId });
      } else if (source === 'session') {
        setConversationSession(refOf(inst, run.scope), run.conversationId, run.providerId, line);
      }

      persistRun(inst, run);
      if (isLive) autoscroll();
    });

    await autoscroll();
  });

  onDestroy(() => {
    unlisten?.();
  });

  function buildRunOptions(conv: Conversation, providerId: string): RunOptions {
    const options: RunOptions = {};
    if (conv.modelId) options.model = conv.modelId;
    if (conv.effort) options.effort = conv.effort;
    if (conv.permissionMode) options.permissionMode = conv.permissionMode;

    // A chat API keeps nothing between calls, and neither does a CLI with no
    // session to resume, so every prior turn is resent. `conv.messages` holds
    // only what was already exchanged here - the prompt being sent now is
    // pushed after this, and travels as the message itself.
    const def = PROVIDERS.find((p) => p.id === providerId);
    if (def?.kind === 'api' || def?.keepsSession === false) {
      options.history = priorTurns(conv.messages)
        .map((m) => ({ role: m.role, content: m.content }));
    }
    return options;
  }

  let pendingPermission = $derived(current ? permissions[current.id] : undefined);
  let permissionIsPlan = $derived(pendingPermission?.toolName === 'ExitPlanMode');
  let permissionPreview = $derived.by(() => {
    const req = pendingPermission;
    if (!req) return '';
    const input = req.input;
    const value = input.command ?? input.file_path ?? input.path ?? input.url ?? input.pattern;
    return typeof value === 'string' ? value : '';
  });

  function quotaResetLabel(resetsAt: number): string {
    const time = new Date(resetsAt * 1000).toLocaleTimeString(getLocale(), {
      hour: '2-digit',
      minute: '2-digit',
    });
    return (t('agent.quota.resets') as (time: string) => string)(time);
  }

  async function answerPermission(decision: 'allow' | 'always' | 'deny') {
    if (pendingPermission) await answerRunPermission(pendingPermission, decision);
  }

  /**
   * Answers one pending request, wherever it was raised. An agent's request can
   * be settled from the Agents view or from the conversation that called it -
   * the same request, shown twice.
   */
  async function answerRunPermission(
    req: PermissionRequest,
    decision: 'allow' | 'always' | 'deny',
  ) {
    const run = runs[req.runId];
    clearAgentPermission(req.runId);
    const convId = run?.conversationId ?? current?.id;
    if (convId && permissions[convId]?.requestId === req.requestId) delete permissions[convId];

    const response = buildPermissionResponse(
      req, decision, t('agent.permission.denied') as string,
    );

    const entry: ActivityEntry = {
      ts: now(),
      icon: 'shield',
      label: `${req.displayName ?? req.toolName}: ${decision === 'deny' ? (t('agent.permission.deny') as string) : (t('agent.permission.allow') as string)}`,
      source: 'system',
      done: true,
      failed: decision === 'deny',
    };
    if (run) {
      run.activity.push(entry);
      // The decision belongs to the turn it unblocked, so it reads in place.
      const block = { kind: 'tool' as const, text: entry.label, icon: 'shield', done: true };
      pushBlock(run, block);
    } else current?.activity.push(entry);

    try {
      await respondPermission(req.runId, req.requestId, response);
    } catch (e) {
      if (current) current.error = String(e);
    }
  }

  /**
   * Sends what was written while the last answer was still coming. One at a
   * time: each takes the place of the run that just ended, and the next leaves
   * when that one lands.
   */
  async function flushQueued(inst: Instance, conversationId: string) {
    const waiting = queued[conversationId] ?? [];
    if (waiting.length === 0 || runOfConversation(conversationId)) return;

    // Not the conversation on screen: it has no live state to send through, so
    // what was written for it waits there until it is opened again rather than
    // being dropped or sent into whatever took its place.
    const conv = conversations[liveKey(inst)];
    if (conv?.id !== conversationId) return;

    // The run that just ended failed. Sending the next one into it would bury
    // the error under another answer, so what was waiting goes back instead.
    if (conv.error) {
      returnQueued(inst, conversationId);
      return;
    }

    const [next, ...rest] = waiting;
    queued[conversationId] = rest;
    await sendPrompt(inst, conv, next);
  }

  /**
   * A conversation reopened, or one that has just gone quiet, sends what was
   * left waiting for it. This is what carries a queue across a switch away and
   * back, since nothing else runs for a conversation nobody is looking at.
   */
  $effect(() => {
    const inst = $activeInstance;
    const conv = inst ? conversations[liveKey(inst)] : undefined;
    if (!inst || !conv || conversationBusy) return;
    if ((queued[conv.id]?.length ?? 0) > 0) void flushQueued(inst, conv.id);
  });

  /** Puts what was waiting back where it was written, newest last. */
  function returnQueued(inst: Instance, conversationId: string) {
    const waiting = queued[conversationId] ?? [];
    if (waiting.length === 0) return;
    delete queued[conversationId];
    const conv = conversations[liveKey(inst)];
    if (!conv || conv.id !== conversationId) return;
    conv.draft = mergeIntoDraft(waiting, conv.draft);
    drafts[conv.id] = conv.draft;
    void tick().then(resizeTextarea);
  }

  function unqueue(conversationId: string, index: number) {
    const waiting = [...(queued[conversationId] ?? [])];
    const [removed] = waiting.splice(index, 1);
    queued[conversationId] = waiting;
    const conv = $activeInstance ? conversations[liveKey($activeInstance)] : undefined;
    if (!conv || conv.id !== conversationId || !removed) return;
    conv.draft = mergeIntoDraft([removed], conv.draft);
    drafts[conv.id] = conv.draft;
    void tick().then(resizeTextarea);
  }

  async function retry() {
    const inst = $activeInstance;
    if (!inst || !current || runOfConversation(current.id)) return;
    const lastPrompt = current.messages.findLast((m) => m.role === 'user')?.content;
    if (!lastPrompt) return;
    current.error = '';
    await sendPrompt(inst, current, lastPrompt);
  }

  async function send() {
    const inst = $activeInstance;
    if (!inst) return;
    const conv = ensureConversation(inst);

    const message = conv.draft.trim();
    if (!message) return;

    conv.draft = '';
    drafts[conv.id] = '';
    popupOpen = false;
    await tick();
    resizeTextarea();

    // This conversation is still answering. The prompt waits its turn rather
    // than being refused - a conversation that is busy is not a conversation
    // with nothing to say to it.
    if (runOfConversation(conv.id)) {
      queued[conv.id] = [...(queued[conv.id] ?? []), message];
      return;
    }

    conv.error = '';
    await sendPrompt(inst, conv, message);
  }

  /**
   * Writes a draft session down, keeping its id: a real conversation appears in
   * the instance list at the moment it is first used, not before.
   */
  function materialise(inst: Instance, conv: Conversation) {
    if (!conv.pending) return;
    conv.pending = false;
    createStoredConversation(
      refOf(inst, conv.scope),
      conv.providerId,
      t('agent.history.untitled') as string,
      conv.id,
    );
    setConversationRunOptions(refOf(inst, conv.scope), conv.id, {
      modelId: conv.modelId || null,
      effort: conv.effort || null,
      permissionMode: conv.permissionMode || null,
    });
  }

  async function sendPrompt(inst: Instance, conv: Conversation, message: string) {
    materialise(inst, conv);
    const runProviderId = currentProvider?.id ?? conv.providerId;
    const ref0 = refOf(inst, conv.scope);
    const sessionId = conversationSession(ref0, conv.id, runProviderId);
    // The provider changing is the signal, not the absence of a session: a chat
    // API never mints one, so "no session" would fire on every single message.
    const previousProvider = lastProviderOf(ref0, conv.id);
    const takingOver = previousProvider !== '' && previousProvider !== runProviderId;
    setLastProvider(ref0, conv.id, runProviderId);
    const options = buildRunOptions(conv, runProviderId);

    const t_now = now();
    if (takingOver) {
      conv.messages.push({
        role: 'system',
        content: (t('agent.providerSwitched') as (p: string) => string)(providerLabel(runProviderId)),
        ts: t_now,
      });
    }
    conv.messages.push({ role: 'user', content: message, ts: t_now });
    conv.messages.push({ role: 'agent', content: '', ts: t_now, streaming: true });
    const answerIndex = conv.messages.length - 1;
    conv.activity.push({ ts: t_now, icon: 'send', label: message.slice(0, 160) + (message.length > 160 ? '...' : ''), source: 'stdin' });

    const runId = crypto.randomUUID();
    const run: Run = {
      instanceId: inst.id,
      conversationId: conv.id,
      scope: conv.scope,
      messages: conv.messages,
      activity: conv.activity,
      providerId: runProviderId,
      projectId: inst.projectId,
      workingDir: inst.worktreePath,
      answerIndex,
      blocks: [],
      thinking: '',
      subagents: {},
    };
    runs[runId] = run;
    setBusy(inst, conv.id, true);

    const ref = refOf(inst, conv.scope);
    const isFirstPrompt = conv.messages.filter((m) => m.role === 'user').length === 1;
    if (isFirstPrompt) renameConversation(ref, conv.id, deriveConversationTitle(message));
    syncLive(inst);

    await autoscroll();

    try {
      const env = await prepareInstanceEnv(get(activeProject), inst);
      // Whoever receives the exchange as `history` already has it; the CLIs
      // that resume their own session have no channel for it but the prompt.
      const def = PROVIDERS.find((p) => p.id === runProviderId);
      const needsHandoff = def?.kind === 'cli' && def.keepsSession !== false;
      const prompt = takingOver && needsHandoff
        ? withHandoffContext(message, buildHandoffTranscript(conv.messages.slice(0, -2)))
        : message;

      await sendMessage(prompt, inst.worktreePath, runProviderId, runId, sessionId, env, options);
    } catch (e) {
      conv.error = String(e);
      setBusy(inst, conv.id, false);
      endStreaming(run);
      persistRun(inst, run);
      delete runs[runId];
    }
  }

  /**
   * A subagent's answer must not read like the provider's own. It carries the
   * agent's colour and name, and a way back to the thread behind it.
   */
  function agentOf(m: Message): AgentRun | undefined {
    return m.agentRunId ? (findAgentRun(m.agentRunId) ?? undefined) : undefined;
  }

  /** The colour of the agent an activity line belongs to. */
  function activityColorOf(entry: ActivityEntry): string {
    const run = entry.agentRunId ? findAgentRun(entry.agentRunId) : undefined;
    return run?.color || 'var(--accent)';
  }

  function agentColorOf(m: Message): string {
    return agentOf(m)?.color ?? 'var(--accent)';
  }

  function agentIconOf(m: Message): string {
    return agentOf(m)?.icon || 'sparkles';
  }

  /** The "see its full work" link on an answer opens that agent's thread. */
  function enterAgentFromMessage(m: Message) {
    const agentId = m.agentRunId ? findAgentRun(m.agentRunId)?.agentId : undefined;
    if (agentId) enterAgent(agentId);
  }

  /** Entering an agent from the block that delegated to it. */
  function openThreadOf(agentRunId: string) {
    const run = findAgentRun(agentRunId);
    if (run) openAgentId.set(run.agentId);
  }

  /** Entering an agent from its answer: the same gesture as opening it in the list. */
  function enterAgent(agentId: string) {
    openAgentId.set(agentId);
  }

  /**
   * A subagent belongs to the conversation whose run started it, so the panel
   * lists the agents of *this* conversation - one entry per agent, not one per
   * run, since the same agent delegated to twice is one thread.
   */
  let conversationThreads = $derived(
    $activeInstance && current && $agentRuns
      ? agentThreadsOf($activeInstance.projectId, current.id)
      : [],
  );

  /** The agents of this conversation that cannot go on without an answer. */
  let agentsAwaitingPermission = $derived(
    conversationThreads.filter((th) =>
      th.runs.some((r) => $agentPermissionRequests[r.id]),
    ),
  );

  let openThreadRuns = $derived(
    $activeInstance && current && $openAgentId && $agentRuns
      ? agentThreadRuns($activeInstance.projectId, current.id, $openAgentId)
      : [],
  );

  /**
   * Reading the conversation list through the stores, not just once: the reset
   * mark has to appear the moment the thread is reset, not on the next visit.
   */
  /**
   * Making an agent forget: its sessions go, and the conversation is resynced
   * from now on, so its next prompt starts from nothing. What it already
   * answered stays - in the conversation, and in its own thread above the mark.
   */
  let deletingAgentId = $state('');
  let deletingAgentName = $derived(
    conversationThreads.find((th) => th.agentId === deletingAgentId)?.latest.agentName ?? '',
  );

  /**
   * Removing an agent from the panel: the runs it did here go. What it answered
   * stays in the conversation, which is the record the user reads.
   */
  function deleteAgentFromPanel(agentId: string) {
    const inst = $activeInstance;
    if (!inst || !current) return;
    if ($openAgentId === agentId) openAgentId.set('');
    deleteAgentThread(inst.projectId, current.id, agentId);
  }


  /**
   * Leaving an agent whose thread is not in this conversation: an agent is
   * scoped to one conversation, so switching conversation leaves it behind.
   */
  $effect(() => {
    if ($openAgentId && openThreadRuns.length === 0) openAgentId.set('');
  });


  function truncate(text: string, max = 160): string {
    const line = text.trim().split('\n')[0];
    return line.length > max ? `${line.slice(0, max)}...` : line;
  }

  /**
   * Hands a finished turn to the usage ledger. This is the one place every
   * provider reports what it consumed, so it is the only place that has to know
   * the ledger exists; the entry carries its own labels because the stats page
   * has to keep reading correctly after a project or a conversation is gone.
   */
  function recordTurnUsage(inst: Instance, run: Run, runId: string, usage: MessageUsage) {
    recordUsage({
      id: runId,
      ts: Date.now(),
      projectId: inst.projectId,
      projectName: get(projects).find((p) => p.id === inst.projectId)?.name ?? '',
      instanceId: inst.id,
      instanceName: inst.ticket.title,
      conversationId: run.conversationId,
      conversationTitle: conversationTitleOf(inst, run.conversationId),
      scope: run.scope,
      providerId: run.providerId,
      model: usage.model ?? '',
      // Never set any more: a turn is the conversation talking to its provider,
      // and a subagent's cost is reported on its own run. The fields stay so the
      // entries written when Cairn ran agents itself keep their label.
      agentId: '',
      agentName: '',
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      cacheReadTokens: usage.cacheReadTokens ?? 0,
      cacheCreationTokens: usage.cacheCreationTokens ?? 0,
      costUsd: usage.costUsd ?? 0,
      durationMs: usage.durationMs ?? 0,
      numTurns: usage.numTurns ?? 0,
      backfilled: false,
    });
  }

  function conversationTitleOf(inst: Instance, conversationId: string): string {
    const found = findConversation(inst.projectId, inst.id, conversationId);
    return found?.meta.title ?? '';
  }

  /**
   * Drops the request this run had pending, and only that one: a conversation
   * and the agents it launched share the inline slot, so an agent finishing
   * must not swallow a question the conversation itself is asking.
   */
  function clearRunPermission(run: Run, runId: string) {
    clearAgentPermission(runId);
    if (permissions[run.conversationId]?.runId === runId) {
      delete permissions[run.conversationId];
    }
  }

  /**
   * An error is recorded, never terminal on its own: the provider still sends
   * `[done]` afterwards, and that is what releases the worktree.
   */
  function reportRunError(
    inst: Instance,
    run: Run,
    runId: string,
    message: string,
    live: Conversation | undefined,
  ) {
    run.activity.push({ ts: now(), icon: 'alert', label: message, source: 'system' });
    if (live) live.error = message.startsWith('[error:') ? message.slice(8, -1) : message;
    setBusy(inst, run.conversationId, false);
    notifyAgentCompletion(inst, run.conversationId);
    endStreaming(run);
  }

  async function interrupt() {
    if (!current) return;
    const running = runOfConversation(current.id);
    if (!running) return;
    try {
      await stopAgent(running[0]);
    } catch (e) {
      current.error = String(e);
    }
  }

  async function newSession(scope: ConversationScope = 'instance') {
    const inst = $activeInstance;
    if (!inst) return;
    const previous = conversations[liveKey(inst)];
    if (previous) {
      syncLive(inst);
      drafts[previous.id] = previous.draft;
    }

    startConversation(inst, scope);
    await autoscroll();
  }

  function pickProvider(providerId: string) {
    const inst = $activeInstance;
    if (!inst || !current) return;
    current.providerId = providerId;
    current.modelId = '';
    setConversationProvider(refOf(inst, current.scope), current.id, providerId);
    setConversationRunOptions(refOf(inst, current.scope), current.id, { modelId: '' });
    void refreshProviderModels(providerId);
  }

  function pickRunOption(field: 'modelId' | 'effort' | 'permissionMode', value: string) {
    const inst = $activeInstance;
    if (!inst || !current) return;
    current[field] = value;
    setConversationRunOptions(refOf(inst, current.scope), current.id, { [field]: value });
  }

  function loadSlashCommands() {
    const inst = $activeInstance;
    if (!inst) return;
    void listAgentCommands(inst.worktreePath)
      .then((cmds) => { slashCommands = cmds; })
      .catch(() => { slashCommands = []; });
  }

  $effect(() => {
    if ($activeInstance) loadSlashCommands();
  });

  function updatePopup() {
    if (!textareaEl || !current) { popupOpen = false; return; }
    const caret = textareaEl.selectionStart ?? 0;
    const before = current.draft.slice(0, caret);

    const slash = before.match(/(?:^|\s)\/([\w:-]*)$/);
    if (slash) {
      // A command file written while the app was open must show up here.
      if (!popupOpen || popupKind !== 'command') loadSlashCommands();
      popupKind = 'command';
      popupQuery = slash[1];
      popupIndex = 0;
      popupOpen = true;
      return;
    }

    const at = before.match(/(?:^|\s)@([\w-]*)$/);
    if (at) {
      popupKind = 'agent';
      popupQuery = at[1];
      popupIndex = 0;
      popupOpen = true;
      return;
    }

    popupOpen = false;
  }

  function insertPopupItem(index: number) {
    if (!textareaEl || !current) return;
    const item = popupItems[index];
    if (!item) return;
    const caret = textareaEl.selectionStart ?? 0;
    const before = current.draft.slice(0, caret);
    const after = current.draft.slice(caret);
    const start = popupKind === 'command' ? before.lastIndexOf('/') : before.lastIndexOf('@');

    const token = item.insert;
    current.draft = before.slice(0, start) + token + after;
    popupOpen = false;
    tick().then(() => {
      textareaEl?.focus();
      const pos = start + token.length;
      textareaEl?.setSelectionRange(pos, pos);
      resizeTextarea();
    });
  }

  function onInput() {
    resizeTextarea();
    updatePopup();
  }

  function withInstance<A extends unknown[]>(fn: (inst: Instance, ...args: A) => void) {
    return (...args: A) => {
      const inst = $activeInstance;
      if (inst) fn(inst, ...args);
    };
  }

  const handleSelect = withInstance((inst, id: string, scope: ConversationScope) => {
    void openConversation(inst, id, scope);
  });

  const handleRename = withInstance((inst, id: string, scope: ConversationScope, title: string) => {
    renameConversation(refOf(inst, scope), id, title);
  });

  const handleDelete = withInstance((inst, id: string, scope: ConversationScope) => {
    const running = runOfConversation(id);
    if (running) {
      void stopAgent(running[0]).catch(() => {});
      delete runs[running[0]];
      setBusy(inst, id, false);
    }
    deleteConversation(refOf(inst, scope), id);
    if (conversations[liveKey(inst)]?.id === id) {
      const remaining = conversationsOf(refOf(inst, scope))[0];
      if (remaining) void openConversation(inst, remaining.id, scope);
      else startConversation(inst, 'instance');
    }
  });

  const handleDuplicate = withInstance((inst, id: string, scope: ConversationScope) => {
    const source = conversationsOf(refOf(inst, scope)).find((c) => c.id === id);
    if (!source) return;
    void duplicateConversation(refOf(inst, scope), id, `${source.title} (${t('agent.history.copySuffix')})`);
  });

  const handleTogglePin = withInstance((inst, id: string, scope: ConversationScope) => {
    togglePinned(refOf(inst, scope), id);
  });

  const handleToggleArchive = withInstance((inst, id: string, scope: ConversationScope) => {
    toggleArchived(refOf(inst, scope), id);
  });

  const handleDownload = withInstance((inst, id: string, scope: ConversationScope) => {
    const ref = refOf(inst, scope);
    const source = conversationsOf(ref).find((c) => c.id === id);
    if (!source) return;
    void downloadConversation(ref, source.id, source.title);
  });

  async function downloadConversation(ref: ConversationRef, id: string, title: string) {
    const [body, { save }] = await Promise.all([
      loadConversationBody(ref, id),
      import('@tauri-apps/plugin-dialog'),
    ]);
    const path = await save({
      defaultPath: `${markdownFileName(title)}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (!path) return;
    await writeFile(path, conversationToMarkdown(title, body.messages));
  }

  const handleMoveScope = withInstance((inst, from: ConversationScope, id: string) => {
    void moveConversationToScope(refOf(inst, from), id);
    if (conversations[liveKey(inst)]?.id === id) {
      conversations[liveKey(inst)].scope = from === 'instance' ? 'project' : 'instance';
    }
  });

  $effect(() => {
    const index = popupIndex;
    if (!popupOpen || !popupEl) return;
    popupEl.children[index]?.scrollIntoView({ block: 'nearest' });
  });

  function onKeydown(e: KeyboardEvent) {
    if (popupOpen && popupItems.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        popupIndex = (popupIndex + 1) % popupItems.length;
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        popupIndex = (popupIndex - 1 + popupItems.length) % popupItems.length;
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertPopupItem(popupIndex);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        popupOpen = false;
        return;
      }
    }

    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      send();
      return;
    }
    
    if (!IS_MAC && e.ctrlKey && !e.altKey) {
      const key = e.key.toLowerCase();
      if (key === 'z') {
        e.preventDefault();
        document.execCommand(e.shiftKey ? 'redo' : 'undo');
      } else if (key === 'y') {
        e.preventDefault();
        document.execCommand('redo');
      }
    }
  }
</script>

<svelte:window onclick={onWindowClick}/>

<div
  class="agent-split"
  style="grid-template-columns: {historyOpen ? '240px ' : ''}minmax(0, 1fr){$settings.agentShowLiveActivity ? ` ${activityWidth}px` : ''};"
>
  {#if historyOpen}
    <ConversationHistoryPanel
      instanceConversations={historyInstanceList}
      projectConversations={historyProjectList}
      activeId={current?.id ?? null}
      runningIds={runningConversationIds}
      doneId={doneConversationId}
      onSelect={handleSelect}
      onNewSession={() => { void newSession('instance'); }}
      newSessionActive={current?.pending ?? false}
      onRename={handleRename}
      onDelete={handleDelete}
      onDuplicate={handleDuplicate}
      onTogglePin={handleTogglePin}
      onToggleArchive={handleToggleArchive}
      onDownload={handleDownload}
      onMoveScope={handleMoveScope}
    />
  {/if}

  <div class="agent-chat">
    <div class="pane-header">
      <div class="pane-title">
        <button
          class="history-toggle"
          class:active={historyOpen}
          title={t('agent.history.toggle') as string}
          aria-label={t('agent.history.toggle') as string}
          onclick={() => { historyOpen = !historyOpen; }}
        >
          <Icon name="clock" size={13}/>
        </button>
        <span class="pane-title-sep"></span>
        <span class="pane-title-name" title={paneTitle}>{paneTitle}</span>
      </div>
    </div>

    {#if openThreadRuns.length > 0}
      <AgentThreadView
        runs={openThreadRuns}
        projectId={$activeInstance?.projectId ?? ""}
        renderMarkdown={renderMarkdown}
        onBack={() => openAgentId.set("")}
        onDelete={() => deleteAgentFromPanel($openAgentId)}
      />
    {:else}
      {#if current?.error}
        <div class="error-banner">
          <Icon name="alert" size={12}/>
          <span class="error-text selectable">{current.error}</span>
          <button class="error-retry" onclick={retry} disabled={conversationBusy}>
            <Icon name="refresh" size={11}/> {t('agent.retry')}
          </button>
        </div>
      {/if}

      <div class="chat-scroll" bind:this={scrollEl}>
        {#if loadingConversation}
          <div class="chat-skeleton"><Skeleton lines={6} gap={14}/></div>
        {:else}
        {#if !current}
          <div style="font-size: 11px; color: var(--fg-3); font-family: var(--font-mono); text-align: center; padding: 4px 0; border-bottom: 1px dashed var(--stroke-0); margin-bottom: 6px;">
            <Icon name="flag" size={11} style="margin-right: 6px; vertical-align: -1px;"/>
            {t('agent.noActiveInstance')} · {now()}
          </div>
        {/if}
        {#if current && current.messages.length === 0}
          <div class="empty-session">
            <span class="empty-mark"><Icon name="sparkles" size={22}/></span>
            <span class="empty-title">{t('agent.empty.title')}</span>
            <span class="empty-sub">{t('agent.empty.subtitle')}</span>
            <div class="empty-hints">
              <span class="empty-hint">
                <span class="empty-key">@</span>{t('agent.empty.mention')}
              </span>
              <span class="empty-hint">
                <span class="empty-key">/</span>{t('agent.empty.command')}
              </span>
              <span class="empty-hint">
                <span class="empty-key">{MOD_LABEL}</span>{t('agent.empty.send')}
              </span>
            </div>
          </div>
        {/if}
        {#each current?.messages ?? [] as m, i}
          {#if m.agentStarted}
          <div class="agent-started" data-msg={i} class:flash={flashedMessage === i}>
            <span class="started-dot" style="background: {agentColorOf(m)}"></span>
            <Icon name={agentIconOf(m)} size={11}/>
            <span class="started-text">
              {(t('agent.agentStarted') as (n: string) => string)(m.agentName ?? '')}
            </span>
            <span class="started-time">{messageClock(m, locale)}</span>
          </div>
        {:else if m.role === 'system'}
            <div style="font-size: 11px; color: var(--fg-3); font-family: var(--font-mono); text-align: center; padding: 4px 0; border-bottom: 1px dashed var(--stroke-0); margin-bottom: 6px;">
              <Icon name="flag" size={11} style="margin-right: 6px; vertical-align: -1px;"/>
              {m.content} · {messageClock(m, locale)}
            </div>
          {:else}
            <div class="answer-group">
            {#if m.replyTo}
              <button
                class="reply-quote"
                class:linked={m.replyToIndex !== undefined}
                disabled={m.replyToIndex === undefined}
                title={m.replyToIndex !== undefined
                  ? (t('agent.replyJump') as string)
                  : undefined}
                onclick={() => revealMessage(m.replyToIndex ?? -1)}
              >
                {m.replyTo}
              </button>
            {/if}
            <div
              class="msg {m.role}"
              class:from-agent={m.role === 'agent' && m.agentRunId}
              class:to-agent={m.role === 'user' && m.agentRunId}
              data-msg={i}
              class:flash={flashedMessage === i}
              style={m.agentRunId ? `--agent: ${agentColorOf(m)}` : ''}
            >
              <div class="meta">
                <span class="role">
                  {#if m.role === 'user'}
                    {t('agent.you')}
                  {:else}
                    <Icon name={agentIconOf(m)} size={12}/>{answerLabel(m)}
                  {/if}
                </span>
                {#if m.agentRunId}
                  <span>·</span>
                  {#if m.role === 'user' && m.agentName}
                    <span class="to-agent-name">
                      <Icon name={agentIconOf(m)} size={11}/>{m.agentName}
                    </span>
                  {/if}
                  <button class="agent-link" onclick={() => enterAgentFromMessage(m)}>
                    {t('agent.seeAgentWork')}
                  </button>
                {/if}
                <span>·</span>
                <span class:meta-hidden={!$settings.agentShowMessageTime} title={messageDate(m)}>{messageClock(m, locale)}</span>
                {#if m.streaming}
                  <span>·</span>
                  <span style="color: var(--accent)">{t('agent.streaming')}</span>
                {/if}
                {#if m.content && $settings.agentShowMessageCopy}
                  <button
                    class="copy-btn"
                    title={copiedKey === `${activeId}:${i}` ? (t('common.copied') as string) : (t('common.copy') as string)}
                    onclick={() => copyText(m.content, `${activeId}:${i}`)}
                  >
                    <Icon name={copiedKey === `${activeId}:${i}` ? 'check' : 'copy'} size={12}/>
                  </button>
                {/if}
              </div>
              {#if m.blocks?.length}
                <div class="turn-blocks">
                  <TurnBlocks
                    blocks={m.blocks}
                    showThinking={$settings.agentShowThinking}
                    roots={pathRoots}
                    {renderMarkdown}
                    onOpenAgent={openThreadOf}
                  />
                </div>
              {:else}
                {#if m.thinking && $settings.agentShowThinking}
                  <details class="thinking-block">
                    <summary><Icon name="wand" size={11}/> {t('agent.thinking')}</summary>
                    <div class="thinking-content selectable">{m.thinking}</div>
                  </details>
                {/if}
                <div class="bubble selectable">
                  {#if m.streaming && !m.content}
                    <p><span class="typing-dots"><span></span><span></span><span></span></span></p>
                  {:else if m.role === 'agent'}
                    {@html renderMarkdown(m.content)}
                  {:else}
                    <p>{m.content}</p>
                  {/if}
                </div>
              {/if}
              {#if m.role === 'agent' && m.usage && $settings.agentShowResponseStats}
                {@const stats = responseStats(m.usage, $settings.agentResponseStats)}
                {#if stats.length > 0}
                  <div class="usage-line">
                    {#each stats as stat}
                      <span class="usage-stat" title={t(`settings.agent.stat.${stat.id}`) as string}>
                        <Icon name={stat.icon} size={10}/>{stat.value}
                      </span>
                    {/each}
                  </div>
                {/if}
              {/if}
            </div>
            </div>
          {/if}
        {/each}
        {#if pendingPermission}
          <PermissionCard
            request={pendingPermission}
            onAnswer={answerPermission}
            {renderMarkdown}
          />
        {/if}

        {#if agentsAwaitingPermission.length > 0}
          <div class="agent-permission-note">
            <Icon name="shield" size={13}/>
            <span class="apn-text">
              {(t('agent.permission.agentWaiting') as (n: string) => string)(
                agentsAwaitingPermission.map((th) => th.latest.agentName).join(', '),
              )}
            </span>
            <button
              class="perm-btn"
              onclick={() => enterAgent(agentsAwaitingPermission[0].agentId)}
            >
              {t('agents.viewDetails')}
            </button>
          </div>
        {/if}
        {/if}
      </div>

      <div class="chat-input-wrap">
        <div class="chat-input">
          {#if current && (queued[current.id]?.length ?? 0) > 0}
            <div class="queued">
              {#each queued[current.id] as prompt, i (i)}
                <div class="queued-row">
                  <Icon name="clock" size={11}/>
                  <span class="queued-text selectable">{prompt}</span>
                  <button
                    class="queued-drop"
                    onclick={() => current && unqueue(current.id, i)}
                    title={t('agent.queueCancel') as string}
                    aria-label={t('agent.queueCancel') as string}
                  >
                    <Icon name="x" size={10}/>
                  </button>
                </div>
              {/each}
            </div>
          {/if}
          {#if popupOpen && popupItems.length > 0}
            <div class="mention-popup" bind:this={popupEl}>
              {#each popupItems as item, i}
                <button
                  class="mention-item"
                  class:active={i === popupIndex}
                  onclick={() => insertPopupItem(i)}
                  onpointerenter={() => { popupIndex = i; }}
                >
                  {#if item.kind === 'agent'}
                    <span class="mention-dot" style="background: {item.color}"></span>
                  {:else if item.kind === 'file'}
                    <Icon name="file" size={11}/>
                  {/if}
                  <span class="mention-name">{item.label}</span>
                  {#if item.detail}
                    <span class="mention-desc">{item.detail}</span>
                  {/if}
                </button>
              {/each}
            </div>
          {/if}
          {#if current}
            <textarea
              bind:this={textareaEl}
              placeholder={conversationBusy
                ? (t('agent.queuePlaceholder') as string)
                : (t('agent.inputPlaceholder') as string)}
              bind:value={current.draft}
              oninput={onInput}
              onkeydown={onKeydown}
              onclick={updatePopup}
            ></textarea>
          {:else}
            <textarea
              placeholder={t('agent.noActiveInstance') as string}
              disabled
            ></textarea>
          {/if}
          <div class="chat-input-row">
            {#if current}
              <div class="chip-wrap">
                <button
                  class="option-chip set"
                  title={t('agent.composer.provider') as string}
                  onclick={(e) => { e.stopPropagation(); chipOpen = chipOpen === 'provider' ? '' : 'provider'; }}
                >
                  <Icon name="server" size={10}/>
                  {currentProvider?.name ?? t('agent.composer.noProvider')}
                </button>
                {#if chipOpen === 'provider'}
                  <div class="chip-menu">
                    {#if selectableProviders.length === 0}
                      <span class="chip-empty">{t('agent.composer.noProviderHint')}</span>
                    {/if}
                    {#each selectableProviders as p}
                      <button
                        class="chip-option"
                        class:active={p.id === current?.providerId}
                        onclick={() => { chipOpen = ''; pickProvider(p.id); }}
                      >
                        {p.name}
                      </button>
                    {/each}
                  </div>
                {/if}
              </div>
              {#if modelOptions.length > 0 && $settings.agentShowModelChip}
                <div class="chip-wrap">
                  <button
                    class="option-chip"
                    class:set={!!current.modelId}
                    title={t('agent.composer.model') as string}
                    onclick={(e) => { e.stopPropagation(); chipOpen = chipOpen === 'model' ? '' : 'model'; }}
                  >
                    <Icon name="sparkles" size={10}/>
                    {current.modelId
                      ? modelLabel(currentProvider?.id ?? '', current.modelId)
                      : t('agent.composer.modelDefault')}
                  </button>
                  {#if chipOpen === 'model'}
                    <div class="chip-menu">
                      <button class="chip-option" class:active={!current.modelId} onclick={() => { chipOpen = ''; pickRunOption('modelId', ''); }}>
                        {t('agent.composer.defaultOption')}
                      </button>
                      {#each modelFamilies as family}
                        <button
                          class="chip-option"
                          class:active={current.modelId === family.models[0].id}
                          onclick={() => { chipOpen = ''; pickRunOption('modelId', family.models[0].id); }}
                        >
                          {family.label}
                        </button>
                      {/each}
                      {#if customModels.length > 0}
                        <span class="chip-group">{t('agent.composer.customModels')}</span>
                        {#each customModels as id}
                          <button
                            class="chip-option"
                            class:active={current.modelId === id}
                            onclick={() => { chipOpen = ''; pickRunOption('modelId', id); }}
                          >
                            {id}
                          </button>
                        {/each}
                      {/if}
                    </div>
                  {/if}
                </div>
              {/if}
              {#if supportsEffort && $settings.agentShowEffortChip}
                <div class="chip-wrap">
                  <button
                    class="option-chip"
                    class:set={!!current.effort}
                    title={t('agent.composer.effort') as string}
                    onclick={(e) => { e.stopPropagation(); chipOpen = chipOpen === 'effort' ? '' : 'effort'; }}
                  >
                    <Icon name="zap" size={10}/>
                    {current.effort
                      ? effortLabel(current.effort)
                      : t('agent.composer.effortDefault')}
                  </button>
                  {#if chipOpen === 'effort'}
                    <div class="chip-menu">
                      <button class="chip-option" class:active={!current.effort} onclick={() => { chipOpen = ''; pickRunOption('effort', ''); }}>
                        {t('agent.composer.defaultOption')}
                      </button>
                      {#each effortOptions as level}
                        <button class="chip-option" class:active={current.effort === level} onclick={() => { chipOpen = ''; pickRunOption('effort', level); }}>
                          {effortLabel(level)}
                        </button>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/if}
              {#if supportsPermissionMode && $settings.agentShowPermissionChip}
                <div class="chip-wrap">
                  <button
                    class="option-chip"
                    class:set={!!current.permissionMode}
                    class:danger={current.permissionMode === 'bypassPermissions'}
                    title={t('agent.composer.permissionMode') as string}
                    onclick={(e) => { e.stopPropagation(); chipOpen = chipOpen === 'perm' ? '' : 'perm'; }}
                  >
                    <Icon name="shield" size={10}/>
                    {current.permissionMode
                      ? permissionModeLabel(current.permissionMode)
                      : t('agent.composer.permissionDefault')}
                  </button>
                  {#if chipOpen === 'perm'}
                    <div class="chip-menu">
                      <button class="chip-option" class:active={!current.permissionMode} onclick={() => { chipOpen = ''; pickRunOption('permissionMode', ''); }}>
                        {t('agent.composer.defaultOption')}
                      </button>
                      {#each permissionOptions as mode}
                        <button class="chip-option" class:active={current.permissionMode === mode} onclick={() => { chipOpen = ''; pickRunOption('permissionMode', mode); }}>
                          {permissionModeLabel(mode)}
                        </button>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/if}
            {/if}
            <div class="spacer"></div>
            {#if contextTokens > 0 && $settings.agentShowContextWindow}
              <span
                class="ctx-chip"
                class:warn={contextPct !== null && contextPct >= 80}
                title={contextWindow
                  ? `${t('agent.contextWindow')}: ${formatCount(contextTokens)} / ${formatCount(contextWindow)} tokens`
                  : `${t('agent.contextWindow')}: ${formatCount(contextTokens)} tokens - ${t('agent.contextWindowUnknown')}`}
              >
                <span class="ctx-bar">
                  <span class="ctx-fill" style="width: {contextPct ?? 0}%"></span>
                </span>
                {contextPct !== null ? `${contextPct}%` : '?'}
              </span>
            {/if}
            {#if sessionStats && $settings.agentShowConversationCost}
              <div class="chip-wrap">
                <button
                  class="option-chip set"
                  title={t('agent.stats.title') as string}
                  onclick={(e) => { e.stopPropagation(); chipOpen = chipOpen === 'stats' ? '' : 'stats'; }}
                >
                  <Icon name="gauge" size={10}/>
                  {sessionStats.cost > 0 ? `$${sessionStats.cost.toFixed(2)}` : fmtTokens(sessionStats.inTok + sessionStats.outTok)}
                </button>
                {#if chipOpen === 'stats'}
                  <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
                  <div class="chip-menu stats-menu" onclick={(e) => e.stopPropagation()}>
                    <div class="stats-title">{t('agent.stats.title')}</div>
                    <div class="stats-grid">
                      <span class="stats-head"></span>
                      <span class="stats-head">{t('agent.stats.input')}</span>
                      <span class="stats-head">{t('agent.stats.output')}</span>
                      <span class="stats-head">{t('agent.stats.cost')}</span>
                      <span class="stats-section">{t('agent.stats.models')}</span>
                      {#each Object.entries(sessionStats.models) as [model, s]}
                        <span class="stats-model" title={model}>{model}</span>
                        <span class="stats-val">{fmtTokens(s.inTok)}</span>
                        <span class="stats-val">{fmtTokens(s.outTok)}</span>
                        <span class="stats-val">{s.cost > 0 ? `$${s.cost.toFixed(4)}` : '-'}</span>
                      {/each}
                      {#if Object.keys(sessionStats.agents).length > 0}
                        <span class="stats-section">{t('agent.stats.agents')}</span>
                        {#each Object.entries(sessionStats.agents) as [name, s]}
                          <span class="stats-model" title={name}>{name}</span>
                          <span class="stats-val">{fmtTokens(s.inTok)}</span>
                          <span class="stats-val">{fmtTokens(s.outTok)}</span>
                          <span class="stats-val">{s.cost > 0 ? `$${s.cost.toFixed(4)}` : '-'}</span>
                        {/each}
                      {/if}
                      <span class="stats-model total">{t('agent.stats.total')}</span>
                      <span class="stats-val total">{fmtTokens(sessionStats.inTok)}</span>
                      <span class="stats-val total">{fmtTokens(sessionStats.outTok)}</span>
                      <span class="stats-val total">{sessionStats.cost > 0 ? `$${sessionStats.cost.toFixed(4)}` : '-'}</span>
                    </div>
                  </div>
                {/if}
              </div>
            {/if}
            {#if rateLimit?.status && rateLimit.status !== 'allowed' && $settings.agentShowRateLimit}
              <span class="ctx-chip warn" title={rateLimit.rateLimitType === 'weekly' ? (t('agent.quota.weekly') as string) : (t('agent.quota.fiveHour') as string)}>
                {t('agent.quota.limited')}{rateLimit.resetsAt ? ` - ${quotaResetLabel(rateLimit.resetsAt)}` : ''}
              </span>
            {/if}
            {#if conversationBusy}
              <button class="btn btn-stop" onclick={interrupt}>
                <Icon name="stop" size={12}/> {t('agent.interrupt')}<span class="kbd">{MOD_LABEL}.</span>
              </button>
              <button
                class="btn"
                onclick={send}
                disabled={!current || !current.draft.trim()}
                title={t('agent.queueHint') as string}
              >
                <Icon name="send" size={12}/> {t('agent.queueBtn')}<span class="kbd">{MOD_LABEL}↵</span>
              </button>
            {:else}
              <button
                class="btn"
                onclick={send}
                disabled={!current || !current.draft.trim() || conversationBusy}
              >
                <Icon name="send" size={12}/> {t('agent.sendBtn')}<span class="kbd">{MOD_LABEL}↵</span>
              </button>
            {/if}
          </div>
        </div>
      </div>
    {/if}
  </div>

  {#if $settings.agentShowLiveActivity || conversationThreads.length > 0}
    <div class="activity">
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="activity-resize"
        class:active={isActivityResizing}
        role="separator"
        aria-orientation="vertical"
        onpointerdown={startActivityResize}
        onpointermove={onActivityResizeMove}
        onpointerup={stopActivityResize}
      ></div>
      <AgentRunsPanel
        threads={conversationThreads}
        openAgentId={$openAgentId}
        onOpen={enterAgent}
        onDelete={(agentId) => { deletingAgentId = agentId; }}
      />
      {#if $settings.agentShowLiveActivity}
      <div class="activity-head">
        <Icon name="zap" size={13}/>
        <span class="la-title">{t('agent.liveActivity')}</span>
        {#if activityEntries.length > 0}
          <span class="la-badge" class:running={runningCount > 0}>
            {runningCount > 0 ? `${runningCount}/${activityEntries.length}` : activityEntries.length}
          </span>
        {/if}
      </div>
      <div class="activity-list" bind:this={activityEl}>
        {#if activityEntries.length === 0}
          <div class="la-empty">
            <Icon name="zap" size={18}/>
            <span>{$activeInstance ? t('agent.waitingAgent') : t('agent.noActiveInstance')}</span>
          </div>
        {:else}
          <div class="la-feed">
            {#each activityEntries as entry, i}
              {@const running = entry.source === 'tool' && !entry.done && !entry.failed && conversationBusy}
              {@const sep = entry.label.indexOf(': ')}
              {@const target = activityTargets[i] ?? -1}
              <div
                class="la-item"
                class:running
                class:failed={entry.failed || entry.source === 'system'}
                class:done={entry.done && !entry.failed}
                class:prompt={entry.source === 'stdin'}
                class:linked={(entry.messageIndex ?? target) >= 0}
                role="button"
                tabindex={(entry.messageIndex ?? target) >= 0 ? 0 : -1}
                aria-disabled={(entry.messageIndex ?? target) < 0}
                title={(entry.messageIndex ?? target) >= 0
                  ? (t('agent.activityJump') as string)
                  : undefined}
                onclick={() => activateActivity(entry, target)}
                onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activateActivity(entry, target); } }}
              >
                <span class="la-rail" class:last={i === activityEntries.length - 1}>
                  <span class="la-bubble"><Icon name={entry.icon} size={12}/></span>
                </span>
                <div class="la-body">
                  <div class="la-line">
                    <span class="la-label" title={entry.label}>
                      {entry.source === 'tool' && sep > -1
                        ? entry.label.slice(0, sep)
                        : shortenPaths(entry.label, pathRoots)}
                    </span>
                    {#if $settings.agentActivityShowTime}
                      <span class="la-time selectable" title={messageDate(entry)}>{messageClock(entry, locale)}</span>
                    {/if}
                  </div>
                  {#if entry.source === 'tool' && sep > -1 && $settings.agentActivityShowToolArgs}
                    <span class="la-arg selectable" title={entry.label.slice(sep + 2)}>
                      {shortenPaths(entry.label.slice(sep + 2), pathRoots)}
                    </span>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
      {/if}
    </div>
  {/if}
</div>

{#if deletingAgentId}
  <AgentThreadConfirmModal
    name={deletingAgentName}
    on:close={() => { deletingAgentId = ''; }}
    on:confirm={() => { deleteAgentFromPanel(deletingAgentId); deletingAgentId = ''; }}
  />
{/if}

<style>
  /* ---- Live activity ---- */
  .la-title { flex: 1; }

  .la-badge {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--fg-3);
    font-variant-numeric: tabular-nums;
  }
  .la-badge.running { color: var(--accent); }

  .la-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 40px 20px;
    color: var(--fg-4);
    font-size: 12px;
    text-align: center;
  }

  .la-feed { padding: 8px 12px 24px; }

  .la-item {
    display: grid;
    grid-template-columns: 20px 1fr;
    gap: 9px;
    padding: 4px 4px 8px;
    border-radius: var(--r-sm);
  }
  .la-item.linked { cursor: pointer; }
  .la-item.linked:hover { background: var(--bg-2); }
  .la-item.linked:focus-visible {
    outline: 1px solid var(--accent-line);
    outline-offset: -1px;
  }

  /* Marks the message an activity entry pointed at, just long enough to find it. */
  :global(.msg.flash),
  .agent-started.flash {
    animation: msg-flash 1.2s ease-out;
    border-radius: var(--r-sm);
  }
  @keyframes msg-flash {
    0% { background: var(--accent-weak); }
    100% { background: transparent; }
  }

  /* The rail draws the thread between two consecutive entries. */
  .la-rail {
    position: relative;
    display: flex;
    justify-content: center;
  }
  .la-rail::before {
    content: '';
    position: absolute;
    top: 21px;
    bottom: -8px;
    width: 1px;
    background: var(--stroke-0);
  }
  .la-rail.last::before { display: none; }

  .la-bubble {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: var(--r-xs);
    color: var(--fg-3);
    background: var(--bg-2);
    border: 1px solid var(--stroke-0);
  }

  .la-item.prompt .la-bubble { color: var(--fg-1); }
  .la-item.done .la-bubble { color: var(--success); }
  .la-item.failed .la-bubble { color: var(--danger); }
  .la-item.running .la-bubble { color: var(--accent); border-color: var(--accent-line); }

  .la-body {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding-top: 2px;
  }

  .la-line {
    display: flex;
    align-items: baseline;
    gap: 6px;
    min-width: 0;
  }

  /*
   * A prompt entry carries the beginning of the message, so the label is
   * clamped: a long prompt must not push the tool calls out of view. The full
   * text stays reachable through the title.
   */
  .la-label {
    flex: 1;
    min-width: 0;
    font-size: 11.5px;
    color: var(--fg-1);
    line-height: 1.4;
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
  }
  .la-item.prompt .la-label { color: var(--fg-2); }
  .la-item.running .la-label { color: var(--fg-0); }

  .la-arg {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--fg-3);
    line-height: 1.45;
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
  }

  .la-time {
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: 9.5px;
    color: var(--fg-4);
    font-variant-numeric: tabular-nums;
  }

  /* Hides the timestamp and the separator that introduces it. */
  .meta-hidden,
  .meta > span:has(+ .meta-hidden) { display: none; }

  .history-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 3px;
    margin-right: 2px;
    color: var(--fg-3);
    background: transparent;
    border: none;
    border-radius: var(--r-xs);
    cursor: pointer;
    transition: color 0.1s, background 0.1s;
  }

  .history-toggle:hover { color: var(--fg-0); background: var(--bg-2); }
  .history-toggle.active { color: var(--accent); }

  .pane-title-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pane-title-sep {
    width: 1px;
    height: 14px;
    margin: 0 8px 0 4px;
    background: var(--stroke-1);
  }

  .turn-blocks {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-width: 0;
  }

  .empty-session {
    align-items: center;
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: auto 0;
    padding: 48px 24px;
    text-align: center;
  }

  .empty-mark {
    align-items: center;
    background: var(--bg-2);
    border: 1px solid var(--stroke-0);
    border-radius: 50%;
    color: var(--accent);
    display: flex;
    height: 46px;
    justify-content: center;
    margin-bottom: 4px;
    width: 46px;
  }

  .empty-title {
    color: var(--fg-0);
    font-size: 14px;
    font-weight: 600;
  }

  .empty-sub {
    color: var(--fg-3);
    font-size: 12px;
    line-height: 1.6;
    max-width: 380px;
  }

  .empty-hints {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: center;
    margin-top: 10px;
  }

  .empty-hint {
    align-items: center;
    background: var(--bg-1);
    border: 1px solid var(--stroke-0);
    border-radius: 6px;
    color: var(--fg-2);
    display: flex;
    font-size: 11px;
    gap: 6px;
    padding: 5px 9px;
  }

  .empty-key {
    background: var(--bg-3);
    border-radius: 4px;
    color: var(--fg-1);
    font-family: var(--font-mono);
    font-size: 10px;
    padding: 1px 5px;
  }

  .chat-skeleton { padding: 8px 4px; }

  .msg .meta .role {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .copy-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 2px;
    margin-left: 2px;
    color: var(--fg-3);
    background: transparent;
    border: none;
    border-radius: var(--r-xs);
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.1s, color 0.1s, background 0.1s;
  }

  .msg:hover .copy-btn { opacity: 1; }
  .copy-btn:hover { color: var(--fg-0); background: var(--bg-2); }

  .activity { position: relative; }

  .activity-resize {
    position: absolute;
    top: 0;
    left: -3px;
    width: 6px;
    height: 100%;
    cursor: col-resize;
    z-index: 5;
    touch-action: none;
  }

  .activity-resize::after {
    content: '';
    position: absolute;
    left: 2px;
    top: 0;
    width: 2px;
    height: 100%;
    background: transparent;
    transition: background 0.1s;
  }

  .activity-resize:hover::after,
  .activity-resize.active::after {
    background: var(--accent-line, var(--stroke-1));
  }

.error-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 14px;
    background: rgba(255, 80, 80, .08);
    border-bottom: 1px solid rgba(255, 80, 80, .25);
    color: #ff8080;
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .error-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .error-retry {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: var(--r-sm);
    background: transparent;
    border: 1px solid rgba(255, 80, 80, .35);
    color: #ff8080;
    font-size: 10.5px;
    font-family: var(--font-ui);
    cursor: pointer;
    flex-shrink: 0;
  }
  .error-retry:hover:not(:disabled) { background: rgba(255, 80, 80, .12); }
  .error-retry:disabled { opacity: .5; cursor: default; }

  .thinking-block {
    margin: 2px 0 6px;
    font-size: 11px;
    color: var(--fg-3);
  }

  .thinking-block summary {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    cursor: pointer;
    color: var(--fg-3);
    list-style: none;
  }
  .thinking-block summary::-webkit-details-marker { display: none; }
  .thinking-block summary:hover { color: var(--fg-1); }

  .thinking-content {
    margin-top: 6px;
    padding: 8px 10px;
    border-left: 2px solid var(--stroke-1);
    white-space: pre-wrap;
    font-family: var(--font-mono);
    font-size: 10.5px;
    line-height: 1.55;
    color: var(--fg-3);
  }

  .usage-line {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 12px;
    margin-top: 5px;
    font-size: 10px;
    font-family: var(--font-mono);
    color: var(--fg-4);
  }

  .usage-stat {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .usage-stat :global(svg) { opacity: 0.7; }

  .permission-card {
    margin: 10px 0;
    padding: 12px 14px;
    border-radius: var(--r-md);
    background: var(--bg-2);
    border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
  }

  .permission-head {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    font-weight: 600;
    color: var(--fg-0);
  }

  .permission-desc {
    margin-top: 6px;
    font-size: 11.5px;
    color: var(--fg-2);
  }

  .permission-preview {
    display: block;
    margin-top: 8px;
    padding: 7px 10px;
    border-radius: var(--r-sm);
    background: var(--bg-0);
    border: 1px solid var(--stroke-0);
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-1);
    white-space: pre-wrap;
    word-break: break-all;
  }

  .permission-plan {
    margin-top: 8px;
    padding: 8px 12px;
    border-left: 2px solid var(--accent);
    font-size: 12px;
    color: var(--fg-1);
    max-height: 320px;
    overflow-y: auto;
  }

  .permission-actions {
    display: flex;
    gap: 8px;
    margin-top: 12px;
  }

  .perm-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 5px 12px;
    border-radius: var(--r-sm);
    background: var(--bg-3);
    border: 1px solid var(--stroke-1);
    color: var(--fg-1);
    font-size: 11.5px;
    font-family: var(--font-ui);
    cursor: pointer;
    transition: background .12s, color .12s, border-color .12s;
  }
  .perm-btn:hover { background: var(--bg-4); color: var(--fg-0); }
  .perm-btn.allow {
    background: var(--accent-weak, color-mix(in srgb, var(--accent) 12%, transparent));
    border-color: color-mix(in srgb, var(--accent) 35%, transparent);
    color: var(--accent);
  }
  .perm-btn.allow:hover { background: color-mix(in srgb, var(--accent) 22%, transparent); }
  .perm-btn.deny:hover {
    color: #ff8080;
    border-color: rgba(255, 80, 80, .4);
  }

  .chip-wrap { position: relative; }

  .option-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 99px;
    background: transparent;
    border: 1px solid var(--stroke-0);
    color: var(--fg-3);
    font-size: 10.5px;
    font-family: var(--font-mono);
    cursor: pointer;
    transition: color .12s, border-color .12s;
    white-space: nowrap;
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .option-chip:hover { color: var(--fg-1); border-color: var(--stroke-1); }
  .option-chip.set { color: var(--fg-1); border-color: var(--stroke-1); }
  .option-chip.danger { color: #ff8080; border-color: rgba(255, 80, 80, .35); }

  .chip-menu {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 0;
    z-index: 60;
    min-width: 160px;
    background: var(--bg-2);
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-md);
    box-shadow: 0 8px 24px rgba(0, 0, 0, .3);
    padding: 4px;
    display: flex;
    flex-direction: column;
    gap: 1px;
    /* The whole roster can be long; it scrolls rather than covering the view. */
    max-height: 280px;
    overflow-y: auto;
  }

  .chip-option {
    display: flex;
    align-items: center;
    width: 100%;
    padding: 5px 8px;
    font-size: 11.5px;
    color: var(--fg-1);
    background: transparent;
    border: none;
    border-radius: var(--r-sm);
    cursor: pointer;
    text-align: left;
  }
  .chip-option:hover { background: var(--bg-3); color: var(--fg-0); }

  .chip-group {
    display: block;
    padding: 8px 8px 3px;
    margin-top: 3px;
    font-family: var(--font-mono);
    font-size: 9.5px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--fg-4);
    border-top: 1px solid var(--stroke-0);
  }


  .chip-option.active { color: var(--accent); background: var(--accent-weak, var(--bg-3)); }

  .ctx-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 10px;
    font-family: var(--font-mono);
    color: var(--fg-3);
    padding: 2px 8px;
    border-radius: 99px;
    border: 1px solid transparent;
    white-space: nowrap;
  }
  .ctx-chip.warn {
    color: #fbbf24;
    border-color: color-mix(in srgb, #fbbf24 30%, transparent);
  }

  .ctx-bar {
    width: 44px;
    height: 4px;
    border-radius: 99px;
    background: var(--bg-4);
    overflow: hidden;
  }

  .ctx-fill {
    display: block;
    height: 100%;
    border-radius: 99px;
    background: var(--accent);
    transition: width .3s;
  }
  .ctx-chip.warn .ctx-fill { background: #fbbf24; }

  .stats-menu {
    min-width: 250px;
    right: 0;
    left: auto;
    padding: 8px 10px;
    cursor: default;
  }

  .stats-title {
    font-size: 10.5px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: .05em;
    color: var(--fg-3);
    padding-bottom: 6px;
  }

  .stats-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto auto;
    gap: 3px 12px;
    align-items: center;
  }

  .stats-head {
    font-size: 9.5px;
    text-transform: uppercase;
    letter-spacing: .04em;
    color: var(--fg-3);
    text-align: right;
  }

  .stats-model {
    font-size: 10.5px;
    font-family: var(--font-mono);
    color: var(--fg-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .stats-val {
    font-size: 10.5px;
    font-family: var(--font-mono);
    color: var(--fg-1);
    text-align: right;
  }

  .stats-model.total,
  .stats-val.total {
    border-top: 1px solid var(--stroke-0);
    padding-top: 4px;
    color: var(--fg-0);
    font-weight: 600;
  }


  .chat-input { position: relative; }

  /* The composer takes the colour of whoever is answering, so the agent in
     charge is visible without reading the draft. */




  /* An agent's answer is a reply: it hangs off the message that called it. */
  .msg.from-agent {
    border-left: 2px solid var(--agent);
    margin-left: 10px;
    padding-left: 12px;
  }

  .agent-permission-note {
    align-items: center;
    background: var(--bg-2);
    border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
    border-radius: var(--r-md);
    color: var(--fg-1);
    display: flex;
    font-size: 12px;
    gap: 8px;
    margin: 10px 0;
    padding: 10px 12px;
  }

  .apn-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .perm-btn {
    align-items: center;
    background: var(--bg-3);
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-sm);
    color: var(--fg-1);
    cursor: pointer;
    display: inline-flex;
    flex: 0 0 auto;
    font-family: var(--font-ui);
    font-size: 11.5px;
    gap: 5px;
    padding: 5px 12px;
  }

  .perm-btn:hover { background: var(--bg-4); color: var(--fg-0); }

  .agent-started {
    align-items: center;
    color: var(--fg-3);
    display: flex;
    font-size: 11px;
    gap: 7px;
    margin-left: 10px;
    padding: 2px 0;
  }

  .started-dot {
    border-radius: 50%;
    flex: 0 0 auto;
    height: 6px;
    width: 6px;
  }

  .started-text { color: var(--fg-2); }

  .started-time { color: var(--fg-4); }

  /* An answer and the prompt it echoes travel together, tight. */
  .answer-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }

  /* The prompt again, exactly as it was sent and dimmed: it is a reminder of
     the question, not a second copy competing with it. */
  .reply-quote {
    background: var(--bg-2);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-md);
    color: var(--fg-1);
    font: inherit;
    font-size: 13.5px;
    line-height: 1.55;
    opacity: 0.45;
    overflow-wrap: anywhere;
    padding: 12px 14px;
    text-align: left;
    transition: opacity .12s;
    width: 100%;
    word-break: break-word;
  }

  .reply-quote.linked { cursor: pointer; }
  .reply-quote.linked:hover { opacity: 0.7; }

  .msg.from-agent .role { color: var(--agent); }

  /* A prompt addressed to an agent wears what the composer wore when it was
     written: the agent's colour, and its name. */
  .msg.to-agent :global(.bubble) {
    border-color: color-mix(in srgb, var(--agent) 45%, transparent);
  }

  /* The agent this prompt was addressed to, sitting with the link to its work. */
  .to-agent-name {
    align-items: center;
    color: var(--agent);
    display: inline-flex;
    font-weight: 500;
    gap: 4px;
  }

  .stats-section {
    color: var(--fg-3);
    font-size: 9px;
    grid-column: 1 / -1;
    letter-spacing: 0.04em;
    padding-top: 6px;
    text-transform: uppercase;
  }

  .agent-link {
    background: none;
    border: none;
    color: var(--agent, var(--accent));
    cursor: pointer;
    font: inherit;
    padding: 0;
  }

  .agent-link:hover { text-decoration: underline; }



  .queued {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 0 0 6px;
  }

  .queued-row {
    align-items: center;
    background: var(--bg-2);
    border: 1px dashed var(--stroke-0);
    border-radius: 6px;
    color: var(--fg-2);
    display: flex;
    font-size: 11px;
    gap: 6px;
    min-width: 0;
    padding: 4px 6px;
  }

  .queued-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .queued-drop {
    background: none;
    border: none;
    border-radius: 4px;
    color: var(--fg-3);
    cursor: pointer;
    display: inline-flex;
    flex: 0 0 auto;
    padding: 2px;
  }

  .queued-drop:hover { background: var(--bg-3); color: var(--fg-0); }

  .mention-popup {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 0;
    z-index: 60;
    min-width: 260px;
    max-width: 420px;
    max-height: 280px;
    overflow-y: auto;
    background: var(--bg-2);
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-md);
    box-shadow: 0 8px 24px rgba(0, 0, 0, .3);
    padding: 4px;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .mention-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    font-size: 12px;
    color: var(--fg-1);
    background: transparent;
    border: none;
    border-radius: var(--r-sm);
    cursor: pointer;
    text-align: left;
  }
  .mention-item.active { background: var(--bg-3); color: var(--fg-0); }

  .mention-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .mention-name {
    font-family: var(--font-mono);
    font-size: 11.5px;
    flex-shrink: 0;
  }

  .mention-desc {
    font-size: 11px;
    color: var(--fg-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .chip-empty {
    display: block;
    padding: 6px 10px;
    font-size: 11px;
    color: var(--fg-3);
    max-width: 200px;
    line-height: 1.4;
  }

</style>
