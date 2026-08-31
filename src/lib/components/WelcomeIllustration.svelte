<script lang="ts">
  /**
   * Abstract mockup of the screen a welcome step talks about. Drawn in CSS so
   * it follows the theme and the accent instead of ageing like a screenshot.
   */
  export let step: string;
</script>

<div class="shot" class:hero={step === 'welcome'}>
  {#if step === 'welcome'}
    <svg class="cairn" width="104" height="104" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <ellipse class="stone third" cx="12" cy="16.5" rx="6.09" ry="2.39" />
      <ellipse class="stone second" cx="12" cy="11.4" rx="4.27" ry="2.02" />
      <ellipse class="stone first" cx="12" cy="6.75" rx="2.77" ry="1.69" />
    </svg>
  {:else if step === 'projects'}
    <div class="rows">
      {#each [0, 1, 2] as i}
        <div class="card" class:accent={i === 0}>
          <span class="dot"></span>
          <span class="bar" style="width: {70 - i * 14}%"></span>
        </div>
      {/each}
    </div>
  {:else if step === 'instances'}
    <div class="branches">
      <span class="trunk"></span>
      {#each [0, 1, 2] as i}
        <div class="branch" style="top: {14 + i * 34}px">
          <span class="curve"></span>
          <span class="node" class:accent={i === 1}></span>
          <span class="bar" style="width: {54 - i * 8}px"></span>
        </div>
      {/each}
    </div>
  {:else if step === 'steps'}
    <div class="frame">
      <div class="side">
        {#each [0, 1, 2, 3, 4, 5] as i}
          <span class="tab" class:accent={i === 2}></span>
        {/each}
      </div>
      <div class="main">
        {#each [76, 58, 88, 44, 66] as w}
          <span class="line" style="width: {w}%"></span>
        {/each}
      </div>
    </div>
  {:else if step === 'agent'}
    <div class="chat">
      <span class="bubble me"></span>
      <span class="bubble them"></span>
      <span class="bubble them short"></span>
      <span class="caret"></span>
    </div>
  {:else}
    <div class="beta">
      <span class="tag">BETA</span>
      <span class="line" style="width: 60%"></span>
      <span class="line" style="width: 40%"></span>
    </div>
  {/if}
</div>

<style>
  .shot {
    position: relative;
    width: 260px;
    height: 128px;
    margin: 0 auto 20px;
    padding: 12px;
    box-sizing: border-box;
    display: grid;
    overflow: hidden;
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-md);
    background: var(--bg-0);
  }
  /* The mark is the subject of the first slide, not a screen: no frame around it. */
  .shot.hero {
    place-items: center;
    border-color: transparent;
    background: none;
  }

  .bar, .line, .tab, .node, .dot, .bubble, .card {
    background: var(--bg-4);
    border-radius: 3px;
    display: block;
  }
  .accent { background: var(--accent); }

  .cairn { color: var(--accent); }

  /* The pile is always whole; only a soft glow travels up through the stones. */
  .stone {
    opacity: 0.55;
    animation: glow 3s ease-in-out infinite;
  }
  .third { animation-delay: 0s; }
  .second { animation-delay: 0.35s; }
  .first { animation-delay: 0.7s; }

  @keyframes glow {
    0%, 55%, 100% { opacity: 0.55; }
    20% { opacity: 1; }
  }

  .rows { display: flex; flex-direction: column; gap: 8px; justify-content: center; }
  .card {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 10px;
    border-radius: var(--r-sm);
    background: var(--bg-2);
    border: 1px solid var(--stroke-1);
  }
  .card.accent { background: var(--accent-weak); border-color: var(--accent-line); }
  .card .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); flex: none; }
  .card .bar { height: 6px; }

  .branches { position: relative; }
  .trunk {
    position: absolute;
    left: 14px;
    top: 6px;
    bottom: 6px;
    width: 2px;
    background: var(--stroke-1);
  }
  .branch { position: absolute; left: 14px; display: flex; align-items: center; gap: 8px; }
  .curve {
    width: 18px;
    height: 12px;
    border-left: 2px solid var(--stroke-1);
    border-bottom: 2px solid var(--stroke-1);
    border-bottom-left-radius: 8px;
    margin-top: -12px;
  }
  .node { width: 9px; height: 9px; border-radius: 50%; flex: none; }
  .branch .bar { height: 6px; }

  .frame { display: flex; gap: 12px; height: 100%; }
  .side { display: flex; flex-direction: column; gap: 6px; flex: none; }
  .tab { width: 26px; height: 10px; }
  .main { display: flex; flex-direction: column; gap: 7px; justify-content: center; flex: 1; }
  .line { height: 6px; background: var(--bg-4); border-radius: 3px; }

  .chat { display: flex; flex-direction: column; gap: 8px; justify-content: center; }
  .bubble { height: 14px; border-radius: 7px; }
  .bubble.me { width: 55%; align-self: flex-end; background: var(--accent); opacity: 0.85; }
  .bubble.them { width: 80%; }
  .bubble.short { width: 45%; }
  .caret {
    width: 6px;
    height: 12px;
    background: var(--accent);
    animation: blink 1.1s steps(2, start) infinite;
  }
  @keyframes blink { to { opacity: 0; } }

  .beta { display: flex; flex-direction: column; gap: 8px; justify-content: center; align-items: flex-start; }
  .tag {
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.12em;
    color: var(--accent);
    border: 1px solid var(--accent-line);
    background: var(--accent-weak);
    border-radius: var(--r-sm);
    padding: 3px 8px;
  }

  @media (prefers-reduced-motion: reduce) {
    .stone, .caret { animation: none; }
    .stone { opacity: 1; }
  }
</style>
