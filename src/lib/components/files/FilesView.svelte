<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';
  import CodeEditor from './CodeEditor.svelte';

  type LangKind = 'ts' | 'js' | 'sql' | 'json' | 'text';

  interface ProjectFile {
    path: string;
    lang: LangKind;
    content: string;
  }

  const FILES: ProjectFile[] = [
    {
      path: 'src/auth/totp.ts', lang: 'ts',
      content: `import { authenticator } from 'otplib';
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
}`,
    },
    {
      path: 'src/auth/index.ts', lang: 'ts',
      content: `import { findUser, createSession } from '../db/users';
import { verifyPassword } from './password';
import { verifyTotp } from './totp';

export async function login(
  email: string,
  password: string,
  totp?: string
): Promise<Session | null> {
  const user = await findUser(email);
  if (!user) return null;
  if (!verifyPassword(password, user)) return null;
  if (user.totpEnabled && !verifyTotp(user, totp)) return null;
  return createSession(user);
}

export async function logout(sessionId: string): Promise<void> {
  await destroySession(sessionId);
}

export function requireSession(req: Request, res: Response, next: NextFunction) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'No session' } });
  req.user = session.user;
  next();
}`,
    },
    {
      path: 'src/routes/auth.ts', lang: 'ts',
      content: `import { Router } from 'express';
import { login, logout, requireSession } from '../auth';
import { generateSecret, otpauthUri } from '../auth/totp';
import { enableTotp } from '../db/users';
import { asyncHandler } from '../utils';

const router = Router();

router.post('/auth/login', asyncHandler(async (req, res) => {
  const { email, password, totp } = req.body;
  const session = await login(email, password, totp);
  if (!session) return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' } });
  res.json({ session });
}));

router.post('/auth/totp/enable', requireSession, asyncHandler(async (req, res) => {
  const secret = generateSecret(req.user.id);
  await enableTotp(req.user.id, secret);
  res.json({ uri: otpauthUri(req.user.email, secret) });
}));

router.post('/auth/totp/verify', requireSession, asyncHandler(async (req, res) => {
  const { token } = req.body;
  const ok = verifyTotp(req.user, token);
  res.json({ ok });
}));

export default router;`,
    },
    {
      path: 'src/db/migrations/023_totp.sql', lang: 'sql',
      content: `-- Migration 023: Add TOTP columns to users table

ALTER TABLE users
  ADD COLUMN totp_secret TEXT,
  ADD COLUMN totp_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX idx_users_totp_enabled ON users (totp_enabled)
  WHERE totp_enabled = TRUE;`,
    },
    {
      path: 'package.json', lang: 'json',
      content: `{
  "name": "acme-api",
  "version": "2.4.1",
  "dependencies": {
    "express": "^4.19.2",
    "otplib": "^12.0.1",
    "pg": "^8.11.5"
  },
  "devDependencies": {
    "typescript": "~5.6.2",
    "jest": "^29.7.0"
  }
}`,
    },
  ];

  let activeFile = FILES[0];
</script>

<div class="files-layout">
  <aside class="files-tree">
    <div class="files-tree-header">
      <Icon name="folder" size={12}/>
      <span>Project files</span>
    </div>
    {#each FILES as f}
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

  <div class="files-editor-wrap">
    <div class="editor-topbar">
      <Icon name="file" size={13}/>
      <span class="editor-path">
        <span class="editor-dir">{activeFile.path.split('/').slice(0, -1).join('/')}/</span><strong>{activeFile.path.split('/').pop()}</strong>
      </span>
      <div class="spacer"></div>
      <span class="editor-lang">{activeFile.lang.toUpperCase()}</span>
    </div>
    <div class="editor-body">
      {#key activeFile.path}
        <CodeEditor content={activeFile.content} language={activeFile.lang} readonly={false}/>
      {/key}
    </div>
  </div>
</div>

<style>
  .files-layout { display: flex; height: 100%; overflow: hidden; }

  .files-tree {
    width: 220px;
    flex-shrink: 0;
    border-right: 1px solid var(--stroke-0);
    overflow-y: auto;
    padding: 8px 0;
    background: var(--bg-1);
  }

  .files-tree-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px 10px;
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

  .file-tree-name { flex-shrink: 0; }
  .file-tree-dir { font-size: 10px; color: var(--fg-4); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .files-editor-wrap { flex: 1; display: flex; flex-direction: column; overflow: hidden; }

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
  .editor-path { display: flex; align-items: baseline; }
  .editor-dir { color: var(--fg-3); }
  .editor-lang {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--fg-3);
    letter-spacing: 0.05em;
  }

  .editor-body { flex: 1; overflow: hidden; }
</style>
