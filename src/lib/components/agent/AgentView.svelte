<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n';

  let draft = '';
  let scrollEl: HTMLElement;

  interface ToolCall {
    name: string;
    args: string;
    status: 'done' | 'live' | string;
    body: string;
  }

  interface Message {
    role: 'system' | 'user' | 'agent';
    content: string;
    time: string;
    streaming?: boolean;
    toolCalls?: ToolCall[];
  }

  const messages: Message[] = [
    { role: 'system', content: 'Instance started · ticket context loaded from FEAT-42', time: '09:13' },
    {
      role: 'user',
      content: 'Add TOTP as a second factor. Use otplib, store the secret encrypted, expose /auth/totp/enable and /auth/totp/verify. Follow existing auth conventions in src/auth/.',
      time: '09:13',
    },
    {
      role: 'agent',
      time: '09:14',
      content: `I'll work through this in four parts:\n1. Add the <code>otplib</code> dependency · 2. Create <code>src/auth/totp.ts</code> with <code>generateSecret</code>, <code>verifyTotp</code> · 3. Wire the verification into <code>login()</code> · 4. Add the <code>/auth/totp/enable</code> and <code>/auth/totp/verify</code> routes and tests.\n\nBefore I touch anything, let me read the existing auth code to match conventions.`,
      toolCalls: [
        { name: 'read', args: 'src/auth/index.ts', status: 'done', body: '142 lines · exports login, logout, requireSession' },
        { name: 'read', args: 'src/routes/auth.ts', status: 'done', body: '68 lines · uses router.post, wraps handlers with asyncHandler()' },
        { name: 'grep', args: '"crypto" src/', status: 'done', body: '6 matches — project uses node:crypto directly, no wrapper' },
      ],
    },
    {
      role: 'agent',
      time: '09:22',
      content: "Convention is clear. I'll stage a checkpoint before generating code so you can roll back if needed, then write the TOTP module and wire it in.",
      toolCalls: [
        { name: 'checkpoint', args: '"Before generating code"', status: 'done', body: 'state saved · ck-2' },
        { name: 'write', args: 'src/auth/totp.ts', status: 'done', body: '<span class="added">+ export function generateSecret(userId)</span>\n<span class="added">+ export function verifyTotp(user, token)</span>\n<span class="added">+ export function otpauthUri(email, secret)</span>' },
        { name: 'edit', args: 'src/auth/index.ts', status: 'done', body: '<span class="added">+ if (user.totpEnabled && !verifyTotp(user, totp)) return null;</span>' },
        { name: 'edit', args: 'src/routes/auth.ts', status: 'done', body: '<span class="added">+ router.post(\'/auth/totp/enable\', ...)</span>\n<span class="added">+ router.post(\'/auth/totp/verify\', ...)</span>' },
        { name: 'write', args: 'src/db/migrations/023_totp.sql', status: 'done', body: '<span class="added">+ ALTER TABLE users ADD COLUMN totp_secret TEXT</span>\n<span class="added">+ ALTER TABLE users ADD COLUMN totp_enabled BOOLEAN</span>' },
        { name: 'bash', args: 'npm test', status: 'done', body: '<span class="added">8 passing</span>, <span class="removed">1 failing</span>\n✗ rejects tokens from the previous window' },
      ],
    },
    {
      role: 'agent',
      time: '09:45',
      streaming: true,
      content: 'One test is failing — <code>rejects tokens from the previous window</code>. Looking at the assertion, my <code>verifyTotp</code> accepts the previous 30-second window by default. I\'ll tighten the window to <code>0</code> in the verification path and keep a <code>±1</code> margin available for clock skew as an explicit option.\n\n<span class="typing-dots"><span></span><span></span><span></span></span> editing <code>src/auth/totp.ts</code>',
      toolCalls: [
        { name: 'edit', args: 'src/auth/totp.ts', status: 'live', body: 'streaming patch…' },
      ],
    },
  ];

  function getToolIcon(name: string): string {
    if (name === 'checkpoint') return 'bookmark';
    if (name === 'bash') return 'terminal';
    if (name === 'write' || name === 'edit') return 'edit';
    return 'file';
  }

  onMount(async () => {
    await tick();
    if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
  });
</script>

<div class="agent-split">
  <div class="agent-chat">
    <div class="pane-header">
      <div class="pane-title">
        <span class="num">01</span>
        {t('agent.title')}
        <span class="sub">· {t('agent.subtitle')}</span>
      </div>
      <div class="pane-actions">
        <button class="btn ghost"><Icon name="pause" size={13}/> {t('agent.interrupt')}</button>
        <button class="btn ghost"><Icon name="refresh" size={13}/> {t('agent.restart')}</button>
        <button class="icon-btn"><Icon name="more" size={14}/></button>
      </div>
    </div>

    <div class="chat-scroll" bind:this={scrollEl}>
      {#each messages as m, i}
        {#if m.role === 'system'}
          <div style="font-size: 11px; color: var(--fg-3); font-family: var(--font-mono); text-align: center; padding: 4px 0; border-bottom: 1px dashed var(--stroke-0); margin-bottom: 6px;">
            <Icon name="flag" size={11} style="margin-right: 6px; vertical-align: -1px;"/>
            {m.content} · {m.time}
          </div>
        {:else}
          <div class="msg {m.role}">
            <div class="meta">
              <span class="role">
                {#if m.role === 'user'}
                  {t('agent.you')}
                {:else}
                  <Icon name="sparkles" size={12} style="vertical-align: -1px; margin-right: 4px;"/>Agent
                {/if}
              </span>
              <span>·</span>
              <span>{m.time}</span>
              {#if m.streaming}
                <span>·</span>
                <span style="color: var(--accent)">{t('agent.streaming')}</span>
              {/if}
            </div>
            <div class="bubble">
              <p>{@html m.content}</p>
              {#if m.toolCalls}
                {#each m.toolCalls as tc}
                  <div class="toolcall">
                    <div class="toolcall-head">
                      <Icon name={getToolIcon(tc.name)} size={12}/>
                      <span class="tname">{tc.name}</span>
                      <span class="targ">{tc.args}</span>
                      <span class="spin">
                        {#if tc.status === 'live'}
                          <span class="typing-dots"><span></span><span></span><span></span></span>
                        {:else if tc.status === 'done'}
                          <span style="color: var(--success)"><Icon name="check" size={11}/></span>
                        {:else}
                          {tc.status}
                        {/if}
                      </span>
                    </div>
                    <div class="toolcall-body">{@html tc.body}</div>
                  </div>
                {/each}
              {/if}
            </div>
          </div>
        {/if}
      {/each}
    </div>

    <div class="chat-input-wrap">
      <div class="chat-input">
        <textarea
          placeholder={t('agent.inputPlaceholder') as string}
          bind:value={draft}
        ></textarea>
        <div class="chat-input-row">
          <span class="profile-picker"><span class="dot"></span> feature</span>
          <span class="chip"><Icon name="attach" size={11}/> FEAT-42 context</span>
          <span class="chip"><Icon name="at" size={11}/> {t('agent.mentionFile')}</span>
          <div class="spacer"></div>
          <button class="btn"><Icon name="send" size={12}/> {t('agent.sendBtn')}<span class="kbd">⌘↵</span></button>
        </div>
      </div>
    </div>
  </div>

  <div class="activity">
    <div class="activity-head">
      <span class="live-dot"></span>
      {t('agent.liveActivity')}
      <span class="dim mono" style="font-size: 10px; margin-left: 4px;">{t('agent.liveActivitySub')}</span>
      <span class="pause"><Icon name="pause" size={11}/> {t('agent.autoScroll')}</span>
    </div>
    <div class="activity-list">
      <div class="act-group">Context</div>
      <div class="act-row">
        <span class="act-time">09:13</span>
        <span class="act-icon"><Icon name="flag" size={13}/></span>
        <div class="act-body"><span class="act-label">Instance started from <b>FEAT-42</b></span></div>
      </div>
      <div class="act-row">
        <span class="act-time">09:13</span>
        <span class="act-icon"><Icon name="branch" size={13}/></span>
        <div class="act-body"><span class="act-label">worktree created on <span class="act-file">feat/totp-auth</span></span></div>
      </div>
      <div class="act-row">
        <span class="act-time">09:14</span>
        <span class="act-icon"><Icon name="eye" size={13}/></span>
        <div class="act-body"><span class="act-label">Ticket context loaded into agent session</span></div>
      </div>

      <div class="act-group">Reading</div>
      <div class="act-row">
        <span class="act-time">09:16</span>
        <span class="act-icon"><Icon name="file" size={13}/></span>
        <div class="act-body"><span class="act-label">Read <span class="act-file">src/auth/index.ts</span></span></div>
      </div>
      <div class="act-row">
        <span class="act-time">09:17</span>
        <span class="act-icon"><Icon name="file" size={13}/></span>
        <div class="act-body"><span class="act-label">Read <span class="act-file">src/routes/auth.ts</span></span></div>
      </div>
      <div class="act-row">
        <span class="act-time">09:18</span>
        <span class="act-icon"><Icon name="search" size={13}/></span>
        <div class="act-body"><span class="act-label">Grep <code style="font-family: var(--font-mono); font-size: 11px;">"crypto"</code> across project — 6 matches</span></div>
      </div>

      <div class="act-group">Writing</div>
      <div class="act-row">
        <span class="act-time">09:22</span>
        <span class="act-icon ok"><Icon name="bookmark" size={13}/></span>
        <div class="act-body"><span class="act-label">Checkpoint saved — "Before generating code"</span></div>
      </div>
      <div class="act-row">
        <span class="act-time">09:24</span>
        <span class="act-icon"><Icon name="download" size={13}/></span>
        <div class="act-body"><span class="act-label">Installed <span class="act-file">otplib@12.0.1</span> <span class="act-diff">(+48kb)</span></span></div>
      </div>
      <div class="act-row">
        <span class="act-time">09:26</span>
        <span class="act-icon write"><Icon name="plus" size={13}/></span>
        <div class="act-body"><span class="act-label">Created <span class="act-file">src/auth/totp.ts</span> <span class="act-diff"><span class="plus">+48</span></span></span></div>
      </div>
      <div class="act-row">
        <span class="act-time">09:29</span>
        <span class="act-icon write"><Icon name="edit" size={13}/></span>
        <div class="act-body"><span class="act-label">Edited <span class="act-file">src/auth/index.ts</span> <span class="act-diff"><span class="plus">+6</span> <span class="minus">−2</span></span></span></div>
      </div>
      <div class="act-row">
        <span class="act-time">09:31</span>
        <span class="act-icon write"><Icon name="edit" size={13}/></span>
        <div class="act-body"><span class="act-label">Edited <span class="act-file">src/routes/auth.ts</span> <span class="act-diff"><span class="plus">+14</span> <span class="minus">−1</span></span></span></div>
      </div>
      <div class="act-row">
        <span class="act-time">09:34</span>
        <span class="act-icon write"><Icon name="plus" size={13}/></span>
        <div class="act-body"><span class="act-label">Wrote <span class="act-file">src/auth/totp.test.ts</span> <span class="act-diff"><span class="plus">+72</span> · 8 tests</span></span></div>
      </div>

      <div class="act-group">Database</div>
      <div class="act-row">
        <span class="act-time">09:37</span>
        <span class="act-icon ok"><Icon name="bookmark" size={13}/></span>
        <div class="act-body"><span class="act-label">Checkpoint saved — "Before db migration"</span></div>
      </div>
      <div class="act-row">
        <span class="act-time">09:40</span>
        <span class="act-icon write"><Icon name="plus" size={13}/></span>
        <div class="act-body"><span class="act-label">Created <span class="act-file">023_totp.sql</span> <span class="act-diff"><span class="plus">+12</span></span></span></div>
      </div>

      <div class="act-group">Testing</div>
      <div class="act-row">
        <span class="act-time">09:43</span>
        <span class="act-icon test"><Icon name="terminal" size={13}/></span>
        <div class="act-body"><span class="act-label">Ran <code style="font-family: var(--font-mono); font-size: 11px;">npm test</code> — <span style="color: var(--success)">8 pass</span>, <span style="color: var(--danger)">1 fail</span></span></div>
      </div>
      <div class="act-row">
        <span class="act-time">09:44</span>
        <span class="act-icon error"><Icon name="alert" size={13}/></span>
        <div class="act-body"><span class="act-label">Failure in <span class="act-file">totp.test.ts</span> — "rejects tokens from the previous window"</span></div>
      </div>
      <div class="act-row live">
        <span class="act-time">09:45</span>
        <span class="act-icon write"><Icon name="sparkles" size={13}/></span>
        <div class="act-body"><span class="act-label">Agent is analyzing and will patch the verification window</span></div>
      </div>
    </div>
  </div>
</div>
