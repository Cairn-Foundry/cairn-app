<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * Commit graph: lays commits out into coloured lanes drawn as SVG paths, with
   * ref chips, search and infinite scroll.
   * Instances are matched to commits by branch name to offer switching or branching off a ref.
   */
  import { createEventDispatcher, onDestroy, tick } from 'svelte';
  import type { CommitAction, GitGraphCommit } from '$lib/services/git-service';
  import type { GraphPaging } from '$lib/stores/git';
  import type { BranchRequest } from '$lib/components/git/BranchView.svelte';
  import type { Instance } from '$lib/types/instance';
  import Icon from '$lib/components/Icon.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import { t } from '$lib/i18n';
  import { formatDateTimeFull, relativeTime } from '$lib/utils/format';
  import { SEARCH_DEBOUNCE_MS } from '$lib/utils/timing';
  import { reusablePrefix } from '$lib/utils/git/graph-cache';
  import { spliceStashes, stashIndexOf } from '$lib/utils/git/graph-stashes';
  import { virtualWindow } from '$lib/utils/virtual-window';
  import { clickOutside } from '$lib/utils/click-outside';
  import CommitMenu, { commitMenuPosition } from '$lib/components/git/CommitMenu.svelte';

  export let commits: GitGraphCommit[];
  /** Stashes as graph commits; each is drawn above the commit it was taken on. */
  export let stashes: GitGraphCommit[] = [];
  /**
   * Local branch names. A decoration alone cannot tell `feat/x` the local
   * branch from a remote ref: both hold a slash. Without the list, a slash
   * reads as remote.
   */
  export let localBranches: string[] = [];
  export let currentBranch: string;
  export let instances: Instance[] = [];
  export let selectedHash = '';
  export let hasMore = false;
  export let paging: GraphPaging = 'idle';
  /** Reads a commit's message body for the hover card; without it the card shows the subject only. */
  export let fetchBody: ((hash: string) => Promise<string>) | null = null;

  const dispatch = createEventDispatcher<{ switchInstance: Instance; createInstanceFromRef: string; selectCommit: GitGraphCommit; selectStash: number; branchAction: BranchRequest; loadMore: void; searchToggle: boolean; refresh: void; commitAction: { action: CommitAction; commit: GitGraphCommit } }>();

  let menuCommit: GitGraphCommit | null = null;
  let menuX = 0;
  let menuY = 0;

  function openCommitMenu(e: MouseEvent, commit: GitGraphCommit) {
    e.preventDefault();
    hideHoverCard();
    if (stashIndexOf(commit) !== null) return;
    menuCommit = commit;
    ({ x: menuX, y: menuY } = commitMenuPosition(e));
  }

  /* Clicking a chip switches instance, so the destructive branch actions sit
     behind a right-click instead, the same gesture as the commit menu. */
  let chipMenu: { x: number; y: number; branch: string; canRename: boolean } | null = null;

  function openChipMenu(e: MouseEvent, chip: RefChip) {
    e.preventDefault();
    e.stopPropagation();
    hideHoverCard();
    menuCommit = null;
    chipMenu = {
      x: Math.min(e.clientX, window.innerWidth - 200),
      y: Math.min(e.clientY, window.innerHeight - 80),
      branch: chip.label,
      canRename: chip.kind !== 'remote',
    };
  }

  function runChipAction(action: BranchRequest['action']) {
    if (!chipMenu) return;
    dispatch('branchAction', { action, branch: chipMenu.branch });
    chipMenu = null;
  }

  function runCommitAction(action: CommitAction) {
    if (!menuCommit) return;
    dispatch('commitAction', { action, commit: menuCommit });
    menuCommit = null;
  }

  /* Rows are a fixed height, so only the ones the viewport can show go into the
     DOM and two spacers stand in for the rest - the same treatment the log
     list gets. Without it a few thousand commits mean a few thousand rails,
     each with its own SVG paths. */
  const OVERSCAN = 6;
  let scrollTop = 0;
  /* Until the ResizeObserver has measured the scroller, assume a tall viewport
     rather than none: a zero would leave only the overscan on screen. */
  let viewportH = 0;

  function measureViewport(node: HTMLElement) {
    const observer = new ResizeObserver(() => { viewportH = node.clientHeight; });
    observer.observe(node);
    viewportH = node.clientHeight;
    return { destroy: () => observer.disconnect() };
  }

  /* --- Hover card --------------------------------------------------------- */

  const HOVER_DELAY_MS = 450;
  const CARD_W = 380;
  let hoverTimer: ReturnType<typeof setTimeout> | undefined;
  let hoverCard: { commit: GitGraphCommit; left: number; top?: number; bottom?: number } | null = null;
  const bodies = new Map<string, string>();
  let hoverBody = '';

  function scheduleHoverCard(e: MouseEvent | FocusEvent, commit: GitGraphCommit) {
    clearTimeout(hoverTimer);
    const row = e.currentTarget as HTMLElement;
    const pointerX = e instanceof MouseEvent ? e.clientX : null;
    hoverTimer = setTimeout(() => showHoverCard(row, commit, pointerX), HOVER_DELAY_MS);
  }

  function showHoverCard(row: HTMLElement, commit: GitGraphCommit, pointerX: number | null) {
    if (menuCommit) return;
    const rect = row.getBoundingClientRect();
    const left = Math.max(8, Math.min((pointerX ?? rect.left + 40) + 12, window.innerWidth - CARD_W - 8));
    const below = rect.bottom + 220 < window.innerHeight;
    hoverCard = below
      ? { commit, left, top: rect.bottom + 4 }
      : { commit, left, bottom: window.innerHeight - rect.top + 4 };
    void loadHoverBody(commit.hash);
  }

  async function loadHoverBody(hash: string) {
    hoverBody = bodies.get(hash) ?? '';
    if (!fetchBody || bodies.has(hash)) return;
    try {
      const body = await fetchBody(hash);
      bodies.set(hash, body);
      if (hoverCard?.commit.hash === hash) hoverBody = body;
    } catch {
      bodies.set(hash, '');
    }
  }

  function hideHoverCard() {
    clearTimeout(hoverTimer);
    hoverCard = null;
  }

  onDestroy(() => clearTimeout(hoverTimer));

  let scroller: HTMLElement;

  /** Asks for another page once the scroll gets within 200px of the bottom. */
  function requestMoreIfNearBottom() {
    if (!scroller || paging !== 'idle' || !hasMore || appliedSearch.trim()) return;
    if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 200) dispatch('loadMore');
  }

  function handleScroll(e: Event) {
    scrollTop = (e.currentTarget as HTMLElement).scrollTop;
    hideHoverCard();
    requestMoreIfNearBottom();
  }


  $: branchToInstance = new Map(instances.map(i => [i.branch, i]));

  let graphSearch = '';
  /**
   * What the filter actually runs on. It trails the input by one debounce
   * window: filtering walks the whole loaded history, so doing it on every
   * keystroke stutters the list while the user is still typing.
   */
  let appliedSearch = '';
  let searchTimer: ReturnType<typeof setTimeout>;
  $: scheduleSearch(graphSearch);

  function scheduleSearch(typed: string) {
    clearTimeout(searchTimer);
    // Clearing the field restores the full list at once: there is nothing to
    // wait for, and the delay would read as the list being stuck.
    if (!typed.trim()) {
      appliedSearch = typed;
      return;
    }
    searchTimer = setTimeout(() => (appliedSearch = typed), SEARCH_DEBOUNCE_MS);
  }

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
    const active = appliedSearch.trim().length > 0;
    if (active !== searchActive) {
      searchActive = active;
      dispatch('searchToggle', active);
    }
  }

  /** A stash row opens that stash; every other row selects its commit. */
  function activateRow(commit: GitGraphCommit) {
    const stash = stashIndexOf(commit);
    if (stash !== null) dispatch('selectStash', stash);
    else dispatch('selectCommit', commit);
  }

  $: withStashes = spliceStashes(commits, stashes);

  $: processedCommits = (() => {
    if (!appliedSearch.trim()) return withStashes;
    const q = appliedSearch.toLowerCase();
    return withStashes.filter(c =>
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
  const MAX_RAIL_W = 180;

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

  interface LaneState { targetHash: string; color: string; branch?: string; }
  interface PathDef   { d: string; color: string; branch?: string; }
  interface RefChip   { label: string; kind: 'head' | 'head-branch' | 'local' | 'remote' | 'tag' | 'stash'; remotes?: string[]; }

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

  /**
   * Lane state carried past the last row laid out, so appending a page can
   * resume from it instead of laying out the history from the first commit
   * again. Only ever reused when the new list starts with the rows already
   * computed; any other change (a search, a refresh) starts over.
   */
  let laneCache: { rows: GraphRow[]; lanes: (LaneState | null)[]; colorIdx: number } | null = null;

  /**
   * What the cache compares a laid-out row against. The refs belong in it as
   * much as the hash: a push or a pull moves a ref onto a commit that is
   * already laid out, and a layout kept on the hashes alone would go on drawing
   * the chips - and colouring the lanes - as they were.
   */
  function rowKey(commit: GitGraphCommit): string {
    return commit.refs.length > 0 ? `${commit.hash} ${commit.refs.join(' ')}` : commit.hash;
  }

  /** Lays out the rows the cache does not already cover. */
  function graphRows(commits: GitGraphCommit[]): GraphRow[] {
    const cached = laneCache;
    const keep = cached
      ? reusablePrefix(cached.rows.map(r => rowKey(r.commit)), commits.map(rowKey))
      : 0;

    if (cached && keep > 0 && keep === commits.length) return cached.rows;

    const from = cached && keep > 0 ? cached.rows : [];
    const lanes = cached && keep > 0 ? cached.lanes.map(l => l ? { ...l } : null) : [];
    const state = { colorIdx: cached && keep > 0 ? cached.colorIdx : 0 };
    const fresh = computeGraph(commits.slice(from.length), lanes, state);
    const rows = from.length > 0 ? [...from, ...fresh] : fresh;

    laneCache = { rows, lanes: lanes.map(l => l ? { ...l } : null), colorIdx: state.colorIdx };
    return rows;
  }

  /**
   * Assigns each commit a lane by matching the lanes waiting on its hash, and
   * emits the paths crossing its row. `lanes` and `state` are carried in and
   * mutated, so a later call can continue the same layout.
   */
  function computeGraph(commits: GitGraphCommit[], lanes: (LaneState | null)[], state: { colorIdx: number }): GraphRow[] {
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
        myColor = PALETTE[state.colorIdx++ % PALETTE.length];
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
        lanes[slot] = { targetHash: ph, color: PALETTE[state.colorIdx++ % PALETTE.length], branch: mergedBranchLabel(commit.message) };
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

  let localSet = new Set<string>();
  $: localSet = new Set(localBranches);

  /** Classifies raw decoration strings into typed chips, sorted HEAD first then tags last. */
  function parseRefs(refs: string[]): RefChip[] {
    const chips: RefChip[] = [];
    for (const r of refs) {
      if (r.startsWith('HEAD -> ')) {
        chips.push({ label: r.slice(8), kind: 'head-branch' });
      } else if (r === 'HEAD') {
        chips.push({ label: 'HEAD', kind: 'head' });
      } else if (/^stash@\{\d+\}$/.test(r)) {
        chips.push({ label: r, kind: 'stash' });
      } else if (r.startsWith('tag: ')) {
        chips.push({ label: r.slice(5), kind: 'tag' });
      } else if (r.includes('/') && !localSet.has(r)) {
        chips.push({ label: r, kind: 'remote' });
      } else {
        chips.push({ label: r, kind: 'local' });
      }
    }
    const order: Record<RefChip['kind'], number> = {
      'head-branch': 0, 'head': 1, 'local': 2, 'remote': 3, 'tag': 4, 'stash': 5,
    };
    return groupRemotes(chips.sort((a, b) => order[a.kind] - order[b.kind]));
  }

  /**
   * Folds `origin/x` into the chip of the local `x` when both sit on the same
   * commit: one chip then says the branch is in sync, and the width the second
   * one took goes back to the commit message. A branch whose remote ref sits on
   * another commit keeps two chips - that gap is the whole point of showing them.
   */
  function groupRemotes(chips: RefChip[]): RefChip[] {
    const locals = new Map<string, RefChip>();
    for (const c of chips) {
      if (c.kind === 'head-branch' || c.kind === 'local') locals.set(c.label, c);
    }
    if (locals.size === 0) return chips;
    return chips.filter(c => {
      if (c.kind !== 'remote') return true;
      const slash = c.label.indexOf('/');
      const local = slash > 0 ? locals.get(c.label.slice(slash + 1)) : undefined;
      if (!local) return true;
      local.remotes = [...(local.remotes ?? []), c.label.slice(0, slash)];
      return false;
    });
  }

  /** True for chips that name a real branch, excluding the remote HEAD symbolic refs. */
  function isBranchChip(chip: RefChip): boolean {
    if (chip.kind !== 'remote' && chip.kind !== 'local' && chip.kind !== 'head-branch') return false;
    return !chip.label.endsWith('/HEAD');
  }

  $: rows = graphRows(processedCommits);

  /* A page that does not fill the panel leaves nothing to scroll, so no scroll
     event would ever ask for the next one: the list is topped up until it
     overflows. Skipped until the panel has been laid out, since a zero-height
     scroller would read as always at the bottom. */
  $: if (viewportH > 0 && paging === 'idle' && hasMore) void topUp(rows.length);

  async function topUp(_rowCount: number) {
    await tick();
    requestMoreIfNearBottom();
  }
  $: win = virtualWindow(rows.length, scrollTop, viewportH || 2000, ROW_H, OVERSCAN);
  $: visibleRows = rows.slice(win.first, win.last);
  $: globalMaxLane = rows.reduce((acc, r) => Math.max(acc, r.maxLaneInRow), 0);
  $: fullSvgW = (globalMaxLane + 1) * COL_W + HALF + 4;
  // The rails are drawn at their full width so they stay aligned from one row
  // to the next, but the column they sit in is capped: past a certain number
  // of branches they would take the whole panel and squeeze the commit message
  // out of existence. Beyond the cap the rails scroll horizontally instead.
  $: railW = Math.min(fullSvgW, MAX_RAIL_W);
  $: railsClipped = fullSvgW > railW;

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

  <div class="graph-scroll" bind:this={scroller} use:measureViewport on:scroll={handleScroll}>
    {#if win.padTop > 0}<div style="height:{win.padTop}px"></div>{/if}
    {#each visibleRows as row (row.commit.hash)}
      {@const chips = parseRefs(row.commit.refs)}
      {@const isCurrent = row.commit.refs.some(r =>
        r === currentBranch || r.endsWith(`-> ${currentBranch}`) || r === `HEAD -> ${currentBranch}`
      )}
      {@const isOnBranch = currentBranchAncestors.has(row.commit.hash)}
      {@const isStash = stashIndexOf(row.commit) !== null}
      <div
        class="commit-outer"
        class:is-current={isCurrent}
        class:is-on-branch={isOnBranch && !isCurrent}
        class:is-selected={row.commit.hash === selectedHash}
        class:is-stash={isStash}
        role="button"
        tabindex="0"
        on:click={() => activateRow(row.commit)}
        on:keydown={(e) => e.key === 'Enter' && activateRow(row.commit)}
        on:contextmenu={(e) => openCommitMenu(e, row.commit)}
        on:mouseenter={(e) => scheduleHoverCard(e, row.commit)}
        on:mouseleave={hideHoverCard}
        on:focus={(e) => scheduleHoverCard(e, row.commit)}
        on:blur={hideHoverCard}
      >
        <div class="graph-row">
          <div
            class="graph-rails"
            class:is-clipped={railsClipped}
            style="width:{railW}px"
          >
          <svg
            class="graph-svg"
            width={fullSvgW}
            height={ROW_H}
            viewBox="0 0 {fullSvgW} {ROW_H}"
            style="width:{fullSvgW}px"
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
              fill={isStash ? 'var(--bg-2)' : row.color}
              stroke={isStash ? row.color : undefined}
              stroke-width={isStash ? 1.5 : undefined}
              stroke-dasharray={isStash ? '2 1.5' : undefined}
              class:branch-line={!!row.branch}
              role={row.branch ? 'presentation' : undefined}
              on:mousemove={row.branch ? (e) => showBranchTip(e, row.branch) : undefined}
              on:mouseleave={row.branch ? hideBranchTip : undefined}
            />
          </svg>
          </div>

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
          <div class="chips-strip" style="padding-left:{railW + 4}px">
            {#each row.belowLanes.filter((bl) => laneX(bl.idx) < railW) as bl}
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
                on:contextmenu={isBranchChip(chip) ? (e) => openChipMenu(e, chip) : undefined}
              >
                {chip.label}
                {#if chip.remotes}
                  <span
                    class="chip-remotes"
                    title={chip.remotes.map(r => `${r}/${chip.label}`).join(', ')}
                  >{chip.remotes.join(' ')}</span>
                {/if}
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
    {#if win.padBottom > 0}<div style="height:{win.padBottom}px"></div>{/if}

    {#if commits.length === 0}
      <div class="graph-empty">{t('git.noHistory')}</div>
    {:else if rows.length === 0}
      <div class="graph-empty">{t('git.graphNoResults')}</div>
    {:else if paging === 'failed' && !appliedSearch.trim()}
      <div class="graph-loading-more graph-load-failed">
        <span>{t('git.graphLoadFailed')}</span>
        <button class="graph-retry-btn" on:click={() => dispatch('loadMore')}>
          <Icon name="refresh" size={11}/>
          {t('git.graphLoadRetry')}
        </button>
      </div>
    {:else if hasMore && !appliedSearch.trim()}
      <div class="graph-loading-more">
        <Spinner size={12} trackColor="var(--bg-3)" color="var(--fg-3)"/>
      </div>
    {/if}
  </div>
</div>

{#if menuCommit}
  <CommitMenu
    x={menuX}
    y={menuY}
    on:pick={(e) => runCommitAction(e.detail)}
    on:close={() => (menuCommit = null)}
  />
{/if}

{#if chipMenu}
  <div
    class="chip-menu"
    role="menu"
    aria-label={t('git.branchList.chipMenuLabel') as string}
    style="left:{chipMenu.x}px; top:{chipMenu.y}px"
    use:clickOutside={() => (chipMenu = null)}
  >
    {#if chipMenu.canRename}
      <button role="menuitem" on:click={() => runChipAction('rename')}>
        <Icon name="edit" size={12}/>
        {t('git.branchList.rename')}
      </button>
    {/if}
    <button role="menuitem" class="danger" on:click={() => runChipAction('delete')}>
      <Icon name="trash" size={12}/>
      {chipMenu.canRename ? t('git.branchList.delete') : t('git.branchList.deleteOnRemote')}
    </button>
  </div>
{/if}

<svelte:window on:keydown={chipMenu ? (e) => e.key === 'Escape' && (chipMenu = null) : undefined}/>

{#if hoverCard}
  {@const c = hoverCard.commit}
  <div
    class="commit-card"
    role="tooltip"
    style="left:{hoverCard.left}px; {hoverCard.top !== undefined ? `top:${hoverCard.top}px` : `bottom:${hoverCard.bottom}px`}"
  >
    <div class="commit-card-subject">{c.message}</div>
    {#if hoverBody}
      <div class="commit-card-body">{hoverBody}</div>
    {/if}
    <dl class="commit-card-meta">
      <dt>{t('git.commitCard.author')}</dt>
      <dd>{c.author}{#if c.authorEmail} <span class="commit-card-email">&lt;{c.authorEmail}&gt;</span>{/if}</dd>
      <dt>{t('git.commitCard.authored')}</dt>
      <dd>{formatDateTimeFull(c.date)}</dd>
      {#if c.committer && c.committer !== c.author}
        <dt>{t('git.commitCard.committer')}</dt>
        <dd>{c.committer}</dd>
      {/if}
      {#if c.committerDate && formatDateTimeFull(c.committerDate) !== formatDateTimeFull(c.date)}
        <dt>{t('git.commitCard.committed')}</dt>
        <dd>{formatDateTimeFull(c.committerDate)}</dd>
      {/if}
      <dt>{t('git.commitCard.hash')}</dt>
      <dd class="commit-card-hash">{c.hash}</dd>
    </dl>
  </div>
{/if}

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

  .commit-card {
    position: fixed;
    z-index: 1000;
    width: 380px;
    max-height: 60vh;
    overflow: hidden;
    pointer-events: none;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
    background: var(--bg-1);
    color: var(--fg-1);
    border: 1px solid var(--stroke-1);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
    font-size: 11.5px;
    font-family: var(--font-ui);
  }
  .commit-card-subject {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--fg-0);
    line-height: 1.4;
    overflow-wrap: anywhere;
  }
  .commit-card-body {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    line-height: 1.45;
    color: var(--fg-2);
    max-height: 14em;
    overflow: hidden;
  }
  .commit-card-meta {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 3px 10px;
    margin: 0;
    padding-top: 8px;
    border-top: 1px solid var(--stroke-0);
  }
  .commit-card-meta dt { color: var(--fg-4); }
  .commit-card-meta dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
  .commit-card-email { color: var(--fg-3); }
  .commit-card-hash { font-family: var(--font-mono); font-size: 10.5px; color: var(--fg-2); }

  .chip-menu {
    position: fixed;
    z-index: 1200;
    min-width: 180px;
    display: flex;
    flex-direction: column;
    padding: 4px;
    gap: 1px;
    background: var(--bg-1);
    border: 1px solid var(--stroke-0);
    border-radius: 6px;
    box-shadow: 0 8px 24px oklch(0 0 0 / 0.28);
  }
  .chip-menu button {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 5px 7px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--fg-1);
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }
  .chip-menu button:hover { background: var(--bg-2); color: var(--fg-0); }
  .chip-menu button.danger { color: var(--danger); }

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

  .graph-rails {
    flex-shrink: 0;
    overflow: hidden;
    height: 36px;
    position: relative;
  }
  /* A fade marks the rails that do not fit, so a clipped graph does not read
     as a graph that simply ends. */
  .graph-rails.is-clipped::after {
    content: '';
    position: absolute;
    inset: 0 0 0 auto;
    width: 14px;
    background: linear-gradient(to right, transparent, var(--bg-2));
    pointer-events: none;
  }

  .graph-svg {
    display: block;
    flex-shrink: 0;
  }

  .commit-text {
    min-width: 12ch;
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
    /* The lane lines are positioned against the full rail width, so the strip
       has to clip them the way the rail column does. */
    overflow: hidden;
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

  /* Remote counterparts of a branch, folded into its own chip */
  .chip-remotes {
    font-size: 9px;
    opacity: 0.7;
    font-weight: 400;
    letter-spacing: 0.02em;
    padding-left: 4px;
    margin-left: 1px;
    border-left: 1px solid color-mix(in srgb, currentColor 35%, transparent);
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

  /* Stashes: dashed, like the hollow dot of their row */
  .chip-stash {
    color: var(--fg-3);
    outline: 1px dashed var(--stroke-1);
    outline-offset: -1px;
  }
  .commit-outer.is-stash .commit-text { font-style: italic; color: var(--fg-3); }

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

  .graph-load-failed {
    gap: 8px;
    font-size: 11px;
    font-family: var(--font-ui);
    color: var(--fg-3);
  }
  .graph-retry-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    border: 1px solid var(--stroke-0);
    border-radius: 4px;
    background: var(--bg-0);
    color: var(--fg-2);
    font-size: 11px;
    cursor: pointer;
  }
  .graph-retry-btn:hover { color: var(--fg-0); border-color: var(--stroke-1); background: var(--bg-1); }

  .graph-empty {
    padding: 48px 20px;
    font-size: 12px;
    font-family: var(--font-ui);
    color: var(--fg-4);
    text-align: center;
  }
</style>
