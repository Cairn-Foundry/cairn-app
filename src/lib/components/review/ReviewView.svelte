<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';
  import { tok } from '$lib/utils/syntax.js';

  const REVIEW_FILES = [
    { path: 'src/auth/totp.ts', kind: 'add', plus: 48, minus: 0 },
    { path: 'src/auth/index.ts', kind: 'mod', plus: 6, minus: 2 },
    { path: 'src/routes/auth.ts', kind: 'mod', plus: 14, minus: 1 },
    { path: 'src/db/migrations/023_totp.sql', kind: 'add', plus: 12, minus: 0 },
    { path: 'package.json', kind: 'mod', plus: 1, minus: 0 },
  ];

  const DIFF_LINES: [string, number, string, string][] = [
    ['add', 1, '+', `import { authenticator } from 'otplib';`],
    ['add', 2, '+', `import crypto from 'node:crypto';`],
    ['add', 3, '+', ``],
    ['add', 4, '+', `const SERVER_SECRET = process.env.TOTP_SERVER_SECRET!;`],
    ['add', 5, '+', ``],
    ['add', 6, '+', `export function generateSecret(userId: string): string {`],
    ['add', 7, '+', `  return crypto`],
    ['add', 8, '+', `    .createHmac('sha256', SERVER_SECRET)`],
    ['add', 9, '+', `    .update(userId)`],
    ['add', 10, '+', `    .digest('base64')`],
    ['add', 11, '+', `    .slice(0, 32);`],
    ['add', 12, '+', `}`],
    ['add', 13, '+', ``],
    ['add', 14, '+', `export function verifyTotp(user: User, token?: string): boolean {`],
    ['add', 15, '+', `  if (!token || !user.totpSecret) return false;`],
    ['add', 16, '+', `  authenticator.options = { window: 0 };`],
    ['add', 17, '+', `  return authenticator.check(token, user.totpSecret);`],
    ['add', 18, '+', `}`],
    ['add', 19, '+', ``],
    ['add', 20, '+', `export function otpauthUri(email: string, secret: string): string {`],
    ['add', 21, '+', `  return authenticator.keyuri(email, 'Acme', secret);`],
    ['add', 22, '+', `}`],
  ];

  let active = 0;

  function badgeLabel(kind: string): string {
    if (kind === 'add') return 'A';
    if (kind === 'mod') return 'M';
    return 'D';
  }
</script>

<div class="review-layout">
  <aside class="files-list">
    <div class="files-section-title">Changed files · 5</div>
    {#each REVIEW_FILES as f, i}
      <div
        class="file-item {i === active ? 'active' : ''}"
        on:click={() => active = i}
        role="button"
        tabindex="0"
        on:keydown={(e) => e.key === 'Enter' && (active = i)}
      >
        <span class="badge {f.kind}">{badgeLabel(f.kind)}</span>
        <span class="fname">{f.path}</span>
        <span class="dim mono" style="font-size: 10px;">
          <span style="color: var(--success)">+{f.plus}</span>
          {#if f.minus > 0}
            <span style="color: var(--danger)"> −{f.minus}</span>
          {/if}
        </span>
      </div>
    {/each}
    <div class="files-section-title" style="margin-top: 14px;">Agent notes</div>
    <div style="padding: 8px 16px; font-size: 11.5px; color: var(--fg-2); line-height: 1.5;">
      All changes relate to FEAT-42. No edits outside <span class="mono" style="color: var(--fg-0)">src/auth/</span>, routes, migrations, and package.json.
    </div>
  </aside>

  <div class="diff-pane">
    <div class="diff-filebar">
      <Icon name="file" size={14} style="color: var(--fg-2)"/>
      <div class="fp">
        <span class="dir">src/auth/</span><b>totp.ts</b>
      </div>
      <div class="stat">
        <span class="plus">+48</span> <span class="minus">−0</span>
      </div>
      <button class="btn ghost" style="margin-left: 8px; padding: 4px 8px;"><Icon name="external" size={12}/> Open</button>
    </div>

    <div class="ai-annotation">
      <div class="ai-icon"><Icon name="sparkles" size={16}/></div>
      <div>
        <div class="head"><span class="ai-label">AI explanation</span> · why this file exists</div>
        Brand new module. Defines <code style="font-family: var(--font-mono)">generateSecret</code>, <code style="font-family: var(--font-mono)">verifyTotp</code> and <code style="font-family: var(--font-mono)">otpauthUri</code>. Secrets are derived from the user id using an HMAC with the server-level secret — so losing the server secret invalidates every TOTP at once, which is the desired rotation property. <code style="font-family: var(--font-mono)">verifyTotp</code> uses <code style="font-family: var(--font-mono)">otplib</code> under the hood with a strict window of 0.
      </div>
    </div>

    <div class="diff-hunk">
      <div class="diff-hunk-head">@@ -0,0 +1,48 @@ <span class="ctx">new file</span></div>
      {#each DIFF_LINES as [kind, ln, marker, code]}
        <div class="diff-line {kind}">
          <span class="ln">{ln}</span>
          <span class="marker">{marker}</span>
          <span class="code">{@html tok(code)}</span>
        </div>
      {/each}
    </div>

    <div class="ai-annotation">
      <div class="ai-icon"><Icon name="alert" size={16}/></div>
      <div>
        <div class="head" style="color: var(--warning)"><span class="ai-label" style="color: var(--warning)">Heads up</span> · review recommended</div>
        Using <code style="font-family: var(--font-mono)">window: 0</code> is strict — correct clients will pass, but a user whose clock drifts by 30s will fail verification. If support tickets come in, consider <code style="font-family: var(--font-mono)">window: 1</code>.
      </div>
    </div>
  </div>
</div>
