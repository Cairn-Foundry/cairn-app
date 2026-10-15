<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * The status of a running conversation as a dot: pulsing while it works,
   * solid when it is the user's turn, hollow once its CLI exited. A running
   * conversation with nothing to report gets a faint dot - running is all Cairn
   * knows about it.
   */
  import { t } from '$lib/i18n';
  import type { AgentStatus } from '$lib/utils/agent/agent-status';

  interface Props {
    status: AgentStatus | undefined;
  }

  const { status }: Props = $props();

  const LABELS = {
    working: 'agent.status.working',
    waiting: 'agent.status.waiting',
    done: 'agent.status.done',
    exited: 'agent.status.exited',
    running: 'agent.status.running',
  } as const;

  let label = $derived(t(LABELS[status ?? 'running']) as string);
</script>

<!-- Rebuilt on every change: WebKitGTK can leave an animated element on its
     old composited layer when only its class changes, pulsing on as it was. -->
{#key status}
  <span class="agent-dot {status ?? 'running'}" title={label} aria-label={label} role="img"></span>
{/key}

<style>
  .agent-dot {
    display: inline-block;
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--fg-3);
  }
  .agent-dot.running { opacity: 0.6; }
  .agent-dot.working {
    background: var(--accent);
    animation: agent-pulse 1.4s ease-in-out infinite;
  }
  .agent-dot.waiting { background: var(--warning); }
  .agent-dot.done { background: var(--success); }
  .agent-dot.exited {
    background: transparent;
    box-shadow: inset 0 0 0 1.5px var(--fg-3);
  }
  @keyframes agent-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.35; transform: scale(0.8); }
  }
  @media (prefers-reduced-motion: reduce) {
    .agent-dot.working { animation: none; }
  }
</style>
