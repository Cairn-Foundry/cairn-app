<script lang="ts">
  /**
   * Preview of a file the editor cannot show: image, SVG, PDF, or a hex dump of
   * its first bytes. `source` is the already loaded text for the `svg` kind.
   */
  import { convertFileSrc } from '@tauri-apps/api/core';
  import Icon from '$lib/components/Icon.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import { t } from '$lib/i18n';
  import { readFileBase64, readFilePreview } from '$lib/services/file-service';
  import {
    formatByteSize,
    formatHexDump,
    hexToBytes,
    mimeFromPath,
    type PreviewKind,
    svgDataUrl,
  } from '$lib/utils/files/files-preview';
  import { basename } from '$lib/utils/files/files-tree';

  export let path: string;
  export let kind: PreviewKind = 'binary';
  export let source: string | null = null;
  /** Bumped by the caller to force a re-read from disk without remounting - a reload with the tab left open. */
  export let reloadToken = 0;

  const MAX_INLINE_PDF_BYTES = 24 * 1024 * 1024;
  /**
   * Images always load through a data URL rather than the `asset://` protocol: WKWebView caches
   * that custom scheme by path, ignoring the cache-busting query string, so a file replaced on
   * disk under the same name keeps showing the old bytes after a close/reopen. A data URL is
   * read fresh over IPC every time and never touches that cache.
   */
  const MAX_INLINE_IMAGE_BYTES = 24 * 1024 * 1024;

  let size: number | null = null;
  let hexDump = '';
  let loading = true;
  let failed = false;
  let imageBroken = false;
  let inlineUrl: string | null = null;
  let naturalWidth = 0;
  let naturalHeight = 0;
  let actualSize = false;
  let cacheBust = 0;

  $: assetUrl = `${convertFileSrc(path)}?t=${cacheBust}`;
  $: if (kind === 'svg' && source !== null) size = new Blob([source]).size;
  $: void load(path, reloadToken);

  /**
   * Loads size plus the head bytes, inlining small PDFs; ignores results for a stale path.
   * `token` is unused but keeps this reactive to `reloadToken`, so a reload with the same
   * path re-reads the file even though the path itself did not change.
   */
  async function load(p: string, token: number) {
    void token;
    cacheBust = Date.now();
    loading = true;
    failed = false;
    imageBroken = false;
    inlineUrl = null;
    naturalWidth = 0;
    naturalHeight = 0;
    actualSize = false;
    if (kind === 'svg' && source !== null) {
      hexDump = '';
      loading = false;
      return;
    }
    try {
      const preview = await readFilePreview(p);
      if (p !== path) return;
      size = preview.size;
      hexDump = kind === 'binary' ? formatHexDump(hexToBytes(preview.headHex)) : '';
      if (kind === 'pdf' && preview.size <= MAX_INLINE_PDF_BYTES) await loadInline(p);
      if (kind === 'image' && preview.size <= MAX_INLINE_IMAGE_BYTES) await loadInline(p);
    } catch {
      if (p !== path) return;
      failed = true;
      size = null;
      hexDump = '';
    } finally {
      if (p === path) loading = false;
    }
  }

  /** Reads the file as base64 into a data URL: the normal path for images and small PDFs, and the fallback when the asset protocol fails on a large one. */
  async function loadInline(p: string): Promise<boolean> {
    try {
      const b64 = await readFileBase64(p);
      if (p !== path) return false;
      inlineUrl = `data:${mimeFromPath(p)};base64,${b64}`;
      return true;
    } catch {
      return false;
    }
  }

  /** Retries once through a data URL before declaring the image broken. */
  async function onImageError() {
    if (inlineUrl !== null || !(await loadInline(path))) imageBroken = true;
  }

  function onImageLoad(e: Event) {
    const img = e.currentTarget as HTMLImageElement;
    naturalWidth = img.naturalWidth;
    naturalHeight = img.naturalHeight;
  }

  async function openWithSystemApp() {
    const { openPath } = await import('@tauri-apps/plugin-opener');
    await openPath(path).catch(() => {});
  }
</script>

<div class="preview">
  {#if loading}
    <div class="preview-center"><Spinner size={16}/></div>
  {:else if failed}
    <div class="preview-center preview-message">
      <Icon name="alert" size={28}/>
      <div>{t('files.preview.unreadable')}</div>
      <div class="preview-path selectable">{path}</div>
    </div>
  {:else if (kind === 'image' || kind === 'svg') && !imageBroken}
    <div class="preview-canvas" class:actual={actualSize}>
      <img
        src={kind === 'svg' && source !== null ? svgDataUrl(source) : (inlineUrl ?? assetUrl)}
        alt={basename(path)}
        class="preview-image"
        on:load={onImageLoad}
        on:error={onImageError}
      />
    </div>
  {:else if kind === 'pdf' && inlineUrl !== null}
    <embed class="preview-pdf" src={inlineUrl} type="application/pdf" title={basename(path)} />
  {:else}
    <div class="preview-center preview-message">
      <Icon name="file" size={28}/>
      <div class="preview-name selectable">{basename(path)}</div>
      {#if imageBroken}<div class="preview-note">{t('files.preview.imageBroken')}</div>{/if}
      <button type="button" class="preview-open" on:click={openWithSystemApp}>
        {t('files.preview.openWithSystemApp')}
      </button>
      {#if hexDump}
        <div class="preview-note">{t('files.preview.firstBytes')}</div>
        <pre class="preview-hex selectable">{hexDump}</pre>
      {/if}
    </div>
  {/if}

  {#if !loading && !failed}
    <div class="preview-bar">
      {#if naturalWidth > 0}
        <span>{naturalWidth} x {naturalHeight}</span>
        <span class="preview-sep">|</span>
      {/if}
      {#if size !== null}<span>{formatByteSize(size)}</span>{/if}
      {#if (kind === 'image' || kind === 'svg') && !imageBroken}
        <span class="preview-sep">|</span>
        <button type="button" class="preview-zoom" on:click={() => { actualSize = !actualSize; }}>
          {actualSize ? t('files.preview.fit') : t('files.preview.actualSize')}
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .preview {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--bg-1);
  }
  .preview-center {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: var(--fg-3);
    padding: 24px;
    overflow: auto;
  }
  .preview-message {
    justify-content: flex-start;
    padding-top: 48px;
  }
  .preview-name {
    color: var(--fg-0);
    font-size: 13px;
  }
  .preview-path {
    font-size: 11px;
    word-break: break-all;
    text-align: center;
  }
  .preview-note {
    font-size: 11px;
  }
  .preview-open {
    background: var(--bg-2);
    border: 1px solid var(--stroke-1);
    border-radius: 6px;
    color: var(--fg-0);
    cursor: pointer;
    font-size: 12px;
    padding: 5px 12px;
  }
  .preview-open:hover {
    background: var(--bg-3);
  }
  .preview-hex {
    align-self: stretch;
    background: var(--bg-2);
    border: 1px solid var(--stroke-1);
    border-radius: 6px;
    color: var(--fg-1);
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1.55;
    margin: 0;
    overflow-x: auto;
    padding: 10px 12px;
  }
  .preview-canvas {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: auto;
    padding: 20px;
    background-color: var(--bg-1);
    background-image:
      linear-gradient(45deg, var(--bg-2) 25%, transparent 25%),
      linear-gradient(-45deg, var(--bg-2) 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, var(--bg-2) 75%),
      linear-gradient(-45deg, transparent 75%, var(--bg-2) 75%);
    background-size: 16px 16px;
    background-position: 0 0, 0 8px, 8px -8px, -8px 0;
  }
  .preview-image {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    image-rendering: auto;
  }
  .preview-canvas.actual {
    align-items: flex-start;
    justify-content: flex-start;
  }
  .preview-canvas.actual .preview-image {
    max-width: none;
    max-height: none;
    flex: none;
  }
  .preview-pdf {
    flex: 1;
    min-height: 0;
    width: 100%;
    border: 0;
  }
  .preview-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    border-top: 1px solid var(--stroke-1);
    color: var(--fg-3);
    font-size: 11px;
    padding: 4px 10px;
  }
  .preview-sep {
    color: var(--stroke-1);
  }
  .preview-zoom {
    background: none;
    border: 0;
    color: var(--fg-3);
    cursor: pointer;
    font-size: 11px;
    padding: 0;
  }
  .preview-zoom:hover {
    color: var(--fg-0);
  }
</style>
