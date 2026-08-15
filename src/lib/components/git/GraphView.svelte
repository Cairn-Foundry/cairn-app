<script lang="ts">
  /**
   * Commit graph: lays commits out into coloured lanes drawn as SVG paths, with
   * ref chips, search and infinite scroll.
   * Instances are matched to commits by branch name to offer switching or branching off a ref.
   */
  import { createEventDispatcher } from 'svelte';
  import type { GitGraphCommit } from '$lib/services/git-service';
  import type { Instance } from '$lib/types/instance';
  import Icon from '$lib/components/Icon.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import { t } from '$lib/i18n';

  export let commits: GitGraphCommit[];
  export let currentBranch: string;
  export let instances: Instance[] = [];
  export let selectedHash = '';
  export let hasMore = false;

  const dispatch = createEventDispatcher<{ switchInstance: Instance; createInstanceFromRef: string; selectCommit: GitGraphCommit; loadMore: void; searchToggle: boolean; refresh: void }>();

  let isLoadingMore = false;
  let lastCount = 0;
  $: if (commits.length !== lastCount) { lastCount = commits.length; isLoadingMore = false; }

  /** Asks for another page once the scroll gets within 200px of the bottom. */
  function handleScroll(e: Event) {
    if (isLoadingMore || !hasMore) return;
    const el = e.currentTarget as HTMLElement;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
      isLoadingMore = true;
      dispatch('loadMore');
    }
  }

  $: branchToInstance = new Map(instances.map(i => [i.branch, i]));

  let graphSearch = '';

  let branchTip: { x: number; y: number; label: string } | null = null;

  function showBranchTip(e: MouseEvent, label: string | undefined) {
    if (!label) return;
    branchTip = { x: e.clientX, y: e.clientY, label };
  }
  function hideBranchTip() {
    branchTip = null;
  }

  let searchActive = false;
  $: {
    const active = graphSearch.trim().length > 0;
    if (active !== searchActive) {
      searchActive = active;
      dispatch('searchToggle', active);
    }
  }

  $: processedCommits = (() => {
    if (!graphSearch.trim()) return commits;
    const q = graphSearch.toLowerCase();
    return commits.filter(c =>
      c.message.toLowerCase().includes(q) ||
      c.author.toLowerCase().includes(q) ||
      c.hash.toLowerCase().includes(q) ||
      c.shortHash.toLowerCase().includes(q) ||
      c.refs.some(r => r.toLowerCase().includes(q)) ||
      (() => {
        const instance = c.refs
          .map(r => {
            if (r.startsWith('HEAD -> ')) return branchToInstance.get(r.slice(8));
            if (!r.includes('/') && r !== 'HEAD' && !r.startsWith('tag: ')) return branchToInstance.get(r);
            return undefined;
          })
          .find(Boolean);
        return !!instance?.ticket?.id?.toLowerCase().includes(q);
      })(),
    );
  })();

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

  interface LaneState { targetHash: string; color: string; branch?: string; }
  interface PathDef   { d: string; color: string; branch?: string; }
  interface RefChip   { label: string; kind: 'head' | 'head-branch' | 'local' | 'remote' | 'tag'; }

  interface GraphRow {
    commit: GitGraphCommit;
    lane: number;
    color: string;
    branch?: string;
    paths: PathDef[];
    maxLaneInRow: number;
    belowLanes: Array<{ idx: number; color: string; branch?: string }>;
  }

  function laneX(lane: number): number { return lane * COL_W + HALF; }

  /** Path from a lane entering at the top down into the commit dot of another lane. */
  function convergeCurve(ax: number, cx: number): string {
    const midY = ROW_H / 2;
    const cp = midY * 0.75;
    return `M ${ax} 0 C ${ax} ${cp * 2} ${cx} ${midY - cp * 0.5} ${cx} ${midY}`;
  }

  /** Path leaving the commit dot and peeling off into a neighbouring lane below. */
  function branchDownCurve(cx: number, ax: number): string {
    const midY = ROW_H / 2;
    const cp = midY * 0.75;
    return `M ${cx} ${midY} C ${cx} ${midY + cp * 0.5} ${ax} ${ROW_H - cp * 2} ${ax} ${ROW_H}`;
  }

  /** Assigns each commit a lane by matching the lanes waiting on its hash, and emits the paths crossing its row. */
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
      let myBranch: string | undefined;

      if (tracking.length > 0) {
        myLane  = tracking[0].i;
        myColor = tracking[0].l!.color;
        myBranch = tracking[0].l!.branch;
      } else {
        myLane = lanes.findIndex(l => l === null);
        if (myLane === -1) { myLane = lanes.length; lanes.push(null); }
        myColor = PALETTE[colorIdx++ % PALETTE.length];
      }

      const ownBranch = branchLabelForCommit(commit);
      if (ownBranch) myBranch = ownBranch;

      for (const { i } of tracking) lanes[i] = null;

      if (commit.parents.length > 0) {
        lanes[myLane] = { targetHash: commit.parents[0], color: myColor, branch: myBranch };
      }

      for (let pi = 1; pi < commit.parents.length; pi++) {
        const ph = commit.parents[pi];
        if (lanes.some(l => l?.targetHash === ph)) continue;
        let slot = lanes.findIndex(l => l === null);
        if (slot === -1) { slot = lanes.length; lanes.push(null); }
        lanes[slot] = { targetHash: ph, color: PALETTE[colorIdx++ % PALETTE.length], branch: mergedBranchLabel(commit.message) };
      }

      while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();

      const mergeParentLanes = new Set<number>();
      for (let pi = 1; pi < commit.parents.length; pi++) {
        const idx = lanes.findIndex(l => l?.targetHash === commit.parents[pi]);
        if (idx !== -1 && idx !== myLane) mergeParentLanes.add(idx);
      }

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
          if (a) paths.push({ d: `M ${cx} 0 L ${cx} ${midY}`,        color: myColor, branch: myBranch });
          if (b) paths.push({ d: `M ${cx} ${midY} L ${cx} ${ROW_H}`, color: myColor, branch: b?.branch ?? myBranch });
        } else if (mergeParentLanes.has(li)) {
          if (a?.targetHash === commit.hash) {
            paths.push({ d: convergeCurve(ax, cx), color: a.color, branch: a.branch });
          } else if (a) {
            paths.push({ d: `M ${ax} 0 L ${ax} ${midY}`, color: a.color, branch: a.branch });
          }
          if (b) paths.push({ d: branchDownCurve(cx, ax), color: b.color, branch: b.branch });
        } else if (a?.targetHash === commit.hash) {
          paths.push({ d: convergeCurve(ax, cx), color: a.color, branch: a.branch });
        } else if (!a && b) {
          paths.push({ d: branchDownCurve(cx, ax), color: b.color, branch: b.branch });
        } else if (a && b) {
          paths.push({ d: `M ${ax} 0 L ${ax} ${ROW_H}`, color: a.color, branch: a.branch });
        }
      }

      const maxLaneInRow = Math.max(myLane, maxLen - 1, 0);
      const belowLanes = below
        .map((l, idx) => l ? { idx, color: l.color, branch: l.branch } : null)
        .filter((x): x is { idx: number; color: string; branch: string | undefined } => x !== null);
      return { commit, lane: myLane, color: myColor, branch: myBranch, paths, maxLaneInRow, belowLanes };
    });
  }

  /** Recovers the merged branch name from a conventional merge commit subject. */
  function mergedBranchLabel(message: string): string | undefined {
    const pr = message.match(/^Merge pull request #\d+ from (\S+)/);
    if (pr) return pr[1];
    const named = message.match(/^Merge (?:remote-tracking )?branch '([^']+)'/);
    if (named) return named[1];
    return undefined;
  }

  /** Best branch name to colour a lane with: local refs win over remote ones. */
  function branchLabelForCommit(commit: GitGraphCommit): string | undefined {
    const chips = parseRefs(commit.refs);
    const local = chips.find(c => c.kind === 'head-branch' || c.kind === 'local');
    if (local) return local.label;
    return chips.find(c => c.kind === 'remote')?.label;
  }

  /** Classifies raw decoration strings into typed chips, sorted HEAD first then tags last. */
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

  /** True for chips that name a real branch, excluding the remote HEAD symbolic refs. */
  function isBranchChip(chip: RefChip): boolean {
    if (chip.kind !== 'remote' && chip.kind !== 'local' && chip.kind !== 'head-branch') return false;
    return !chip.label.endsWith('/HEAD');
  }

  /** Compact age label, falling back to a formatted date beyond a month. */
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

  $: rows = computeGraph(processedCommits);
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
    const byHash = new Map(processedCommits.map(c => [c.hash, c]));
    while (queue.length > 0) {
      const hash = queue.pop()!;
      if (visited.has(hash)) continue;
      visited.add(hash);
      for (const p of byHash.get(hash)?.parents ?? []) queue.push(p);
    }
    return visited;
  })();
</script>

<div class="graph-wrap">
  <div class="graph-toolbar">
    <div class="graph-search">
      <Icon name="search" size={11}/>
      <input
        class="graph-search-input"
        bind:value={graphSearch}
        placeholder={t('git.graphSearchPlaceholder') as string}
      />
      {#if graphSearch}
        <button class="graph-search-clear" on:click={() => graphSearch = ''}>×</button>
      {/if}
    </div>
    <button class="graph-refresh-btn" title={t('git.refresh') as string} on:click={() => dispatch('refresh')}>
      <Icon name="refresh" size={13}/>
    </button>
  </div>

  <div class="graph-scroll" on:scroll={handleScroll}>
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
        class:is-selected={row.commit.hash === selectedHash}
        role="button"
        tabindex="0"
        on:click={() => dispatch('selectCommit', row.commit)}
        on:keydown={(e) => e.key === 'Enter' && dispatch('selectCommit', row.commit)}
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
                class:branch-line={!!p.branch}
                role={p.branch ? 'presentation' : undefined}
                on:mousemove={p.branch ? (e) => showBranchTip(e, p.branch) : undefined}
                on:mouseleave={p.branch ? hideBranchTip : undefined}
              />
            {/each}
            {#if isCurrent}
              <circle cx={laneX(row.lane)} cy={ROW_H / 2} r={DOT_R + 3} fill="none" stroke={row.color} stroke-width="1.5" />
            {/if}
            <circle
              cx={laneX(row.lane)}
              cy={ROW_H / 2}
              r={DOT_R}
              fill={row.color}
              class:branch-line={!!row.branch}
              role={row.branch ? 'presentation' : undefined}
              on:mousemove={row.branch ? (e) => showBranchTip(e, row.branch) : undefined}
              on:mouseleave={row.branch ? hideBranchTip : undefined}
            />
          </svg>

          <div class="row-body">
            <span class="commit-text">{row.commit.message}</span>
            <span class="row-meta">
              <span class="meta-author">{row.commit.author}</span>
              <span class="meta-sep">·</span>
              <span class="meta-hash">{row.commit.shortHash}</span>
              <span class="meta-sep">·</span>
              <span class="meta-date">{relativeTime(row.commit.date)}</span>
            </span>
          </div>
        </div>

        {#if chips.length > 0}
          <div class="chips-strip" style="padding-left:{svgW + 4}px">
            {#each row.belowLanes as bl}
              <div
                class="chips-lane-line"
                class:branch-line={!!bl.branch}
                style="left:{laneX(bl.idx) - 1}px; background:{bl.color}"
                role="presentation"
                on:mousemove={bl.branch ? (e) => showBranchTip(e, bl.branch) : undefined}
                on:mouseleave={bl.branch ? hideBranchTip : undefined}
              ></div>
            {/each}
            {#each chips as chip}
              {@const linkedInstance = branchToInstance.get(chip.label)}
              {@const canCreate = !linkedInstance && isBranchChip(chip)}
              {@const activate = linkedInstance
                ? () => dispatch('switchInstance', linkedInstance)
                : canCreate
                  ? () => dispatch('createInstanceFromRef', chip.label)
                  : undefined}
              <span
                class="ref-chip chip-{chip.kind}"
                class:chip-linked={!!linkedInstance}
                class:chip-creatable={canCreate}
                role={activate ? 'button' : undefined}
                title={canCreate ? t('git.createInstanceFromBranch') as string : undefined}
                style={chip.kind === 'head-branch' || chip.kind === 'local'
                  ? `--chip-color:${row.color};`
                  : ''}
                on:click={activate}
                on:keydown={activate ? (e) => e.key === 'Enter' && activate() : undefined}
              >
                {chip.label}
                {#if linkedInstance}
                  <span class="chip-ticket">{linkedInstance.ticket.id}</span>
                {:else if canCreate}
                  <span class="chip-create-icon"><Icon name="plus" size={9}/></span>
                {/if}
              </span>
            {/each}
          </div>
        {/if}
      </div>
    {/each}

    {#if commits.length === 0}
      <div class="graph-empty">{t('git.noHistory')}</div>
    {:else if rows.length === 0}
      <div class="graph-empty">{t('git.graphNoResults')}</div>
    {:else if hasMore && !graphSearch.trim()}
      <div class="graph-loading-more">
        <Spinner size={12} trackColor="var(--bg-3)" color="var(--fg-3)"/>
      </div>
    {/if}
  </div>
</div>

{#if branchTip}
  <div class="branch-tooltip" style="left:{branchTip.x}px; top:{branchTip.y}px">
    {branchTip.label}
  </div>
{/if}

<style>
  .graph-wrap {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .branch-line { cursor: pointer; }

  .branch-tooltip {
    position: fixed;
    z-index: 1000;
    transform: translate(10px, 14px);
    pointer-events: none;
    padding: 3px 7px;
    background: var(--bg-3);
    color: var(--fg-0);
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-sm);
    font-size: 11px;
    font-weight: 500;
    line-height: 1.3;
    white-space: nowrap;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.28);
  }

  .graph-toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--stroke-0);
    flex-shrink: 0;
  }

  .graph-search {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 5px;
    background: var(--bg-0);
    border: 1px solid var(--stroke-0);
    border-radius: 4px;
    padding: 3px 7px;
    min-width: 0;
    color: var(--fg-4);
  }

  .graph-refresh-btn {
    flex-shrink: 0;
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border: 1px solid var(--stroke-0);
    border-radius: 4px;
    background: var(--bg-0);
    color: var(--fg-3);
    cursor: pointer;
    transition: color .12s, border-color .12s, background .12s;
  }
  .graph-refresh-btn:hover { color: var(--fg-0); border-color: var(--stroke-1); background: var(--bg-1); }
  .graph-search:focus-within {
    border-color: var(--accent);
    color: var(--fg-2);
  }

  .graph-search-input {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    font-size: 11px;
    color: var(--fg-0);
    font-family: var(--font-ui);
    min-width: 0;
  }
  .graph-search-input::placeholder { color: var(--fg-4); }

  .graph-search-clear {
    background: none;
    border: none;
    padding: 0 2px;
    font-size: 13px;
    line-height: 1;
    color: var(--fg-4);
    cursor: pointer;
  }
  .graph-search-clear:hover { color: var(--fg-1); }

  .graph-scroll {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .commit-outer {
    cursor: pointer;
    transition: background 50ms;
    position: relative;
  }
  .commit-outer:hover                         { background: var(--bg-3); }
  .commit-outer.is-on-branch                  { background: color-mix(in srgb, var(--accent) 3%, transparent); }
  .commit-outer.is-on-branch:hover            { background: color-mix(in srgb, var(--accent) 8%, transparent); }
  .commit-outer.is-on-branch .commit-text     { color: var(--fg-0); }
  .commit-outer.is-current                    { background: color-mix(in srgb, var(--accent) 7%, transparent); }
  .commit-outer.is-current:hover              { background: color-mix(in srgb, var(--accent) 12%, transparent); }
  .commit-outer.is-current .commit-text       { color: var(--fg-0); }
  .commit-outer.is-selected                   { background: color-mix(in srgb, var(--accent) 14%, transparent); outline: 1px solid color-mix(in srgb, var(--accent) 30%, transparent); outline-offset: -1px; }
  .commit-outer.is-selected:hover             { background: color-mix(in srgb, var(--accent) 18%, transparent); }
  .commit-outer.is-selected .commit-text      { color: var(--fg-0); }

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

  /* Chips strip - dedicated row below the commit line */
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

  .chip-creatable {
    cursor: pointer;
  }
  .chip-creatable:hover {
    filter: brightness(1.2);
  }
  .chip-create-icon {
    display: inline-flex;
    align-items: center;
    opacity: 0.55;
    margin-left: 1px;
    transition: opacity 0.12s ease;
  }
  .chip-creatable:hover .chip-create-icon,
  .chip-creatable:focus-visible .chip-create-icon {
    opacity: 0.9;
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

  .meta-author {
    font-size: 10px;
    font-family: var(--font-ui);
    color: var(--fg-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 80px;
  }

  .meta-hash {
    font-size: 10px;
    font-family: var(--font-mono);
    color: var(--fg-4);
    letter-spacing: 0.02em;
  }

  .meta-sep {
    font-size: 9px;
    color: var(--fg-2);
  }

  .meta-date {
    font-size: 10px;
    font-family: var(--font-mono);
    color: var(--fg-4);
  }

  .graph-loading-more {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 12px;
  }

  .graph-empty {
    padding: 48px 20px;
    font-size: 12px;
    font-family: var(--font-ui);
    color: var(--fg-4);
    text-align: center;
  }
</style>
