<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';

  type EventKind = 'minor' | 'milestone' | 'checkpoint' | 'current';

  interface TimelineEvent {
    t: string;
    kind: EventKind;
    label: string;
  }

  const EVENTS: TimelineEvent[] = [
    { t: '09:12', kind: 'minor',      label: 'Instance created from FEAT-42' },
    { t: '09:13', kind: 'minor',      label: 'Agent session started' },
    { t: '09:14', kind: 'milestone',  label: 'Ticket context loaded' },
    { t: '09:16', kind: 'minor',      label: 'Read src/auth/*' },
    { t: '09:22', kind: 'checkpoint', label: 'Before generating code' },
    { t: '09:26', kind: 'milestone',  label: 'Created src/auth/totp.ts' },
    { t: '09:29', kind: 'minor',      label: 'Edited src/auth/index.ts' },
    { t: '09:34', kind: 'milestone',  label: 'Tests written (8 new)' },
    { t: '09:37', kind: 'checkpoint', label: 'Before db migration' },
    { t: '09:40', kind: 'minor',      label: 'Created migration 023_totp.sql' },
    { t: '09:43', kind: 'minor',      label: 'npm test — 8 pass, 1 fail' },
    { t: '09:45', kind: 'current',    label: 'Agent is fixing failing test' },
  ];

  let hoveredIndex: number | null = null;
</script>

<div class="timeline-wrap">
  <div class="tl-meta">
    <span class="tl-label">Timeline</span>
    <span class="tl-info">FEAT-42 · 32m · 2 checkpoints</span>
    <div class="tl-spacer"></div>
    <button class="tl-checkpoint-btn">
      <Icon name="bookmark" size={11}/> Save checkpoint
    </button>
  </div>

  <div class="tl-track-wrap">
    <div class="tl-track">
      <div class="tl-line"></div>

      {#each EVENTS as e, i}
        <div
          class="tl-event tl-{e.kind}"
          role="button"
          tabindex="0"
          on:mouseenter={() => hoveredIndex = i}
          on:mouseleave={() => hoveredIndex = null}
          on:keydown={() => {}}
        >
          <div class="tl-dot"></div>
          {#if e.kind === 'checkpoint'}
            <span class="tl-ckpt-label">{e.t}</span>
          {:else if e.kind === 'current'}
            <span class="tl-now-label">now</span>
          {/if}

          {#if hoveredIndex === i}
            <div class="tl-tooltip">
              <div class="tl-tooltip-label">{e.label}</div>
              <div class="tl-tooltip-time">{e.t}</div>
              {#if e.kind === 'checkpoint'}
                <div class="tl-tooltip-rewind">← Rewind here</div>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .timeline-wrap {
    flex-shrink: 0;
    border-top: 1px solid var(--stroke-0);
    background: var(--bg-1);
    padding: 6px 16px 8px;
  }

  .tl-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }

  .tl-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--fg-2);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    font-family: var(--font-mono);
  }

  .tl-info {
    font-size: 11px;
    color: var(--fg-3);
    font-family: var(--font-mono);
  }

  .tl-spacer { flex: 1; }

  .tl-checkpoint-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 3px 10px;
    background: none;
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-sm);
    color: var(--fg-2);
    font-size: 11px;
    font-family: var(--font-ui);
    cursor: pointer;
  }
  .tl-checkpoint-btn:hover {
    border-color: var(--accent);
    color: var(--fg-0);
  }

  .tl-track-wrap {
    overflow-x: auto;
    scrollbar-width: none;
  }
  .tl-track-wrap::-webkit-scrollbar { display: none; }

  .tl-track {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0;
    height: 32px;
    min-width: max-content;
    padding: 0 8px;
  }

  .tl-line {
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    transform: translateY(-50%);
    height: 1px;
    background: var(--stroke-1);
  }

  /* Events */
  .tl-event {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    cursor: pointer;
    z-index: 1;
  }

  /* Spacing between events */
  .tl-event + .tl-event { margin-left: 28px; }
  .tl-event.tl-checkpoint + .tl-event,
  .tl-event + .tl-event.tl-checkpoint { margin-left: 36px; }

  .tl-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--stone-1);
    border: 1.5px solid var(--bg-1);
    transition: transform 0.1s;
  }

  .tl-event:hover .tl-dot { transform: scale(1.4); }

  /* Variants */
  .tl-milestone .tl-dot {
    width: 10px;
    height: 10px;
    background: var(--stone-2);
  }

  .tl-checkpoint .tl-dot {
    width: 11px;
    height: 11px;
    border-radius: 2px;
    transform: rotate(45deg);
    background: var(--accent);
    border-color: var(--bg-1);
  }
  .tl-checkpoint:hover .tl-dot { transform: rotate(45deg) scale(1.3); }

  .tl-current .tl-dot {
    width: 11px;
    height: 11px;
    background: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-weak);
  }

  /* Labels under checkpoints */
  .tl-ckpt-label {
    position: absolute;
    top: calc(50% + 10px);
    font-size: 9.5px;
    font-family: var(--font-mono);
    color: var(--accent);
    white-space: nowrap;
  }

  .tl-now-label {
    position: absolute;
    top: calc(50% + 10px);
    font-size: 9.5px;
    font-family: var(--font-mono);
    color: var(--accent);
  }

  /* Tooltip */
  .tl-tooltip {
    position: absolute;
    bottom: calc(50% + 12px);
    left: 50%;
    transform: translateX(-50%);
    background: var(--bg-3);
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-sm);
    padding: 6px 10px;
    white-space: nowrap;
    pointer-events: none;
    z-index: 10;
  }

  .tl-tooltip-label {
    font-size: 12px;
    color: var(--fg-0);
  }

  .tl-tooltip-time {
    font-size: 10.5px;
    font-family: var(--font-mono);
    color: var(--fg-3);
    margin-top: 2px;
  }

  .tl-tooltip-rewind {
    font-size: 10.5px;
    color: var(--accent);
    margin-top: 4px;
    cursor: pointer;
  }
</style>
