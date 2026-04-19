<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';

  const TIMELINE_EVENTS = [
    { t: '09:12', kind: 'minor', label: 'Instance created from FEAT-42' },
    { t: '09:12', kind: 'minor', label: 'git worktree + feat/totp-auth' },
    { t: '09:13', kind: 'minor', label: 'Agent session started (profile: feature)' },
    { t: '09:14', kind: 'major', size: 3, label: 'Ticket context loaded' },
    { t: '09:16', kind: 'minor', label: 'Read src/auth/*' },
    { t: '09:18', kind: 'minor', label: 'Read package.json' },
    { t: '09:22', kind: 'checkpoint', label: 'Before generating code', flag: 'safe point' },
    { t: '09:24', kind: 'minor', label: 'Added otplib@12.0.1' },
    { t: '09:26', kind: 'major', size: 2, label: 'Created src/auth/totp.ts' },
    { t: '09:29', kind: 'minor', label: 'Edited src/auth/index.ts' },
    { t: '09:31', kind: 'minor', label: 'Edited src/routes/auth.ts' },
    { t: '09:34', kind: 'major', size: 4, label: 'Tests written (8 new)' },
    { t: '09:37', kind: 'checkpoint', label: 'Before db migration', flag: 'safe point' },
    { t: '09:40', kind: 'minor', label: 'Created migration 023_totp.sql' },
    { t: '09:43', kind: 'minor', label: 'npm test — 8 pass, 1 fail' },
    { t: '09:45', kind: 'current', label: 'Agent is fixing failing test', flag: 'now' },
  ];

  function getSizes(size: number): string[] {
    if (size === 4) return ['s1', 's2', 's3', 's4'];
    if (size === 3) return ['s1', 's2', 's3'];
    return ['s1', 's2'];
  }
</script>

<div class="timeline-wrap">
  <div class="timeline-head">
    <span class="title">Timeline</span>
    <span class="muted">· FEAT-42 · 32m elapsed · 2 checkpoints</span>
    <div class="spacer"/>
    <button class="save-chk"><Icon name="bookmark" size={12}/> Save checkpoint</button>
  </div>
  <div class="cairn-track">
    <div class="cairn-ground"/>
    {#each TIMELINE_EVENTS as e, i}
      {#if e.kind === 'minor'}
        <div class="cairn-cell minor">
          <div class="stone"/>
          <div class="time-label">{e.t}</div>
          <div class="stone-tooltip">
            <div class="label">{e.label}</div>
            <div class="t">{e.t}</div>
          </div>
        </div>
      {:else if e.kind === 'major'}
        <div class="cairn-cell major">
          <div class="cairn-stack">
            {#each getSizes(e.size ?? 2) as s}
              <div class="stone {s}"/>
            {/each}
          </div>
          <div class="time-label">{e.t}</div>
          <div class="stone-tooltip">
            <div class="label">{e.label}</div>
            <div class="t">{e.t} · milestone</div>
          </div>
        </div>
      {:else if e.kind === 'checkpoint'}
        <div class="cairn-cell major">
          <div class="cairn-stack checkpoint">
            <span class="ckflag"><Icon name="bookmark" size={9}/> ckpt</span>
            <div class="stone s1"/>
            <div class="stone s2"/>
            <div class="stone s3"/>
            <div class="stone s4"/>
          </div>
          <div class="time-label" style="color: var(--accent)">{e.t}</div>
          <div class="stone-tooltip">
            <div class="label">{e.label}</div>
            <div class="t">{e.t} · saved checkpoint</div>
            <span class="restore">← Rewind to here</span>
          </div>
        </div>
      {:else if e.kind === 'current'}
        <div class="cairn-cell major current">
          <div class="cairn-stack">
            <span class="ckflag" style="color: var(--accent)">now</span>
            <div class="stone s1" style="background: var(--accent)"/>
            <div class="stone s2"/>
            <div class="stone s3"/>
          </div>
          <div class="time-label">{e.t}</div>
          <div class="stone-tooltip">
            <div class="label">{e.label}</div>
            <div class="t">{e.t} · current position</div>
          </div>
        </div>
      {/if}
    {/each}
    <div style="width: 60px; flex-shrink: 0"/>
  </div>
</div>
