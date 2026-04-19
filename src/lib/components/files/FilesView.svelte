<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';

  const MOCK_FILES = [
    { path: 'src/auth/totp.ts',           kind: 'ts',   lines: 48 },
    { path: 'src/auth/index.ts',          kind: 'ts',   lines: 142 },
    { path: 'src/routes/auth.ts',         kind: 'ts',   lines: 82 },
    { path: 'src/db/migrations/023_totp.sql', kind: 'sql', lines: 12 },
    { path: 'src/auth/totp.test.ts',      kind: 'ts',   lines: 72 },
    { path: 'package.json',               kind: 'json', lines: 34 },
  ];

  const MOCK_CONTENT = `import { authenticator } from 'otplib';
import crypto from 'node:crypto';

const SERVER_SECRET = process.env.TOTP_SERVER_SECRET!;

export function generateSecret(userId: string): string {
  return crypto
    .createHmac('sha256', SERVER_SECRET)
    .update(userId)
    .digest('base64')
    .slice(0, 32);
}

export function verifyTotp(user: User, token?: string): boolean {
  if (!token || !user.totpSecret) return false;
  authenticator.options = { window: 0 };
  return authenticator.check(token, user.totpSecret);
}

export function otpauthUri(email: string, secret: string): string {
  return authenticator.keyuri(email, 'Acme', secret);
}`;

  let activeFile = MOCK_FILES[0];
</script>

<div class="files-layout">
  <aside class="files-tree">
    <div class="files-section-title">
      <Icon name="folder" size={12}/> Project files
    </div>
    {#each MOCK_FILES as f}
      <button
        class="file-tree-item {f === activeFile ? 'active' : ''}"
        on:click={() => activeFile = f}
      >
        <Icon name="file" size={13}/>
        <span class="file-tree-name">{f.path.split('/').pop()}</span>
        <span class="file-tree-dir">{f.path.split('/').slice(0, -1).join('/')}/</span>
      </button>
    {/each}
  </aside>

  <div class="files-editor">
    <div class="editor-topbar">
      <Icon name="file" size={13} />
      <span class="editor-path">
        <span class="editor-dir">{activeFile.path.split('/').slice(0, -1).join('/')}/</span>
        <strong>{activeFile.path.split('/').pop()}</strong>
      </span>
      <div class="spacer"></div>
      <span class="editor-meta">{activeFile.lines} lines</span>
    </div>
    <div class="editor-body">
      {#each MOCK_CONTENT.split('\n') as line, i}
        <div class="editor-line">
          <span class="ln">{i + 1}</span>
          <span class="code">{@html highlightLine(line)}</span>
        </div>
      {/each}
    </div>
  </div>
</div>

<script lang="ts" module>
  function highlightLine(line: string): string {
    const esc = line
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return esc
      .replace(/(\/\/.*)/g, '<span class="tok-c">$1</span>')
      .replace(/('[^']*'|"[^"]*"|`[^`]*`)/g, '<span class="tok-s">$1</span>')
      .replace(/\b(export|import|from|const|function|return|if|async|await)\b/g, '<span class="tok-k">$1</span>')
      .replace(/\b(string|number|boolean|void|User)\b/g, '<span class="tok-t">$1</span>');
  }
</script>

<style>
  .files-layout {
    display: flex;
    height: 100%;
    overflow: hidden;
  }

  .files-tree {
    width: 220px;
    flex-shrink: 0;
    border-right: 1px solid var(--stroke-0);
    overflow-y: auto;
    padding: 8px 0;
  }

  .files-section-title {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 16px 10px;
    font-size: 10px;
    font-family: var(--font-mono);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--fg-3);
  }

  .file-tree-item {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    padding: 5px 12px;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    color: var(--fg-2);
    font-size: 12.5px;
    font-family: var(--font-ui);
  }
  .file-tree-item:hover { background: var(--bg-4); color: var(--fg-0); }
  .file-tree-item.active { background: var(--accent-weak); color: var(--fg-0); }

  .file-tree-name { flex-shrink: 0; color: inherit; }
  .file-tree-dir { font-size: 10px; color: var(--fg-4); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .files-editor {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .editor-topbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 16px;
    height: 36px;
    border-bottom: 1px solid var(--stroke-0);
    background: var(--bg-1);
    flex-shrink: 0;
    font-size: 12.5px;
  }
  .editor-path { display: flex; align-items: baseline; gap: 0; }
  .editor-dir { color: var(--fg-3); }
  .editor-meta { font-family: var(--font-mono); font-size: 11px; color: var(--fg-3); }

  .editor-body {
    flex: 1;
    overflow: auto;
    padding: 12px 0;
    background: var(--bg-0);
  }

  .editor-line {
    display: flex;
    align-items: baseline;
    gap: 0;
    min-height: 20px;
    font-family: var(--font-mono);
    font-size: 13px;
    line-height: 1.6;
  }
  .editor-line:hover { background: var(--bg-3); }

  .ln {
    width: 44px;
    flex-shrink: 0;
    text-align: right;
    padding-right: 20px;
    color: var(--fg-4);
    font-size: 11.5px;
    user-select: none;
  }

  .code { color: var(--fg-1); white-space: pre; }

  :global(.tok-k) { color: oklch(0.72 0.14 280); }
  :global(.tok-s) { color: oklch(0.74 0.14 150); }
  :global(.tok-t) { color: oklch(0.80 0.14 75); }
  :global(.tok-c) { color: var(--fg-3); font-style: italic; }
</style>
