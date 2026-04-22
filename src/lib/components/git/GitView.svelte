<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';
  import { tok } from '$lib/utils/syntax.js';

  interface Hunk {
    file: string;
    hunk: string;
    staged: boolean;
    lines: string;
  }

  let hunks: Hunk[] = [
    { file: 'src/auth/totp.ts', hunk: '@@ -0,0 +1,48 @@', staged: true,
      lines: "export function generateSecret(userId: string): string {\n  return crypto\n    .createHmac('sha256', SERVER_SECRET)\n    .update(userId)\n    .digest('base64')\n    .slice(0, 32);\n}" },
    { file: 'src/auth/index.ts', hunk: '@@ -14,7 +14,11 @@', staged: true,
      lines: "export async function login(email, password, totp?) {\n  const user = await findUser(email);\n  if (!verifyPassword(password, user)) return null;\n  if (user.totpEnabled && !verifyTotp(user, totp)) return null;\n  return createSession(user);\n}" },
    { file: 'src/routes/auth.ts', hunk: '@@ -42,0 +43,14 @@', staged: false,
      lines: "router.post('/auth/totp/enable', requireSession, async (req, res) => {\n  const secret = generateSecret(req.user.id);\n  await enableTotp(req.user.id, secret);\n  res.json({ uri: otpauthUri(req.user.email, secret) });\n});" },
    { file: 'package.json', hunk: '@@ -24,6 +24,7 @@', staged: true,
      lines: '    "express": "^4.19.2",\n+    "otplib": "^12.0.1",\n    "pg": "^8.11.5",' },
  ];

  let commitMsg = "feat(auth): add TOTP as second factor\n\nAdds otplib, new totp.ts module, /auth/totp/enable + /verify routes,\nand migration for totp_secret and totp_enabled columns.";

  function toggle(i: number) {
    hunks = hunks.map((x, j) => j === i ? { ...x, staged: !x.staged } : x);
  }

  $: staged = hunks.filter(h => h.staged);
  $: unstaged = hunks.filter(h => !h.staged);
</script>

<div class="git-layout">
  <div class="git-col">
    <div class="git-col-head">
      <Icon name="circle" size={12}/>
      Unstaged changes
      <span class="count">{unstaged.length} hunks</span>
    </div>
    <div class="hunks-list">
      {#if unstaged.length === 0}
        <div style="padding: 20px; font-size: 12px; color: var(--fg-3); text-align: center;">
          Clean — all changes are staged.
        </div>
      {/if}
      {#each unstaged as h}
        {@const idx = hunks.indexOf(h)}
        <div class="hunk-card">
          <div class="hunk-card-head">
            <Icon name="file" size={12}/>
            <span style="color: var(--fg-0)">{h.file}</span>
            <span style="color: var(--fg-3)">{h.hunk}</span>
            <button class="stage" on:click={() => toggle(idx)}>+ Stage hunk</button>
          </div>
          <pre style="margin: 0; padding: 10px 12px; font-family: var(--font-mono); font-size: 11.5px; color: var(--fg-1); line-height: 1.55; white-space: pre; overflow-x: auto;">{@html tok(h.lines)}</pre>
        </div>
      {/each}
    </div>
  </div>

  <div class="git-col">
    <div class="git-col-head">
      <Icon name="circle-dot" size={12} style="color: var(--accent)"/>
      Staged for commit
      <span class="count">{staged.length} hunks</span>
    </div>
    <div class="hunks-list">
      {#if staged.length === 0}
        <div style="padding: 20px; font-size: 12px; color: var(--fg-3); text-align: center;">
          No staged changes — stage hunks to commit.
        </div>
      {/if}
      {#each staged as h}
        {@const idx = hunks.indexOf(h)}
        <div class="hunk-card">
          <div class="hunk-card-head">
            <Icon name="file" size={12}/>
            <span style="color: var(--fg-0)">{h.file}</span>
            <span style="color: var(--fg-3)">{h.hunk}</span>
            <button class="stage" on:click={() => toggle(idx)}>− Unstage</button>
          </div>
          <pre style="margin: 0; padding: 10px 12px; font-family: var(--font-mono); font-size: 11.5px; color: var(--fg-1); line-height: 1.55; white-space: pre; overflow-x: auto;">{@html tok(h.lines)}</pre>
        </div>
      {/each}
    </div>

    <div class="commit-composer">
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
        <span style="font-size: 11px; color: var(--fg-3); font-family: var(--font-mono); letter-spacing: 0.04em; text-transform: uppercase;">Commit message</span>
        <div style="flex: 1"></div>
        <button class="ai-suggest"><Icon name="sparkles" size={11}/> Regenerate with AI</button>
      </div>
      <textarea class="commit-msg" bind:value={commitMsg}></textarea>
      <div class="commit-row">
        <span class="dim mono" style="font-size: 11px;">
          on <span style="color: var(--fg-1)">feat/totp-auth</span> · 3 ahead of origin
        </span>
        <div style="flex: 1"></div>
        <button class="btn ghost"><Icon name="save" size={13}/> Commit</button>
        <button class="btn primary"><Icon name="upload" size={13}/> Commit &amp; push</button>
      </div>
    </div>
  </div>
</div>
