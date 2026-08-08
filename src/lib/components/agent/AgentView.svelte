<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import { get } from 'svelte/store';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import Icon from '$lib/components/Icon.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import { t, getLocale } from '$lib/i18n';
  import { activeInstance, instancesWithBase } from '$lib/stores/instance';
  import { activeProject } from '$lib/stores/project';
  import { prepareInstanceEnv } from '$lib/stores/env';
  import { settings } from '$lib/stores/settings';
  import Spinner from '$lib/components/Spinner.svelte';
  import { respondPermission, sendMessage, stopAgent, type PermissionResponse, type RunOptions } from '$lib/services/agent-service';
  import { mentionToken } from '$lib/utils/agent/mention';
  import { quickSearch, type QuickSearchHit } from '$lib/services/file-service';
  import { listAgentCommands, type AgentSlashCommand } from '$lib/services/ai-provider-service';
  import {
    aiProviders, customAgents, effortsOf, loadAiProviders, modelsOf, permissionModesOf,
    providerCapabilities, refreshProviderModels, type CustomAgent,
  } from '$lib/stores/ai-providers';
  import { contextWindowOf, prettyModelName, providerById } from '$lib/components/home/agents/providers-data';
  import { effortLabel, permissionModeLabel } from '$lib/utils/agent/run-options';
  import { groupModelFamilies } from '$lib/utils/agent/model-families';
  import ConversationHistoryPanel from './ConversationHistoryPanel.svelte';
  import { conversationToMarkdown, deriveConversationTitle, markdownFileName } from '$lib/utils/agent/conversation-export';
  import type { ConversationScope } from '$lib/services/conversation-service';
  import {
    activeConversationId, conversationScopeKey, conversationsOf, findConversation,
    instanceConversations as instanceConversationsStore,
    projectConversations as projectConversationsStore,
    restoreConversations, selectConversation, deleteConversation, duplicateConversation,
    loadConversationBody,
    createConversation as createStoredConversation, updateConversationContent,
    setConversationProvider, setConversationRunOptions, setConversationSession, renameConversation,
    togglePinned, toggleArchived, moveConversationToScope,
    type ConversationRef,
  } from '$lib/stores/conversation';
  import {
    setAgentBusy, setAgentDone, pingAgentCompletion, doneConversationOf,
    agentActivityKey, agentBusyConversations, agentDoneConversation,
  } from '$lib/stores/agent-activity';
  import { writeFile } from '$lib/services/file-service';
  import { activeStep, terminalActive, commandsActive } from '$lib/stores/ui';
  import { PROVIDERS } from '$lib/components/home/agents/providers-data';
  import { IS_MAC, MOD_LABEL } from '$lib/utils/platform';
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
    costUsd?: number;
    durationMs?: number;
    numTurns?: number;
  }

  interface Message {
    role: 'system' | 'user' | 'agent';
    content: string;
    time: string;
    streaming?: boolean;
    thinking?: string;
    usage?: MessageUsage;
  }

  interface ActivityEntry {
    time: string;
    icon: string;
    label: string;
    source: 'stdin' | 'tool' | 'system';
    done?: boolean;
    failed?: boolean;
  }

  interface Conversation {
    id: string;
    scope: ConversationScope;
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
    /**
     * True when a mentioned agent sent this run to a provider other than the
     * conversation's. Such a run neither resumes nor overwrites the
     * conversation's session: a session id only means something to the CLI
     * that minted it.
     */
    foreignProvider: boolean;
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

  let conversations = $state<Record<string, Conversation>>({});
  let runs = $state<Record<string, Run>>({});
  let permissions = $state<Record<string, PermissionRequest>>({});
  let rateLimit = $state<RateLimitInfo | null>(null);

  function runOfConversation(conversationId: string): [string, Run] | undefined {
    return Object.entries(runs).find(
      ([, run]) => run.conversationId === conversationId,
    );
  }
  let historyOpen = $state(true);
  let loadingConversation = $state(false);
  let drafts = $state<Record<string, string>>({});
  let scrollEl: HTMLElement;
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
  let current = $derived(activeId ? conversations[activeId] : undefined);
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

  function answerLabel(m: Message): string {
    const modelId = m.usage?.model || current?.modelId || '';
    if (!modelId) return currentProvider?.name ?? (t('agent.agentRole') as string);
    return modelLabel(currentProvider?.id ?? '', modelId);
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
  let contextTokens = $derived(
    lastUsage
      ? (lastUsage.inputTokens ?? 0) + (lastUsage.cacheReadTokens ?? 0) + (lastUsage.outputTokens ?? 0)
      : 0,
  );
  let contextWindow = $derived(
    contextWindowOf(currentProvider?.id ?? '', lastUsage?.model || current?.modelId || '')
      ?? 200000,
  );
  let contextPct = $derived(Math.min(100, Math.round((contextTokens / contextWindow) * 100)));

  interface PopupEntry {
    kind: 'agent' | 'command' | 'file';
    label: string;
    detail?: string;
    color?: string;
    insert: string;
  }

  let slashCommands = $state<AgentSlashCommand[]>([]);
  let fileHits = $state<QuickSearchHit[]>([]);
  let popupOpen = $state(false);
  let popupKind = $state<'agent' | 'command'>('agent');
  let popupIndex = $state(0);
  let popupQuery = $state('');
  let popupItems = $derived.by((): PopupEntry[] => {
    const q = popupQuery.toLowerCase();
    if (popupKind === 'command') {
      return slashCommands
        .filter((c) => c.name.toLowerCase().startsWith(q))
        .slice(0, 8)
        .map((c) => ({
          kind: 'command' as const,
          label: `/${c.name}`,
          detail: c.description,
          insert: `/${c.name} `,
        }));
    }
    const agents = $customAgents
      .filter((a) => a.name && mentionToken(a.name).toLowerCase().startsWith(q))
      .slice(0, 4)
      .map((a) => ({
        kind: 'agent' as const,
        label: `@${mentionToken(a.name)}`,
        detail: a.description,
        color: a.color,
        insert: `@${mentionToken(a.name)} `,
      }));
    const files = fileHits
      .filter((h) => !h.isDir)
      .slice(0, 8 - agents.length)
      .map((h) => ({
        kind: 'file' as const,
        label: `@${h.path}`,
        insert: `@${h.path} `,
      }));
    return [...agents, ...files];
  });

  $effect(() => {
    const inst = $activeInstance;
    const open = popupOpen && popupKind === 'agent';
    const q = popupQuery;
    if (!inst || !open || q.length === 0) {
      fileHits = [];
      return;
    }
    void quickSearch(inst.worktreePath, q, false, false, 10)
      .then((hits) => { fileHits = hits; })
      .catch(() => { fileHits = []; });
  });

  function mentionedAgent(text: string): CustomAgent | undefined {
    const matches = text.match(/@([\w-]+)/g) ?? [];
    for (const raw of matches) {
      const token = raw.slice(1).toLowerCase();
      const agent = $customAgents.find((a) => mentionToken(a.name).toLowerCase() === token);
      if (agent) return agent;
    }
    return undefined;
  }

  function refOf(inst: Instance, scope: ConversationScope): ConversationRef {
    return { projectId: inst.projectId, instanceId: inst.id, scope };
  }

  function startedMessage(inst: Instance): Message {
    return { role: 'system', content: `${t('agent.instanceStarted')} · ${inst.ticket.title}`, time: now() };
  }

  function defaultProviderId(): string {
    const stored = get(aiProviders).defaultProviderId;
    return selectableProviders.some((p) => p.id === stored)
      ? stored
      : (selectableProviders[0]?.id ?? PROVIDERS[0].id);
  }

  function startConversation(inst: Instance, scope: ConversationScope): Conversation {
    const stored = createStoredConversation(
      refOf(inst, scope),
      defaultProviderId(),
      t('agent.history.untitled') as string,
    );
    const conv: Conversation = {
      id: stored.id,
      scope,
      messages: [startedMessage(inst)],
      activity: [],
      draft: '',
      busy: false,
      error: '',
      providerId: stored.providerId,
      modelId: '',
      effort: '',
      permissionMode: '',
    };
    conversations[inst.id] = conv;
    syncLive(inst);
    return conv;
  }

  function ensureConversation(inst: Instance): Conversation {
    return conversations[inst.id] ?? startConversation(inst, 'instance');
  }

  function syncLive(inst: Instance) {
    const conv = conversations[inst.id];
    if (!conv) return;
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
    const previous = conversations[inst.id];
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

    conversations[inst.id] = {
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
    };
    selectConversation(inst.projectId, inst.id, id);
    await autoscroll();
  }

  async function hydrate(inst: Instance) {
    await restoreConversations(inst.projectId, inst.id);
    if (conversations[inst.id]) return;

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
    const live = conversations[inst.id];
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

  function endStreaming(run: Run) {
    const last = run.messages.findLast((m) => m.role === 'agent');
    if (last?.streaming) last.streaming = false;
  }

  function isViewingAgent(inst: Instance): boolean {
    return inst.id === $activeInstance?.id && $activeStep === 'agent' && !$terminalActive && !$commandsActive;
  }

  function notifyAgentCompletion(inst: Instance, conversationId: string) {
    if (isViewingAgent(inst) && conversations[inst.id]?.id === conversationId) return;
    setAgentDone(inst.projectId, inst.id, true, conversationId);
    pingAgentCompletion();
  }

  $effect(() => {
    const inst = $activeInstance;
    const openId = inst ? conversations[inst.id]?.id : undefined;
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

  function now(): string {
    return new Date().toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' });
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

  let sessionStats = $derived.by(() => {
    const models: Record<string, ModelStats> = {};
    let cost = 0;
    let inTok = 0;
    let outTok = 0;
    let any = false;
    for (const m of current?.messages ?? []) {
      const u = m.usage;
      if (!u) continue;
      any = true;
      const key = u.model ?? '?';
      const entry = (models[key] ??= { inTok: 0, outTok: 0, cost: 0 });
      const i = (u.inputTokens ?? 0) + (u.cacheReadTokens ?? 0);
      const o = u.outputTokens ?? 0;
      const c = u.costUsd ?? 0;
      entry.inTok += i;
      entry.outTok += o;
      entry.cost += c;
      inTok += i;
      outTok += o;
      cost += c;
    }
    return any ? { models, cost, inTok, outTok } : null;
  });

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
    if (!untrack(() => conversations[inst.id])) void hydrate(inst);
    tick().then(resizeTextarea);
  });

  interface UsagePayload {
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
    };
    totalCostUsd?: number;
    durationMs?: number;
    numTurns?: number;
  }

  onMount(async () => {
    void loadAiProviders();
    unlisten = await listen<{
      line: string;
      source: string;
      summary?: string;
      workingDir?: string;
      runId?: string;
      data?: Record<string, unknown>;
    }>('claude-output', (e) => {
      const { source, line, summary, runId, data } = e.payload;
      if (!runId) return;

      const run = runs[runId];
      if (!run) return;

      const inst = instanceById(run.instanceId);
      if (!inst) return;

      const live = conversations[inst.id];
      const isLive = live?.id === run.conversationId;

      if (source === 'system') {
        if (line === '[done]') {
          delete permissions[run.conversationId];
          setBusy(inst, run.conversationId, false);
          notifyAgentCompletion(inst, run.conversationId);
          endStreaming(run);
          persistRun(inst, run);
          delete runs[runId];
          return;
        }
        if (line === '[session stopped]') {
          delete permissions[run.conversationId];
          setBusy(inst, run.conversationId, false);
          endStreaming(run);
          persistRun(inst, run);
          delete runs[runId];
          return;
        }
        if (line.startsWith('[error:')) {
          if (isLive && live) live.error = line.slice(8, -1);
          setBusy(inst, run.conversationId, false);
          notifyAgentCompletion(inst, run.conversationId);
          endStreaming(run);
          run.activity.push({ time: now(), icon: 'alert', label: line, source: 'system' });
        }
      } else if (source === 'error') {
        const message = String(data?.message ?? 'Unknown error');
        if (isLive && live) live.error = message;
        run.activity.push({ time: now(), icon: 'alert', label: message, source: 'system' });
      } else if (source === 'usage') {
        const payload = data as UsagePayload;
        const target = run.messages.findLast((m) => m.role === 'agent');
        if (target) {
          target.usage = {
            model: payload?.model,
            inputTokens: payload?.usage?.input_tokens,
            outputTokens: payload?.usage?.output_tokens,
            cacheReadTokens: payload?.usage?.cache_read_input_tokens,
            costUsd: payload?.totalCostUsd,
            durationMs: payload?.durationMs,
            numTurns: payload?.numTurns,
          };
        }
      } else if (source === 'thinking') {
        const target = run.messages.findLast((m) => m.role === 'agent' && m.streaming);
        if (target) target.thinking = (target.thinking ?? '') + String(data?.text ?? '');
      } else if (source === 'tool_result') {
        const pending = run.activity.find((a) => a.source === 'tool' && !a.done);
        if (pending) {
          pending.done = true;
          pending.failed = data?.isError === true;
        }
      } else if (source === 'permission_request') {
        permissions[run.conversationId] = {
          runId,
          requestId: String(data?.requestId ?? ''),
          toolName: String(data?.toolName ?? 'tool'),
          displayName: data?.displayName ? String(data.displayName) : undefined,
          input: (data?.input as Record<string, unknown>) ?? {},
          description: data?.description ? String(data.description) : undefined,
          suggestions: Array.isArray(data?.suggestions) ? data.suggestions : undefined,
        };
      } else if (source === 'rate_limit') {
        rateLimit = data as RateLimitInfo;
        return;
      } else if (source === 'init') {
        // reserved: model and tool inventory of the run
      } else if (source === 'assistant') {
        const last = run.messages.findLast((m) => m.role === 'agent' && m.streaming);
        if (last) {
          last.content += line;
        } else {
          run.messages.push({ role: 'agent', content: line, time: now(), streaming: true });
        }
      } else if (source === 'tool') {
        // Tools run sequentially: a new tool means the previous one finished.
        const pending = run.activity.find((a) => a.source === 'tool' && !a.done);
        if (pending) pending.done = true;
        run.activity.push({ time: now(), icon: iconForTool(summary), label: line, source: 'tool' });
      } else if (source === 'session' && !run.foreignProvider) {
        setConversationSession(refOf(inst, run.scope), run.conversationId, line);
      }

      persistRun(inst, run);
      if (isLive) autoscroll();
    });

    await autoscroll();
  });

  onDestroy(() => {
    unlisten?.();
  });

  /**
   * The provider an agent runs on: its own when it pins one, otherwise the
   * conversation's. A model belongs to the provider that serves it, so the two
   * are resolved together - never a model from one provider on another.
   */
  function resolveAgentProvider(conv: Conversation, agent: CustomAgent | undefined): string {
    const own = agent?.providerId;
    if (own && selectableProviders.some((p) => p.id === own)) return own;
    return currentProvider?.id ?? conv.providerId;
  }

  function buildRunOptions(
    conv: Conversation,
    agent: CustomAgent | undefined,
    providerId: string,
    switchedProvider: boolean,
  ): RunOptions {
    const options: RunOptions = {};
    // A model picked in the composer belongs to the conversation's provider, so
    // it only survives when the agent did not send the run somewhere else.
    if (conv.modelId && !switchedProvider) options.model = conv.modelId;
    if (conv.effort) options.effort = conv.effort;
    if (conv.permissionMode) options.permissionMode = conv.permissionMode;

    if (agent?.systemPrompt) options.systemPrompt = agent.systemPrompt;
    if (agent?.model && (switchedProvider || !conv.modelId)) options.model = agent.model;
    if (agent?.effort) options.effort = agent.effort;
    if (agent?.permissionMode) options.permissionMode = agent.permissionMode;
    if (agent?.allowedTools?.length) options.allowedTools = agent.allowedTools;
    if (agent?.disallowedTools?.length) options.disallowedTools = agent.disallowedTools;
    if (agent?.overrideParams) {
      options.temperature = agent.temperature;
      options.maxTokens = agent.maxTokens;
    }

    if (PROVIDERS.find((p) => p.id === providerId)?.kind === 'api') {
      options.history = conv.messages
        .filter((m) => (m.role === 'user' || m.role === 'agent') && m.content)
        .slice(0, -2)
        .slice(-20)
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
    const req = pendingPermission;
    const conv = current;
    if (!req || !conv) return;
    delete permissions[conv.id];

    const response: PermissionResponse =
      decision === 'deny'
        ? { behavior: 'deny', message: t('agent.permission.denied') as string }
        : {
            behavior: 'allow',
            updatedInput: req.input,
            ...(decision === 'always' && req.suggestions?.length
              ? { updatedPermissions: req.suggestions }
              : {}),
          };

    conv.activity.push({
      time: now(),
      icon: 'shield',
      label: `${req.displayName ?? req.toolName}: ${decision === 'deny' ? (t('agent.permission.deny') as string) : (t('agent.permission.allow') as string)}`,
      source: 'system',
      done: true,
      failed: decision === 'deny',
    });

    try {
      await respondPermission(req.runId, req.requestId, response);
    } catch (e) {
      conv.error = String(e);
    }
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

    if (!conv.draft.trim() || runOfConversation(conv.id)) return;

    const message = conv.draft.trim();
    conv.draft = '';
    drafts[conv.id] = '';
    popupOpen = false;
    await tick();
    resizeTextarea();
    conv.error = '';
    await sendPrompt(inst, conv, message);
  }

  async function sendPrompt(inst: Instance, conv: Conversation, message: string) {

    const agent = mentionedAgent(message);
    const runProviderId = resolveAgentProvider(conv, agent);
    const switchedProvider = runProviderId !== (currentProvider?.id ?? conv.providerId);
    const options = buildRunOptions(conv, agent, runProviderId, switchedProvider);

    const t_now = now();
    conv.messages.push({ role: 'user', content: message, time: t_now });
    conv.messages.push({ role: 'agent', content: '', time: t_now, streaming: true });
    conv.activity.push({ time: t_now, icon: 'send', label: message.slice(0, 160) + (message.length > 160 ? '...' : ''), source: 'stdin' });

    const runId = crypto.randomUUID();
    const run: Run = {
      instanceId: inst.id,
      conversationId: conv.id,
      scope: conv.scope,
      messages: conv.messages,
      activity: conv.activity,
      foreignProvider: switchedProvider,
    };
    runs[runId] = run;
    setBusy(inst, conv.id, true);

    const ref = refOf(inst, conv.scope);
    const isFirstPrompt = conv.messages.filter((m) => m.role === 'user').length === 1;
    if (isFirstPrompt) renameConversation(ref, conv.id, deriveConversationTitle(message));
    syncLive(inst);

    await autoscroll();

    try {
      const sessionId = switchedProvider
        ? null
        : (conversationsOf(ref).find((c) => c.id === conv.id)?.sessionId ?? null);
      const env = await prepareInstanceEnv(get(activeProject), inst);
      await sendMessage(message, inst.worktreePath, runProviderId, runId, sessionId, env, options);
    } catch (e) {
      conv.error = String(e);
      setBusy(inst, conv.id, false);
      endStreaming(run);
      persistRun(inst, run);
      delete runs[runId];
    }
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
    const previous = conversations[inst.id];
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

  $effect(() => {
    const inst = $activeInstance;
    if (!inst) return;
    void listAgentCommands(inst.worktreePath)
      .then((cmds) => { slashCommands = cmds; })
      .catch(() => { slashCommands = []; });
  });

  function updatePopup() {
    if (!textareaEl || !current) { popupOpen = false; return; }
    const caret = textareaEl.selectionStart ?? 0;
    const before = current.draft.slice(0, caret);

    const slash = before.match(/^\/([\w-]*)$/);
    if (slash) {
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
    const token = item.insert;
    const start = popupKind === 'command' ? 0 : before.lastIndexOf('@');
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

  const handleCreate = withInstance((_inst, scope: ConversationScope) => {
    void newSession(scope);
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
    if (conversations[inst.id]?.id === id) {
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
    if (conversations[inst.id]?.id === id) {
      conversations[inst.id].scope = from === 'instance' ? 'project' : 'instance';
    }
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
      onCreate={handleCreate}
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
        {t('agent.title')}
      </div>
      <div class="pane-actions">
        <button class="btn ghost" onclick={() => newSession()} disabled={!current || conversationBusy}>
          <Icon name="plus" size={13}/> {t('agent.restart')}
        </button>
      </div>
    </div>

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
      {#each current?.messages ?? [] as m, i}
        {#if m.role === 'system'}
          <div style="font-size: 11px; color: var(--fg-3); font-family: var(--font-mono); text-align: center; padding: 4px 0; border-bottom: 1px dashed var(--stroke-0); margin-bottom: 6px;">
            <Icon name="flag" size={11} style="margin-right: 6px; vertical-align: -1px;"/>
            {m.content} · {m.time}
          </div>
        {:else}
          <div class="msg {m.role}" data-msg={i} class:flash={flashedMessage === i}>
            <div class="meta">
              <span class="role">
                {#if m.role === 'user'}
                  {t('agent.you')}
                {:else}
                  <Icon name="sparkles" size={12}/>{answerLabel(m)}
                {/if}
              </span>
              <span>·</span>
              <span class:meta-hidden={!$settings.agentShowMessageTime}>{m.time}</span>
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
            {#if m.thinking && $settings.agentShowThinking}
              <details class="thinking-block">
                <summary><Icon name="wand" size={11}/> {t('agent.thinking')}</summary>
                <div class="thinking-content selectable">{m.thinking}</div>
              </details>
            {/if}
            <div class="bubble selectable">
              {#if m.streaming && !m.content}
                <p><span class="typing-dots"><span></span><span></span><span></span></span></p>
              {:else}
                {#if m.role === 'agent'}
                  {@html renderMarkdown(m.content)}
                {:else}
                  <p>{m.content}</p>
                {/if}
              {/if}
            </div>
            {#if m.role === 'agent' && m.usage && $settings.agentShowResponseStats}
              {@const stats = responseStats(m.usage, $settings.agentResponseStats, (id) => modelLabel(currentProvider?.id ?? '', id))}
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
        {/if}
      {/each}
      {#if pendingPermission}
        <div class="permission-card" class:plan={permissionIsPlan}>
          <div class="permission-head">
            <Icon name="shield" size={13}/>
            {#if permissionIsPlan}
              {t('agent.permission.planTitle')}
            {:else}
              {t('agent.permission.title')} - {pendingPermission.displayName ?? pendingPermission.toolName}
            {/if}
          </div>
          {#if permissionIsPlan}
            <div class="permission-plan selectable">
              {@html renderMarkdown(String(pendingPermission.input.plan ?? ''))}
            </div>
          {:else}
            {#if pendingPermission.description}
              <div class="permission-desc">{pendingPermission.description}</div>
            {/if}
            {#if permissionPreview}
              <code class="permission-preview selectable">{permissionPreview}</code>
            {/if}
          {/if}
          <div class="permission-actions">
            {#if permissionIsPlan}
              <button class="perm-btn allow" onclick={() => answerPermission('allow')}>
                <Icon name="check" size={12}/> {t('agent.permission.approvePlan')}
              </button>
              <button class="perm-btn" onclick={() => answerPermission('deny')}>
                {t('agent.permission.keepPlanning')}
              </button>
            {:else}
              <button class="perm-btn allow" onclick={() => answerPermission('allow')}>
                <Icon name="check" size={12}/> {t('agent.permission.allow')}
              </button>
              {#if pendingPermission.suggestions?.length}
                <button class="perm-btn" onclick={() => answerPermission('always')}>
                  {t('agent.permission.alwaysAllow')}
                </button>
              {/if}
              <button class="perm-btn deny" onclick={() => answerPermission('deny')}>
                <Icon name="x" size={12}/> {t('agent.permission.deny')}
              </button>
            {/if}
          </div>
        </div>
      {/if}
      {/if}
    </div>

    <div class="chat-input-wrap">
      <div class="chat-input">
        {#if popupOpen && popupItems.length > 0}
          <div class="mention-popup">
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
                {:else}
                  <Icon name="command" size={11}/>
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
            placeholder={conversationBusy ? (t('agent.waitingResponse') as string) : (t('agent.inputPlaceholder') as string)}
            bind:value={current.draft}
            oninput={onInput}
            onkeydown={onKeydown}
            onclick={updatePopup}
            disabled={conversationBusy}
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
              class:warn={contextPct >= 80}
              title={`${t('agent.contextWindow')}: ${contextTokens.toLocaleString()} / ${contextWindow.toLocaleString()} tokens`}
            >
              <span class="ctx-bar"><span class="ctx-fill" style="width: {contextPct}%"></span></span>
              {contextPct}%
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
                    {#each Object.entries(sessionStats.models) as [model, s]}
                      <span class="stats-model" title={model}>{model}</span>
                      <span class="stats-val">{fmtTokens(s.inTok)}</span>
                      <span class="stats-val">{fmtTokens(s.outTok)}</span>
                      <span class="stats-val">{s.cost > 0 ? `$${s.cost.toFixed(4)}` : '-'}</span>
                    {/each}
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
  </div>

  {#if $settings.agentShowLiveActivity}
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
                class:linked={target >= 0}
                role="button"
                tabindex={target >= 0 ? 0 : -1}
                aria-disabled={target < 0}
                title={target >= 0 ? (t('agent.activityJump') as string) : undefined}
                onclick={() => revealMessage(target)}
                onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); revealMessage(target); } }}
              >
                <span class="la-rail" class:last={i === activityEntries.length - 1}>
                  <span class="la-bubble"><Icon name={entry.icon} size={12}/></span>
                </span>
                <div class="la-body">
                  <div class="la-line">
                    <span class="la-label" title={entry.label}>
                      {entry.source === 'tool' && sep > -1 ? entry.label.slice(0, sep) : entry.label}
                    </span>
                    {#if $settings.agentActivityShowTime}
                      <span class="la-time selectable">{entry.time}</span>
                    {/if}
                  </div>
                  {#if entry.source === 'tool' && sep > -1 && $settings.agentActivityShowToolArgs}
                    <span class="la-arg selectable" title={entry.label.slice(sep + 2)}>
                      {entry.label.slice(sep + 2)}
                    </span>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

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
  :global(.msg.flash) {
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

  .pane-title-sep {
    width: 1px;
    height: 14px;
    margin: 0 8px 0 4px;
    background: var(--stroke-1);
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

  .mention-popup {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 0;
    z-index: 60;
    min-width: 260px;
    max-width: 420px;
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

  .btn-stop {
    background: var(--danger-weak, rgba(255, 80, 80, 0.08));
    border-color: var(--danger-line, rgba(255, 80, 80, 0.3));
    color: #ff8080;
  }

  .btn-stop:hover {
    background: rgba(255, 80, 80, 0.15);
    border-color: rgba(255, 80, 80, 0.5);
    color: #ffaaaa;
  }
</style>
