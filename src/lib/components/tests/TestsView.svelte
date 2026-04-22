<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';

  const TESTS = [
    { group: 'auth/totp.test.ts', items: [
      { name: 'generates a 6-digit token from a secret', status: 'pass', time: '12ms' },
      { name: 'verifies tokens within the 30s window', status: 'pass', time: '8ms' },
      { name: 'rejects tokens from the previous window', status: 'fail', time: '14ms' },
      { name: 'rejects tokens with wrong secret', status: 'pass', time: '6ms' },
      { name: 'derives secret from user id deterministically', status: 'pass', time: '4ms' },
    ]},
    { group: 'routes/auth.test.ts', items: [
      { name: 'POST /auth/totp/enable requires session', status: 'pass', time: '22ms' },
      { name: 'POST /auth/totp/verify with valid token', status: 'pass', time: '31ms' },
      { name: 'POST /auth/totp/verify rate-limits', status: 'skip', time: '—' },
    ]},
    { group: 'auth/index.test.ts', items: [
      { name: 'login accepts password + totp', status: 'pass', time: '41ms' },
      { name: 'login requires totp when enabled', status: 'run', time: '—' },
    ]},
  ];

  let activeSuite = 0;
  let activeTest = 2;

  $: flat = TESTS.flatMap((g, gi) => g.items.map((t, ti) => ({ ...t, gi, ti, group: g.group })));
  $: passed = flat.filter(t => t.status === 'pass').length;
  $: failed = flat.filter(t => t.status === 'fail').length;
  $: skipped = flat.filter(t => t.status === 'skip').length;
  $: running = flat.filter(t => t.status === 'run').length;
  $: current = TESTS[activeSuite].items[activeTest];
</script>

<style>
  @keyframes spin { to { transform: rotate(360deg); } }
  .spinner {
    width: 10px; height: 10px;
    border: 1.5px solid currentColor;
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    display: inline-block;
  }
</style>

<div class="tests-layout">
  <aside class="tests-list">
    {#each TESTS as g, gi}
      <div class="test-group-head">{g.group}</div>
      {#each g.items as t, ti}
        <div
          class="test-row {t.status} {gi === activeSuite && ti === activeTest ? 'active' : ''}"
          on:click={() => { activeSuite = gi; activeTest = ti; }}
          role="button"
          tabindex="0"
          on:keydown={(e) => e.key === 'Enter' && (activeSuite = gi, activeTest = ti)}
        >
          <span class="status">
            {#if t.status === 'pass'}<Icon name="check" size={12}/>
            {:else if t.status === 'fail'}<Icon name="x" size={12}/>
            {:else if t.status === 'skip'}<Icon name="circle" size={10}/>
            {:else if t.status === 'run'}<span class="spinner"></span>
            {/if}
          </span>
          <span class="name">{t.name}</span>
          <span class="time">{t.time}</span>
        </div>
      {/each}
    {/each}
  </aside>

  <div class="test-detail">
    <div class="test-summary">
      <div class="kpi pass">
        <div class="k-num">{passed}</div>
        <div class="k-label">Passing</div>
      </div>
      <div class="kpi fail">
        <div class="k-num">{failed}</div>
        <div class="k-label">Failing</div>
      </div>
      <div class="kpi">
        <div class="k-num">{skipped}</div>
        <div class="k-label">Skipped</div>
      </div>
      <div class="kpi">
        <div class="k-num">{running}</div>
        <div class="k-label">Running</div>
      </div>
      <div class="spacer"></div>
      <button class="btn"><Icon name="refresh" size={13}/> Run all</button>
      <button class="btn primary"><Icon name="play" size={12}/> Watch mode</button>
    </div>

    <div class="test-output">
      <div class="test-name-big">
        <span class="suite">auth/totp · </span>
        {current.name}
      </div>
      <div class="test-file">src/auth/totp.test.ts:47</div>

      <div class="log-block"><span class="dim">  ●  </span><span class="red">rejects tokens from the previous window</span>

<span class="dim">    Expected: </span>false
<span class="dim">    Received: </span><span class="red">true</span>

<span class="yellow">    at </span>src/auth/totp.test.ts:51:19
<span class="dim">      49 | </span>  const previous = authenticator.generate(secret, {"{ time: Date.now() - 30_000 }"});
<span class="dim">      50 | </span>
<span class="dim">    ▸ 51 | </span>  expect(verifyTotp(user, previous)).toBe(false);
<span class="dim">      52 | </span>{"}"});</div>

      <div style="display: flex; gap: 10px; align-items: center;">
        <button class="fix-with-agent"><Icon name="sparkles" size={14}/> Fix this test with the agent</button>
        <button class="btn"><Icon name="refresh" size={13}/> Re-run test</button>
        <button class="btn ghost"><Icon name="file" size={13}/> Open source</button>
      </div>

      <div class="ai-annotation" style="margin: 20px 0 0;">
        <div class="ai-icon"><Icon name="sparkles" size={16}/></div>
        <div>
          <div class="head"><span class="ai-label">Likely cause</span></div>
          <code style="font-family: var(--font-mono)">authenticator.options</code> is set once inside <code style="font-family: var(--font-mono)">verifyTotp</code>, but <code style="font-family: var(--font-mono)">otplib</code>'s options are static across calls — the test's previous <code style="font-family: var(--font-mono)">generate</code> call leaked a window value. Switching to <code style="font-family: var(--font-mono)">authenticator.create({"{ window: 0 }"}).check(...)</code> will isolate it per call.
        </div>
      </div>
    </div>
  </div>
</div>
