<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { GitGraphCommit } from '$lib/services/git-service';
  import type { Instance } from '$lib/types/instance';

  export let commits: GitGraphCommit[];
  export let currentBranch: string;
  export let instances: Instance[] = [];

  const dispatch = createEventDispatcher<{ switchInstance: Instance }>();

  $: branchToInstance = new Map(instances.map(i => [i.branch, i]));

  const ROW_H  = 36;
  const COL_W  = 22;
  const HALF   = COL_W / 2;
  const DOT_R  = 4;
  const STROKE = 2;

  const PALETTE = [
    '#6b9eff',
    '#c47cf5',
    '#f08c3a',
    '#4ec97a',
    '#f06070',
    '#e8c245',
    '#38d4c4',
    '#e066c4',
  ];

  const CHIPS_LINE_H = 22;

  interface LaneState { targetHash: string; color: string; }
  interface PathDef   { d: string; color: string; }
  interface RefChip   { label: string; kind: 'head' | 'head-branch' | 'local' | 'remote' | 'tag'; }

  interface GraphRow {
    commit: GitGraphCommit;
    lane: number;
    color: string;
    paths: PathDef[];
    maxLaneInRow: number;
    belowLanes: Array<{ idx: number; color: string }>;
  }

  function laneX(lane: number): number { return lane * COL_W + HALF; }

  function computeGraph(commits: GitGraphCommit[]): GraphRow[] {
    const lanes: (LaneState | null)[] = [];
    let colorIdx = 0;

    return commits.map(commit => {
      const above = lanes.map(l => l ? { ...l } : null);
      const tracking = above
        .map((l, i) => ({ i, l }))
        .filter(({ l }) => l?.targetHash === commit.hash);

      let myLane: number;
      let myColor: string;

      if (tracking.length > 0) {
        myLane  = tracking[0].i;
        myColor = tracking[0].l!.color;
      } else {
        myLane = lanes.findIndex(l => l === null);
        if (myLane === -1) { myLane = lanes.length; lanes.push(null); }
        myColor = PALETTE[colorIdx++ % PALETTE.length];
      }

      for (const { i } of tracking) lanes[i] = null;

      if (commit.parents.length > 0) {
        lanes[myLane] = { targetHash: commit.parents[0], color: myColor };
      }

      for (let pi = 1; pi < commit.parents.length; pi++) {
        const ph = commit.parents[pi];
        if (lanes.some(l => l?.targetHash === ph)) continue;
        let slot = lanes.findIndex(l => l === null);
        if (slot === -1) { slot = lanes.length; lanes.push(null); }
        lanes[slot] = { targetHash: ph, color: PALETTE[colorIdx++ % PALETTE.length] };
      }

      while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();

      const below  = lanes.map(l => l ? { ...l } : null);
      const cx     = laneX(myLane);
      const midY   = ROW_H / 2;
      const paths: PathDef[] = [];
      const maxLen = Math.max(above.length, below.length, myLane + 1);

      for (let li = 0; li < maxLen; li++) {
        const a  = li < above.length ? above[li] : null;
        const b  = li < below.length ? below[li] : null;
        const ax = laneX(li);

        if (li === myLane) {
          if (a) paths.push({ d: `M ${cx} 0 L ${cx} ${midY}`,        color: myColor });
          if (b) paths.push({ d: `M ${cx} ${midY} L ${cx} ${ROW_H}`, color: myColor });
        } else if (a?.targetHash === commit.hash) {
          const cp = midY * 0.75;
          paths.push({
            d: `M ${ax} 0 C ${ax} ${cp * 2} ${cx} ${midY - cp * 0.5} ${cx} ${midY}`,
            color: a.color,
          });
        } else if (!a && b) {
          const cp = midY * 0.75;
          paths.push({
            d: `M ${cx} ${midY} C ${cx} ${midY + cp * 0.5} ${ax} ${ROW_H - cp * 2} ${ax} ${ROW_H}`,
            color: b.color,
          });
        } else if (a && b) {
          paths.push({ d: `M ${ax} 0 L ${ax} ${ROW_H}`, color: a.color });
        }
      }

      const maxLaneInRow = Math.max(myLane, maxLen - 1, 0);
      const belowLanes = below
        .map((l, idx) => l ? { idx, color: l.color } : null)
        .filter((x): x is { idx: number; color: string } => x !== null);
      return { commit, lane: myLane, color: myColor, paths, maxLaneInRow, belowLanes };
    });
  }

  function parseRefs(refs: string[]): RefChip[] {
    const chips: RefChip[] = [];
    for (const r of refs) {
      if (r.startsWith('HEAD -> ')) {
        chips.push({ label: r.slice(8), kind: 'head-branch' });
      } else if (r === 'HEAD') {
        chips.push({ label: 'HEAD', kind: 'head' });
      } else if (r.startsWith('tag: ')) {
        chips.push({ label: r.slice(5), kind: 'tag' });
      } else if (r.includes('/')) {
        chips.push({ label: r, kind: 'remote' });
      } else {
        chips.push({ label: r, kind: 'local' });
      }
    }
    const order: Record<RefChip['kind'], number> = {
      'head-branch': 0, 'head': 1, 'local': 2, 'remote': 3, 'tag': 4,
    };
    return chips.sort((a, b) => order[a.kind] - order[b.kind]);
  }

  function relativeTime(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'now';
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d}d`;
    if (d < 365) return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return new Date(dateStr).toLocaleDateString(undefined, { year: 'numeric', month: 'short' });
  }

  $: rows = computeGraph(commits);
  $: globalMaxLane = rows.reduce((acc, r) => Math.max(acc, r.maxLaneInRow), 0);
  $: svgW = (globalMaxLane + 1) * COL_W + HALF + 4;

  // Set of commit hashes reachable from the current branch HEAD
  $: currentBranchAncestors = (() => {
    const headRow = rows.find(r =>
      r.commit.refs.some(ref =>
        ref === currentBranch ||
        ref === `HEAD -> ${currentBranch}` ||
        ref.endsWith(`-> ${currentBranch}`)
      )
    );
    if (!headRow) return new Set<string>();
    const visited = new Set<string>();
    const queue = [headRow.commit.hash];
    const byHash = new Map(commits.map(c => [c.hash, c]));
    while (queue.length > 0) {
      const hash = queue.pop()!;
      if (visited.has(hash)) continue;
      visited.add(hash);
      for (const p of byHash.get(hash)?.parents ?? []) queue.push(p);
    }
    return visited;
  })();
</script>

<div class="graph-scroll">
  {#each rows as row}
    {@const chips = parseRefs(row.commit.refs)}
    {@const isCurrent = row.commit.refs.some(r =>
      r === currentBranch || r.endsWith(`-> ${currentBranch}`) || r === `HEAD -> ${currentBranch}`
    )}
    {@const isOnBranch = currentBranchAncestors.has(row.commit.hash)}
    <div
      class="commit-outer"
      class:is-current={isCurrent}
      class:is-on-branch={isOnBranch && !isCurrent}
    >
      <div class="graph-row">
        <svg
          class="graph-svg"
          width={svgW}
          height={ROW_H}
          viewBox="0 0 {svgW} {ROW_H}"
          style="width:{svgW}px"
        >
          {#each row.paths as p}
            <path
              d={p.d}
              stroke={p.color}
              stroke-width={STROKE}
              fill="none"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          {/each}
          {#if isCurrent}
            <circle cx={laneX(row.lane)} cy={ROW_H / 2} r={DOT_R + 3} fill="none" stroke={row.color} stroke-width="1.5" />
          {/if}
          <circle cx={laneX(row.lane)} cy={ROW_H / 2} r={DOT_R} fill={row.color} />
        </svg>

        <div class="row-body">
          <span class="commit-text">{row.commit.message}</span>
          <span class="row-meta">
            <span class="meta-hash">{row.commit.shortHash}</span>
            <span class="meta-sep">·</span>
            <span class="meta-date">{relativeTime(row.commit.date)}</span>
          </span>
        </div>
      </div>

      {#if chips.length > 0}
        <div class="chips-strip" style="padding-left:{svgW + 4}px">
          {#each row.belowLanes as bl}
            <div class="chips-lane-line" style="left:{laneX(bl.idx) - 1}px; background:{bl.color}"></div>
          {/each}
          {#each chips as chip}
            {@const linkedInstance = branchToInstance.get(chip.label)}
            <span
              class="ref-chip chip-{chip.kind}"
              class:chip-linked={!!linkedInstance}
              role={linkedInstance ? 'button' : undefined}
              style={chip.kind === 'head-branch' || chip.kind === 'local'
                ? `--chip-color:${row.color};`
                : ''}
              on:click={linkedInstance ? () => dispatch('switchInstance', linkedInstance) : undefined}
              on:keydown={linkedInstance ? (e) => e.key === 'Enter' && dispatch('switchInstance', linkedInstance) : undefined}
            >
              {chip.label}
              {#if linkedInstance}
                <span class="chip-ticket">{linkedInstance.ticket.id}</span>
              {/if}
            </span>
          {/each}
        </div>
      {/if}
    </div>
  {/each}

  {#if commits.length === 0}
    <div class="graph-empty">No commits yet.</div>
  {/if}
</div>

<style>
  .graph-scroll {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .commit-outer {
    cursor: default;
    transition: background 50ms;
    position: relative;
  }
  .commit-outer:hover                    { background: var(--bg-2); }
  .commit-outer.is-on-branch              { background: color-mix(in srgb, var(--accent) 3%, transparent); }
  .commit-outer.is-on-branch .commit-text { color: var(--fg-0); }
  .commit-outer.is-current               { background: color-mix(in srgb, var(--accent) 7%, transparent); }
  .commit-outer.is-current .commit-text  { color: var(--fg-0); }

  .graph-row {
    display: flex;
    align-items: center;
    height: 36px;
  }

  .graph-svg {
    display: block;
    flex-shrink: 0;
  }

  .row-body {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 10px 0 4px;
  }

  .commit-text {
    flex: 1;
    min-width: 0;
    font-size: 12.5px;
    font-family: var(--font-ui);
    color: var(--fg-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    letter-spacing: -0.01em;
  }

  /* Chips strip — dedicated row below the commit line */
  .chips-strip {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    padding: 2px 10px 6px 0;
    position: relative;
  }
  .chips-lane-line {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    border-radius: 1px;
    pointer-events: none;
  }

  .ref-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    padding: 0 5px;
    height: 16px;
    border-radius: var(--r-xs);
    font-family: var(--font-mono);
    white-space: nowrap;
    font-weight: 500;
    letter-spacing: 0.01em;
  }

  .chip-linked {
    cursor: pointer;
  }
  .chip-linked:hover {
    filter: brightness(1.2);
  }

  .chip-ticket {
    font-size: 9px;
    opacity: 0.65;
    font-weight: 400;
    letter-spacing: 0.02em;
  }

  /* HEAD → branch: solid colored background, most prominent */
  .chip-head-branch {
    background: color-mix(in srgb, var(--chip-color, var(--accent)) 22%, transparent);
    color: var(--chip-color, var(--accent));
    outline: 1px solid color-mix(in srgb, var(--chip-color, var(--accent)) 40%, transparent);
    outline-offset: -1px;
  }

  /* Detached HEAD */
  .chip-head {
    background: color-mix(in srgb, var(--warning) 18%, transparent);
    color: var(--warning);
    outline: 1px solid color-mix(in srgb, var(--warning) 40%, transparent);
    outline-offset: -1px;
  }

  /* Other local branches */
  .chip-local {
    color: var(--chip-color, var(--fg-2));
    outline: 1px solid color-mix(in srgb, var(--chip-color, var(--fg-2)) 35%, transparent);
    outline-offset: -1px;
  }

  /* Remote refs: deliberately muted */
  .chip-remote {
    color: var(--fg-3);
    outline: 1px solid var(--stroke-1);
    outline-offset: -1px;
  }

  /* Tags */
  .chip-tag {
    background: color-mix(in srgb, #e8c245 14%, transparent);
    color: #c9a030;
    outline: 1px solid color-mix(in srgb, #e8c245 35%, transparent);
    outline-offset: -1px;
  }

  /* Meta: always at the far right, never pushes out */
  .row-meta {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .meta-hash {
    font-size: 10px;
    font-family: var(--font-mono);
    color: var(--fg-4);
    letter-spacing: 0.02em;
  }

  .meta-sep {
    font-size: 9px;
    color: var(--fg-4);
    opacity: 0.5;
    user-select: none;
  }

  .meta-date {
    font-size: 10px;
    font-family: var(--font-mono);
    color: var(--fg-4);
    min-width: 22px;
    text-align: right;
  }

  .graph-empty {
    padding: 48px 20px;
    font-size: 12px;
    font-family: var(--font-ui);
    color: var(--fg-4);
    text-align: center;
  }
</style>
