<script lang="ts">
  /**
   * Review step: changed-files list on the left, side by side diff of the selected file on the right.
   * Content is still static placeholder data, not the real repository diff.
   */
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n';
  import DiffEditor from './DiffEditor.svelte';
  import { basename, parentPathOf } from '$lib/utils/files/files-tree';

  const REVIEW_FILES = [
    { path: 'src/auth/totp.ts', kind: 'add', plus: 48, minus: 0 },
    { path: 'src/auth/index.ts', kind: 'mod', plus: 6, minus: 2 },
    { path: 'src/routes/auth.ts', kind: 'mod', plus: 14, minus: 1 },
    { path: 'src/db/migrations/023_totp.sql', kind: 'add', plus: 12, minus: 0 },
    { path: 'package.json', kind: 'mod', plus: 1, minus: 0 },
  ];

  type DiffLine = { type: '+' | '-' | ' '; content: string };

  const RAW_DIFF: DiffLine[] = [
    { type: '+', content: `import { authenticator } from 'otplib';` },
    { type: '+', content: `import crypto from 'node:crypto';` },
    { type: '+', content: `` },
    { type: '+', content: `const SERVER_SECRET = process.env.TOTP_SERVER_SECRET!;` },
    { type: '+', content: `` },
    { type: '+', content: `export function generateSecret(userId: string): string {` },
    { type: '+', content: `  return crypto` },
    { type: '+', content: `    .createHmac('sha256', SERVER_SECRET)` },
    { type: '+', content: `    .update(userId)` },
    { type: '+', content: `    .digest('base64')` },
    { type: '+', content: `    .slice(0, 32);` },
    { type: '+', content: `}` },
    { type: '+', content: `` },
    { type: '+', content: `export function verifyTotp(user: User, token?: string): boolean {` },
    { type: '+', content: `  if (!token || !user.totpSecret) return false;` },
    { type: '+', content: `  authenticator.options = { window: 0 };` },
    { type: '+', content: `  return authenticator.check(token, user.totpSecret);` },
    { type: '+', content: `}` },
    { type: '+', content: `` },
    { type: '+', content: `export function otpauthUri(email: string, secret: string): string {` },
    { type: '+', content: `  return authenticator.keyuri(email, 'Acme', secret);` },
    { type: '+', content: `}` },
  ];

  /** Splits a unified diff into the two documents the side by side view needs, context lines going to both. */
  function diffToSplit(lines: DiffLine[]): { old: string; new: string } {
    const oldLines = lines.filter(l => l.type === '-' || l.type === ' ').map(l => l.content);
    const newLines = lines.filter(l => l.type === '+' || l.type === ' ').map(l => l.content);
    return { old: oldLines.join('\n'), new: newLines.join('\n') };
  }

  const ACTIVE_FILES: Record<number, { old: string; new: string }> = {
    0: diffToSplit(RAW_DIFF),
  };

  let active = 0;

  $: currentDiff = ACTIVE_FILES[active] ?? { old: '', new: '' };

  function badgeLabel(kind: string): string {
    if (kind === 'add') return 'A';
    if (kind === 'mod') return 'M';
    return 'D';
  }
</script>

<div class="review-layout">
  <aside class="files-list">
    <div class="files-section-title">{(t('review.changedFiles') as (n: number) => string)(REVIEW_FILES.length)}</div>
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
    <div class="files-section-title" style="margin-top: 14px;">{t('review.agentNotes')}</div>
    <div style="padding: 8px 16px; font-size: 11.5px; color: var(--fg-2); line-height: 1.5;">
      All changes relate to FEAT-42. No edits outside <span class="mono" style="color: var(--fg-0)">src/auth/</span>, routes, migrations, and package.json.
    </div>
  </aside>

  <div class="diff-pane">
    <div class="diff-filebar">
      <Icon name="file" size={14} style="color: var(--fg-2)"/>
      <div class="fp">
        <span class="dir">{parentPathOf(REVIEW_FILES[active].path)}/</span><b>{basename(REVIEW_FILES[active].path)}</b>
      </div>
      <div class="stat">
        <span class="plus">+{REVIEW_FILES[active].plus}</span>
        {#if REVIEW_FILES[active].minus > 0}
          <span class="minus"> −{REVIEW_FILES[active].minus}</span>
        {/if}
      </div>
      <button class="btn ghost" style="margin-left: 8px; padding: 4px 8px;"><Icon name="external" size={12}/> {t('review.openFile')}</button>
    </div>

    <div class="diff-editor-wrap">
      <DiffEditor
        oldContent={currentDiff.old}
        newContent={currentDiff.new}
        language="ts"
      />
    </div>
  </div>
</div>

<style>
  .review-layout {
    display: flex;
    height: 100%;
    overflow: hidden;
  }

  .files-list {
    width: 220px;
    flex-shrink: 0;
    border-right: 1px solid var(--stroke-0);
    overflow-y: auto;
    padding-top: 8px;
  }

  .files-section-title {
    padding: 4px 16px;
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--fg-3);
  }

  .file-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 16px;
    cursor: pointer;
    font-size: 12px;
    color: var(--fg-1);
    border-radius: 4px;
    margin: 0 4px;
  }

  .file-item:hover { background: var(--bg-3); }
  .file-item.active { background: var(--bg-4); color: var(--fg-0); }

  .badge {
    font-size: 10px;
    font-weight: 700;
    width: 14px;
    height: 14px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 3px;
    flex-shrink: 0;
  }

  .badge.add { background: oklch(0.78 0.14 135 / 0.18); color: oklch(0.78 0.14 135); }
  .badge.mod { background: oklch(0.82 0.14 60 / 0.18); color: oklch(0.82 0.14 60); }
  .badge.del { background: oklch(0.70 0.18 15 / 0.18); color: oklch(0.70 0.18 15); }

  .fname {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: 11.5px;
  }

  .diff-pane {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 0;
  }

  .diff-filebar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 12px;
    height: 36px;
    flex-shrink: 0;
    border-bottom: 1px solid var(--stroke-0);
    font-size: 12.5px;
    color: var(--fg-2);
  }

  .fp { flex: 1; font-family: var(--font-mono); font-size: 12px; }
  .dir { color: var(--fg-3); }
  .stat { display: flex; gap: 4px; font-size: 11.5px; font-family: var(--font-mono); }
  .plus { color: var(--success); }
  .minus { color: var(--danger); }

  .diff-editor-wrap {
    flex: 1;
    position: relative;
    overflow: hidden;
  }
</style>
