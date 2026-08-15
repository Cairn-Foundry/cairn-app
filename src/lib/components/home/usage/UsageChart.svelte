<script lang="ts" context="module">
  /**
   * Bar chart of a usage series, with sparse axis labels and the current column set apart.
   */
  export interface ChartBar {
    /** What sits under the bar. Empty on the columns the axis skips. */
    label: string;
    value: number;
    title: string;
    /** Set on the column standing for now, so today reads apart from the rest. */
    current?: boolean;
  }
</script>

<script lang="ts">
  export let bars: ChartBar[] = [];
  export let format: (value: number) => string;
  export let height = 150;

  $: max = bars.reduce((m, b) => Math.max(m, b.value), 0);

  /**
   * The labels, placed over the middle of the column they name rather than
   * inside it: a column of a ninety-day range is a few pixels wide, far too
   * narrow to hold a date, and clipping one leaves a row of stray digits.
   */
  $: labels = bars
    .map((bar, index) => {
      const left = ((index + 0.5) / bars.length) * 100;
      // Centring the first and last labels would hang them outside the plot,
      // which drags the whole page sideways once the panel narrows. The edge
      // ones align to their side instead.
      const shift = left < 6 ? '0' : left > 94 ? '-100%' : '-50%';
      return { index, text: bar.label, left, shift };
    })
    .filter((label) => label.text !== '');
  $: gridlines = max > 0 ? [1, 0.5, 0] : [0];

  function pct(value: number): number {
    if (max <= 0) return 0;
    // A turn that cost almost nothing still happened: keep a sliver of bar so
    // an active day is never indistinguishable from an idle one.
    return Math.max(value > 0 ? 2 : 0, (value / max) * 100);
  }
</script>

<div class="chart" style="--chart-h: {height}px">
  <div class="scale">
    {#each gridlines as line}
      <span class="tick">{format(max * line)}</span>
    {/each}
  </div>

  <div class="plot">
    <div class="grid">
      {#each gridlines as _line}<span></span>{/each}
    </div>
    <div class="bars">
      {#each bars as bar}
        <div class="col" title={bar.title}>
          <div class="bar {bar.current ? 'current' : ''} {bar.value > 0 ? '' : 'empty'}"
               style="height: {pct(bar.value)}%"></div>
        </div>
      {/each}
    </div>
    <div class="axis">
      {#each labels as label (label.index)}
        <span class="tick-x" style="left: {label.left}%; transform: translateX({label.shift})">{label.text}</span>
      {/each}
    </div>
  </div>
</div>

<style>
  .chart {
    display: flex;
    gap: 10px;
    align-items: stretch;
  }
  .scale {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    height: var(--chart-h);
    padding-bottom: 16px;
    text-align: right;
    min-width: 42px;
  }
  .tick {
    font-size: 9.5px;
    color: var(--fg-4, var(--fg-3));
    font-family: var(--font-mono);
    line-height: 1;
  }
  .plot {
    position: relative;
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }
  .grid {
    position: absolute;
    inset: 0 0 16px 0;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    pointer-events: none;
  }
  .grid span {
    display: block;
    height: 1px;
    background: var(--stroke-0);
    opacity: 0.7;
  }
  .bars {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: var(--chart-h);
  }
  .col {
    flex: 1;
    min-width: 0;
    height: 100%;
    display: flex;
    align-items: flex-end;
  }
  .col:hover .bar { background: var(--accent); }
  .bar {
    width: 100%;
    border-radius: 2px 2px 0 0;
    background: var(--accent-line);
    min-height: 1px;
  }
  .bar.current { background: var(--accent); }
  .bar.empty { background: var(--stroke-0); height: 2px !important; }
  .axis {
    position: relative;
    height: 16px;
  }
  .tick-x {
    position: absolute;
    top: 3px;
    font-size: 9.5px;
    color: var(--fg-3);
    font-family: var(--font-mono);
    white-space: nowrap;
  }
</style>
