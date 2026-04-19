<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';

  const PIPELINE = {
    id: '#8241', commit: '7f3a2b1', status: 'running',
    branch: 'feat/totp-auth',
    stages: [
      { name: 'install', jobs: [{ name: 'npm ci', status: 'passed', time: '23s' }] },
      { name: 'lint', jobs: [
        { name: 'biome check', status: 'passed', time: '4s' },
        { name: 'tsc --noEmit', status: 'passed', time: '12s' },
      ]},
      { name: 'test', jobs: [
        { name: 'unit', status: 'failed', time: '41s' },
        { name: 'integration', status: 'pending', time: '—' },
      ]},
      { name: 'build', jobs: [{ name: 'build-web', status: 'pending', time: '—' }] },
      { name: 'deploy', jobs: [{ name: 'deploy-staging', status: 'pending', time: '—' }] },
    ],
  };
</script>

<style>
  @keyframes pulse-dot {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }
  .pulse { animation: pulse-dot 1.4s infinite; }
</style>

<div class="ci-wrap">
  <div class="ci-header">
    <h2>Pipelines</h2>
    <span class="dim mono" style="font-size: 11px;">on feat/totp-auth · last 5</span>
    <div class="spacer"/>
    <button class="btn"><Icon name="refresh" size={13}/> Refresh</button>
    <button class="btn"><Icon name="external" size={13}/> Open in GitLab</button>
  </div>

  <div class="pipeline">
    <div class="pipeline-head">
      <span class="pipe-id">{PIPELINE.id}</span>
      <div class="pipe-title">
        feat(auth): add TOTP as second factor
        <span class="commit">· {PIPELINE.commit}</span>
      </div>
      <div class="spacer"/>
      <span class="dim mono" style="font-size: 11px;">started 2m ago</span>
      <span class="status-pill running">
        <span class="pulse" style="display: inline-block; width: 6px; height: 6px; border-radius: 3px; background: currentColor;"/>
        running
      </span>
    </div>

    <div class="stages">
      {#each PIPELINE.stages as s, i}
        <div class="stage-card">
          <div class="stage-name">{i + 1}. {s.name}</div>
          {#each s.jobs as j}
            <div class="stage-job {j.status}">
              <span class="dot"/>
              <span>{j.name}</span>
              <span class="time">{j.time}</span>
            </div>
          {/each}
        </div>
      {/each}
    </div>

    <div class="pipeline-log-link error">
      <Icon name="alert" size={14} style="color: var(--danger)"/>
      <div class="msg">
        <b style="color: var(--danger)">unit</b> failed at <span class="fname">src/auth/totp.test.ts:51</span> — "rejects tokens from the previous window"
      </div>
      <button class="fix-with-agent" style="padding: 6px 10px; font-size: 12px;">
        <Icon name="sparkles" size={12}/> Fix with agent
      </button>
    </div>
  </div>

  <div class="pipeline" style="opacity: 0.65;">
    <div class="pipeline-head">
      <span class="pipe-id">#8240</span>
      <div class="pipe-title">
        feat(auth): scaffold TOTP module
        <span class="commit">· a17f9c3</span>
      </div>
      <div class="spacer"/>
      <span class="dim mono" style="font-size: 11px;">18m ago · 2m 14s</span>
      <span class="status-pill passed"><Icon name="check" size={10}/> passed</span>
    </div>
    <div class="stages">
      {#each PIPELINE.stages as s, i}
        <div class="stage-card">
          <div class="stage-name">{i + 1}. {s.name}</div>
          <div class="stage-job passed">
            <span class="dot"/>
            <span>{s.jobs[0].name}</span>
            <span class="time">ok</span>
          </div>
        </div>
      {/each}
    </div>
  </div>
</div>
