<script lang="ts">
  /**
   * Usage dashboard: KPIs against the previous range, daily and hourly charts, breakdowns,
   * plus backfill, wipe and CSV export.
   */
  import { onMount } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import { t, type TranslationKey } from '$lib/i18n';
  import { formatCount, formatDate, formatDuration, formatTokens, formatUsd } from '$lib/utils/format';
  import { writeFile } from '$lib/services/file-service';
  import { backfillUsage, clearUsage, loadUsage, usageEntries, usageLoaded } from '$lib/stores/usage';
  import {
    USAGE_RANGES,
    dailySeries,
    filterRange,
    groupBy,
    hourlyLoad,
    previousRange,
    totals,
    trend,
    usageCsv,
    type UsageRange,
  } from '$lib/utils/home/usage-stats';
  import UsageBreakdown from './UsageBreakdown.svelte';
  import UsageChart, { type ChartBar } from './UsageChart.svelte';

  type ChartMetric = 'costUsd' | 'tokens' | 'turns';

  let range: UsageRange = USAGE_RANGES[1];
  let metric: ChartMetric = 'costUsd';
  let now = Date.now();
  let busy = false;
  let recovered: number | null = null;
  let confirmingClear = false;

  onMount(() => {
    now = Date.now();
    if (!$usageLoaded) loadUsage();
  });

  $: scoped = filterRange($usageEntries, range, now);
  $: earlier = previousRange($usageEntries, range, now);
  $: stats = totals(scoped);
  $: before = totals(earlier);
  $: series = dailySeries(scoped, range, now);
  $: hours = hourlyLoad(scoped);
  $: hasBackfilled = scoped.some((e) => e.backfilled);
  $: recent = [...scoped].reverse().slice(0, 12);

  const turnsLabel = (count: number) =>
    (t('home.usage.turnsCount') as (n: string) => string)(formatCount(count));

  const metricValue = (bucketOrCount: { costUsd: number; tokens: number; turns: number }, m: ChartMetric) =>
    m === 'costUsd' ? bucketOrCount.costUsd : m === 'tokens' ? bucketOrCount.tokens : bucketOrCount.turns;

  $: metricFormat =
    metric === 'costUsd' ? formatUsd : metric === 'tokens' ? formatTokens : formatCount;

  /**
   * How many columns apart the dates on the axis sit. Counted back from the
   * last day so the range always ends on a labelled column, instead of ending
   * on a stray one crammed against its neighbour.
   */
  $: labelStep = Math.max(1, Math.ceil(series.length / 12));

  $: dayBars = series.map((bucket, i): ChartBar => ({
    label: (series.length - 1 - i) % labelStep === 0 ? bucket.day.slice(5) : '',
    value: metricValue(bucket, metric),
    current: i === series.length - 1,
    title: `${bucket.day} - ${formatUsd(bucket.costUsd)}, ${formatTokens(bucket.tokens)} tk, ${turnsLabel(bucket.turns)}`,
  }));

  $: hourBars = hours.map((count, hour): ChartBar => ({
    label: hour % 3 === 0 ? `${hour}` : '',
    value: count,
    title: `${`${hour}`.padStart(2, '0')}:00 - ${turnsLabel(count)}`,
  }));

  interface Kpi {
    id: string;
    icon: string;
    value: string;
    hint: string;
    delta: number | null;
    /** Whether a rise is the good news. Spend going up is not. */
    riseIsGood: boolean;
  }

  $: kpis = [
    {
      id: 'cost',
      icon: 'gauge',
      value: formatUsd(stats.costUsd),
      hint: `${formatUsd(stats.costPerTurn)} ${t('home.usage.perTurn')}`,
      delta: trend(stats.costUsd, before.costUsd),
      riseIsGood: false,
    },
    {
      id: 'tokens',
      icon: 'layers',
      value: formatTokens(stats.tokens),
      hint: `${formatTokens(stats.inputTokens + stats.cacheReadTokens)} in / ${formatTokens(stats.outputTokens)} out`,
      delta: trend(stats.tokens, before.tokens),
      riseIsGood: false,
    },
    {
      id: 'turns',
      icon: 'refresh',
      value: formatCount(stats.turns),
      hint: (t('home.usage.acrossConversations') as (n: string) => string)(formatCount(stats.conversations)),
      delta: trend(stats.turns, before.turns),
      riseIsGood: true,
    },
    {
      id: 'time',
      icon: 'clock',
      value: stats.durationMs > 0 ? formatDuration(stats.durationMs) : '-',
      hint: stats.turns > 0 ? `${formatDuration(stats.durationMs / stats.turns)} ${t('home.usage.perTurn')}` : '-',
      delta: trend(stats.durationMs, before.durationMs),
      riseIsGood: true,
    },
    {
      id: 'cache',
      icon: 'database',
      value: `${Math.round(stats.cacheRatio * 100)}%`,
      hint: `${formatTokens(stats.cacheReadTokens)} ${t('home.usage.cached')}`,
      delta: trend(stats.cacheRatio, before.cacheRatio),
      riseIsGood: true,
    },
    {
      id: 'agents',
      icon: 'agent',
      value: formatCount(stats.agentTurns),
      hint: (t('home.usage.overModels') as (n: string) => string)(formatCount(stats.models)),
      delta: trend(stats.agentTurns, before.agentTurns),
      riseIsGood: true,
    },
  ] as Kpi[];

  /** Rebuilds the usage log from the transcripts on disk, for turns recorded before it existed. */
  async function recover() {
    busy = true;
    try {
      recovered = await backfillUsage();
      now = Date.now();
    } finally {
      busy = false;
    }
  }

  async function wipe() {
    confirmingClear = false;
    busy = true;
    try {
      await clearUsage();
      recovered = null;
    } finally {
      busy = false;
    }
  }

  /**
   * A blob download never reaches the disk here: the webview has no download
   * manager behind it. The file goes through the same save dialog as every
   * other export in the app.
   */
  async function exportCsv() {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({
      defaultPath: `cairn-usage-${range.id}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (!path) return;
    await writeFile(path, usageCsv(scoped));
  }
</script>

<div class="usage">
  <div class="toolbar">
    <div class="ranges">
      {#each USAGE_RANGES as r}
        <button class="seg {range.id === r.id ? 'active' : ''}" on:click={() => { range = r; now = Date.now(); }}>
          {t(`home.usage.range.${r.id}` as TranslationKey)}
        </button>
      {/each}
    </div>
    <div class="spacer"></div>
    <button class="ghost" on:click={() => exportCsv()} disabled={scoped.length === 0}>
      <Icon name="download" size={13}/> {t('home.usage.export')}
    </button>
    <button class="ghost" on:click={recover} disabled={busy}>
      {#if busy}<Spinner size={12}/>{:else}<Icon name="refresh" size={13}/>{/if}
      {t('home.usage.recover')}
    </button>
    {#if confirmingClear}
      <button class="ghost danger" on:click={wipe}>{t('home.usage.clearConfirm')}</button>
      <button class="ghost" on:click={() => confirmingClear = false}>{t('common.cancel')}</button>
    {:else}
      <button class="ghost" on:click={() => confirmingClear = true} disabled={$usageEntries.length === 0}>
        <Icon name="trash" size={13}/> {t('home.usage.clear')}
      </button>
    {/if}
  </div>

  {#if recovered !== null}
    <p class="notice">
      <Icon name="info" size={13}/>
      {(t('home.usage.recovered') as (n: string) => string)(formatCount(recovered))}
    </p>
  {/if}

  {#if !$usageLoaded}
    <div class="loading"><Skeleton lines={6} height={14} gap={12}/></div>

  {:else if $usageEntries.length === 0}
    <div class="empty-state">
      <span class="tile"><Icon name="gauge" size={18}/></span>
      <h2>{t('home.usage.empty.title')}</h2>
      <p>{t('home.usage.empty.body')}</p>
      <button class="primary" on:click={recover} disabled={busy}>
        {#if busy}<Spinner size={12}/>{/if}{t('home.usage.empty.action')}
      </button>
    </div>

  {:else}
    <div class="kpis">
      {#each kpis as kpi (kpi.id)}
        <div class="kpi">
          <div class="kpi-head">
            <span class="tile"><Icon name={kpi.icon} size={11}/></span>
            <span class="kpi-label">{t(`home.usage.kpi.${kpi.id}` as TranslationKey)}</span>
            {#if kpi.delta !== null && Math.abs(kpi.delta) >= 0.01}
              <span class="delta {(kpi.delta > 0) === kpi.riseIsGood ? 'up' : 'down'}">
                {kpi.delta > 0 ? '+' : ''}{Math.round(kpi.delta * 100)}%
              </span>
            {/if}
          </div>
          <div class="kpi-value selectable">{kpi.value}</div>
          <div class="kpi-hint">{kpi.hint}</div>
        </div>
      {/each}
    </div>

    <section class="card">
      <header>
        <span class="tile"><Icon name="ci" size={11}/></span>
        <h3>{t('home.usage.overTime')}</h3>
        <div class="metrics">
          {#each [['costUsd', 'cost'], ['tokens', 'tokens'], ['turns', 'turns']] as [id, key]}
            <button class="seg small {metric === id ? 'active' : ''}" on:click={() => metric = id as ChartMetric}>
              {t(`home.usage.kpi.${key}` as TranslationKey)}
            </button>
          {/each}
        </div>
      </header>
      <UsageChart bars={dayBars} format={metricFormat}/>
    </section>

    <div class="grid">
      <UsageBreakdown
        title={t('home.usage.byModel') as string} icon="layers" metric="cost"
        groups={groupBy(scoped, 'model')} emptyLabel={t('home.usage.noData') as string}/>
      <UsageBreakdown
        title={t('home.usage.byProvider') as string} icon="cloud" metric="cost"
        groups={groupBy(scoped, 'provider')} emptyLabel={t('home.usage.noData') as string}/>
      <UsageBreakdown
        title={t('home.usage.byProject') as string} icon="folder" metric="cost"
        groups={groupBy(scoped, 'project')} emptyLabel={t('home.usage.noData') as string}/>
      <UsageBreakdown
        title={t('home.usage.byAgent') as string} icon="agent" metric="cost"
        groups={groupBy(scoped, 'agent')} emptyLabel={t('home.usage.noAgents') as string}/>
    </div>

    <UsageBreakdown
      title={t('home.usage.byConversation') as string} icon="review" metric="cost" limit={8}
      groups={groupBy(scoped, 'conversation')} emptyLabel={t('home.usage.noData') as string}/>

    <section class="card">
      <header>
        <span class="tile"><Icon name="clock" size={11}/></span>
        <h3>{t('home.usage.byHour')}</h3>
        <span class="head-hint">{t('home.usage.byHourHint')}</span>
      </header>
      <UsageChart bars={hourBars} format={formatCount} height={130}/>
    </section>

    <section class="card">
      <header>
        <span class="tile"><Icon name="list" size={11}/></span>
        <h3>{t('home.usage.recent')}</h3>
      </header>
      <div class="scroller">
      <table>
        <thead>
          <tr>
            <th>{t('home.usage.col.when')}</th>
            <th>{t('home.usage.col.conversation')}</th>
            <th>{t('home.usage.col.model')}</th>
            <th class="num">{t('home.usage.col.tokens')}</th>
            <th class="num">{t('home.usage.col.duration')}</th>
            <th class="num">{t('home.usage.col.cost')}</th>
          </tr>
        </thead>
        <tbody>
          {#each recent as entry (entry.id)}
            <tr>
              <td class="dim">
                {formatDate(entry.ts)}
                {#if entry.backfilled}<span class="badge">{t('home.usage.approx')}</span>{/if}
              </td>
              <td class="selectable" title={entry.conversationTitle}>
                {entry.conversationTitle || '-'}
                {#if entry.agentName}<span class="badge">{entry.agentName}</span>{/if}
              </td>
              <td class="mono dim selectable">{entry.model || entry.providerId || '-'}</td>
              <td class="num mono">
                {formatTokens(entry.inputTokens + entry.cacheReadTokens)} / {formatTokens(entry.outputTokens)}
              </td>
              <td class="num mono dim">{entry.durationMs > 0 ? formatDuration(entry.durationMs) : '-'}</td>
              <td class="num mono">{entry.costUsd > 0 ? formatUsd(entry.costUsd) : '-'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
      </div>
    </section>

    <p class="foot">
      {(t('home.usage.ledgerFoot') as (n: string) => string)(formatCount($usageEntries.length))}
      {#if hasBackfilled}{t('home.usage.backfillFoot')}{/if}
    </p>
  {/if}
</div>

<style>
  .usage {
    display: flex;
    flex-direction: column;
    gap: 20px;
    max-width: 940px;
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .spacer { flex: 1; }
  .ranges {
    display: flex;
    gap: 2px;
    padding: 2px;
    background: var(--bg-3);
    border-radius: var(--r-sm);
  }
  .seg {
    padding: 4px 10px;
    background: none;
    border: none;
    border-radius: var(--r-xs);
    cursor: pointer;
    font-family: var(--font-ui);
    font-size: 11.5px;
    color: var(--fg-2);
  }
  .seg:hover { color: var(--fg-0); }
  .seg.active { background: var(--bg-0); color: var(--fg-0); }
  .seg.small { font-size: 11px; padding: 3px 8px; }
  .metrics {
    display: flex;
    gap: 2px;
    padding: 2px;
    background: var(--bg-3);
    border-radius: var(--r-sm);
  }
  .ghost {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    background: var(--bg-2);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-sm);
    cursor: pointer;
    font-family: var(--font-ui);
    font-size: 11.5px;
    color: var(--fg-2);
  }
  .ghost:hover:not(:disabled) { background: var(--bg-4); color: var(--fg-0); }
  .ghost:disabled { opacity: 0.45; cursor: default; }
  .ghost.danger { color: var(--danger); border-color: var(--danger); }
  .primary {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 7px 14px;
    background: var(--accent);
    border: none;
    border-radius: var(--r-sm);
    cursor: pointer;
    font-family: var(--font-ui);
    font-size: 12px;
    color: var(--bg-0);
  }
  .primary:disabled { opacity: 0.6; cursor: default; }

  .notice {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    padding: 9px 12px;
    background: var(--accent-weak);
    border: 1px solid var(--accent-line);
    border-radius: var(--r-sm);
    font-size: 12px;
    color: var(--fg-1);
  }
  .loading { padding: 8px 0; }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 56px 24px;
    background: var(--bg-2);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-lg);
    text-align: center;
  }
  .empty-state h2 { margin: 0; font-size: 15px; font-weight: 600; color: var(--fg-0); }
  .empty-state p { margin: 0; max-width: 420px; font-size: 12.5px; color: var(--fg-3); line-height: 1.6; }

  .kpis {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
  }
  /* Six cards, so only a divisor of six is ever used: an auto-fit grid lands
     on five columns and leaves the sixth alone on its own row. Three is as far
     as it goes - across six, a card is too narrow to hold its own label, and
     the query reads the window while the panel is much narrower than that. */
  @media (min-width: 760px) { .kpis { grid-template-columns: repeat(3, 1fr); } }
  .kpi {
    padding: 14px 16px;
    background: var(--bg-2);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-lg);
    min-width: 0;
  }
  .kpi-head {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-bottom: 10px;
  }
  .kpi-label {
    flex: 1;
    min-width: 0;
    font-size: 10.5px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--fg-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .delta {
    padding: 1px 5px;
    border-radius: var(--r-xs);
    font-size: 9.5px;
    font-family: var(--font-mono);
  }
  .delta.up { color: var(--success); background: color-mix(in srgb, var(--success) 12%, transparent); }
  .delta.down { color: var(--danger); background: color-mix(in srgb, var(--danger) 12%, transparent); }
  .kpi-value {
    font-size: 21px;
    font-family: var(--font-mono);
    color: var(--fg-0);
    line-height: 1.1;
  }
  .kpi-hint {
    margin-top: 5px;
    font-size: 10.5px;
    color: var(--fg-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tile {
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border-radius: var(--r-xs);
    background: var(--bg-3);
    color: var(--fg-2);
    flex-shrink: 0;
  }
  .empty-state .tile { width: 34px; height: 34px; border-radius: var(--r-md); }

  .card {
    padding: 16px 18px;
    background: var(--bg-2);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-lg);
    min-width: 0;
  }
  .card header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 16px;
  }
  .card h3 {
    margin: 0;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--fg-3);
    flex: 1;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(320px, 100%), 1fr));
    gap: 12px;
  }

  .scroller {
    overflow-x: auto;
  }
  table {
    width: 100%;
    min-width: 560px;
    border-collapse: collapse;
    table-layout: fixed;
  }
  th {
    padding: 0 8px 8px;
    text-align: left;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--fg-3);
    border-bottom: 1px solid var(--stroke-0);
  }
  td {
    padding: 8px;
    font-size: 11.5px;
    color: var(--fg-1);
    border-bottom: 1px solid var(--stroke-0);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  tr:last-child td { border-bottom: none; }
  .num { text-align: right; }
  .mono { font-family: var(--font-mono); }
  .dim { color: var(--fg-3); }
  .badge {
    margin-left: 6px;
    padding: 1px 5px;
    border-radius: var(--r-xs);
    font-size: 9.5px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--accent);
    background: var(--accent-weak);
    border: 1px solid var(--accent-line);
  }
  .foot {
    margin: 0;
    font-size: 11px;
    color: var(--fg-3);
    line-height: 1.6;
  }
  .head-hint {
    font-size: 11px;
    color: var(--fg-3);
  }
</style>
