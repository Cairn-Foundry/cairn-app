<script lang="ts">
  import { tick } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import CopyButton from '$lib/components/CopyButton.svelte';
  import { t } from '$lib/i18n';
  import CodeEditor from './CodeEditor.svelte';
  import HunkDiffPanel from './HunkDiffPanel.svelte';
  import { settings } from '$lib/stores/settings';
  import { isBinaryPath, type GitStatusMap, type BlameEntry, type FileNode } from '$lib/services/file-service';
  import type { GutterChunk } from '$lib/utils/editor/editor-diff-gutter';
  import { breadcrumbSegments, basename, parentPathOf } from '$lib/utils/files/files-tree';
  import type { Tab } from '$lib/utils/files/files-persistence';

  export let rootEl: HTMLElement | null = null;
  export let paneClass = '';
  export let paneStyle = '';
  export let tabs: Tab[];
  export let activeTabIdx: number;
  export let activeTab: Tab | null;
  export let gitStatusMap: GitStatusMap;
  export let loadingPaths: Set<string>;
  export let dragSrcIndex: number | null;
  export let insertIndex: number | null;
  export let didDrag: boolean;
  export let dragActive: boolean = false;
  export let editorRef: CodeEditor | undefined = undefined;
  export let tabsBarEl: HTMLElement | null = null;
  export let editorState: import('@codemirror/state').EditorState | null = null;
  export let activeLang: any;
  export let activeLineEndings: 'LF' | 'CRLF';
  export let activeIndentStyle: 'tabs' | 'spaces' | null;
  export let activeSpaceSize: number;
  export let isDirty: boolean;
  export let saving: boolean;
  export let cursorLine: number;
  export let cursorCol: number;
  export let currentLineBlame: BlameEntry | null;
  export let baseContent: string | null;
  export let activeChunk: GutterChunk | null;
  export let recentFiles: string[] = [];
  export let treeFilePaths: Set<string> = new Set();
  export let placeholderText = 'Select a file to edit';
  export let showRecentFiles = false;

  export let onPaneFocus: () => void;
  export let onTabPointerDown: (e: PointerEvent, idx: number) => void;
  export let onTabPointerMove: (e: PointerEvent) => void;
  export let onTabPointerUp: (e: PointerEvent) => void;
  export let onTabClick: (idx: number) => void;
  export let onTabContextMenu: (e: MouseEvent, idx: number) => void;
  export let onTabClose: (idx: number, e: MouseEvent) => void;
  export let onTabUnpin: (idx: number) => void;
  export let onBreadcrumbClick: (path: string) => void;
  export let onChange: (value: string) => void;
  export let onBlur: (() => void) | undefined = undefined;
  export let onCursorChange: (line: number, col: number) => void;
  export let onChunkClick: (chunk: GutterChunk) => void;
  export let onRevertChunk: () => void;
  export let onCloseHunk: () => void;
  export let onConvertLineEndings: () => void;
  export let onConvertIndent: () => void;
  export let onToggleWhitespace: () => void;
  export let onOpenRecent: (node: FileNode) => void;

  $: scrollActiveTabIntoView(activeTabIdx);

  function scrollActiveTabIntoView(_idx: number) {
    tick().then(() => {
      const el = tabsBarEl?.querySelector('.file-tab.tab-active');
      el?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    });
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="editor-pane {paneClass}"
  style={paneStyle}
  bind:this={rootEl}
  on:pointerdown={onPaneFocus}
>
  {#if tabs.length > 0}
    <div class="tabs-bar" role="tablist" bind:this={tabsBarEl}>
      {#each tabs as tab, i}
        {#if dragActive && dragSrcIndex !== null && insertIndex === i && !(insertIndex === dragSrcIndex || insertIndex === dragSrcIndex + 1)}
          <div class="drop-indicator"></div>
        {/if}
        {#if i > 0 && tab.pinned === false && tabs[i - 1]?.pinned === true}
          <div class="tab-pin-separator"></div>
        {/if}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="file-tab {i === activeTabIdx ? 'tab-active' : ''} {dragActive && dragSrcIndex === i ? 'tab-dragging' : ''} {gitStatusMap[tab.path] === 'deleted' ? 'tab-deleted' : ''} {tab.pinned ? 'tab-pinned' : ''}"
          role="tab"
          aria-selected={i === activeTabIdx}
          tabindex="0"
          on:pointerdown={(e) => onTabPointerDown(e, i)}
          on:pointermove={onTabPointerMove}
          on:pointerup={onTabPointerUp}
          on:click={() => { if (!didDrag) onTabClick(i); }}
          on:keydown={(e) => e.key === 'Enter' && onTabClick(i)}
          on:contextmenu={(e) => onTabContextMenu(e, i)}
        >
          {#if tab.pinned}<span class="tab-pin"><Icon name="pin" size={9}/></span>{/if}
          <span class="tab-name">{basename(tab.path)}</span>
          {#if tab.pending !== tab.content}<span class="tab-dot">●</span>{/if}
          {#if tab.pinned}
            <button type="button" class="tab-close" on:click={(e) => { e.stopPropagation(); onTabUnpin(i); }} aria-label={t('files.unpinTab') as string} title={t('files.unpinTabTitle') as string}>
              <Icon name="x" size={11}/>
            </button>
          {:else}
            <button type="button" class="tab-close" on:click={(e) => onTabClose(i, e)} aria-label={t('files.closeTab') as string}>
              <Icon name="x" size={11}/>
            </button>
          {/if}
        </div>
      {/each}
      {#if dragActive && dragSrcIndex !== null && insertIndex === tabs.length && insertIndex !== dragSrcIndex + 1}
        <div class="drop-indicator"></div>
      {/if}
    </div>
  {/if}

  {#if activeTab}
    {@const segs = breadcrumbSegments(activeTab.path)}
    <div class="editor-topbar">
      <Icon name="file" size={13}/>
      <nav class="editor-breadcrumb" aria-label={t('files.filePath') as string}>
        {#each segs as seg, i (i)}
          {#if i > 0}<span class="breadcrumb-sep">/</span>{/if}
          {#if i < segs.length - 1}
            <button type="button" class="breadcrumb-seg" on:click={() => onBreadcrumbClick(seg.path)}>{seg.name}</button>
          {:else}
            <span class="breadcrumb-seg breadcrumb-file">{seg.name}</span>
          {/if}
        {/each}
      </nav>
    </div>
    <div class="editor-body">
      {#if loadingPaths.has(activeTab.path)}
        <div class="editor-skeleton">
          <Skeleton lines={12} height={12} gap={12}/>
        </div>
      {:else if isBinaryPath(activeTab.path)}
        <div class="editor-placeholder">
          <Icon name="file" size={32}/>
          <div>{t('files.binaryFilePreview')}</div>
          <div class="editor-placeholder-path">{activeTab.path}</div>
        </div>
      {:else}
        {#key activeTab.path}
          <CodeEditor
            bind:this={editorRef}
            content={activeTab.pending}
            language={activeLang}
            readonly={false}
            minimapEnabled={$settings.showMinimap}
            fontSize={$settings.editorFontSize}
            showWhitespace={$settings.showWhitespace}
            initialCursorPos={activeTab.cursorPos}
            initialScrollTop={activeTab.scrollTop}
            savedState={editorState}
            {baseContent}
            onChunkClick={onChunkClick}
            onChange={onChange}
            onBlur={onBlur}
            onCursorChange={onCursorChange}
          />
        {/key}
      {/if}
    </div>
    {#if activeChunk}
      <HunkDiffPanel chunk={activeChunk} {activeLang} onRevert={onRevertChunk} onDismiss={onCloseHunk} />
    {/if}
    <div class="editor-statusbar">
      <span class="statusbar-item">{cursorLine}:{cursorCol}</span>
      <span class="statusbar-sep">|</span>
      <span class="statusbar-item">{activeLang.toUpperCase()}</span>
      <span class="statusbar-sep">|</span>
      <button class="statusbar-item statusbar-btn" on:click={onConvertLineEndings} title={t('files.convertLineEndings') as string}>{activeLineEndings}</button>
      <span class="statusbar-sep">|</span>
      {#if activeIndentStyle !== null}
        <button class="statusbar-item statusbar-btn" on:click={onConvertIndent} title={t('files.convertIndentStyle') as string}>{activeIndentStyle === 'tabs' ? 'Tabs' : `Spaces: ${activeSpaceSize}`}</button>
        <span class="statusbar-sep">|</span>
      {/if}
      <span class="statusbar-item">UTF-8</span>
      <span class="statusbar-sep">|</span>
      <button class="statusbar-item statusbar-btn {$settings.showWhitespace ? 'statusbar-active' : ''}" on:click={onToggleWhitespace} title={t('files.toggleWhitespace') as string}>¶</button>
      {#if isDirty}<span class="statusbar-sep">|</span><span class="statusbar-item statusbar-dirty">{t('files.unsaved')}</span>{/if}
      {#if saving}<span class="statusbar-sep">|</span><span class="statusbar-item statusbar-saving" title={t('common.saving') as string}><Spinner size={9} stroke={1.5} trackColor="var(--stroke-1)" color="var(--accent)"/></span>{/if}
      {#if currentLineBlame && activeTab}
        <span class="statusbar-blame-spacer"></span>
        {#if currentLineBlame.hash === '0000000'}
          <span class="statusbar-item statusbar-blame statusbar-blame-uncommitted">{t('files.notCommittedYet')}</span>
        {:else}
          <span class="statusbar-item statusbar-blame"><span class="selectable">{currentLineBlame.hash}</span> ({currentLineBlame.author})</span>
          <CopyButton value={currentLineBlame.hash} size={10}/>
        {/if}
      {/if}
    </div>
  {:else}
    <div class="editor-placeholder">
      <Icon name="file" size={32}/>
      <div>{placeholderText}</div>
      {#if showRecentFiles && recentFiles.filter(p => treeFilePaths.has(p)).length > 0}
        <div class="recent-files">
          <div class="recent-files-label">{t('files.recentLabel')}</div>
          {#each recentFiles.filter(p => treeFilePaths.has(p)) as path}
            <button
              type="button"
              class="recent-file-btn"
              on:click={() => onOpenRecent({ path, name: basename(path), isDir: false })}
              title={path}
            >
              <Icon name="file" size={12}/>
              <span class="recent-file-name">{basename(path)}</span>
              <span class="recent-file-dir">{parentPathOf(path)}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .editor-pane { display: flex; flex-direction: column; overflow: hidden; min-width: 0; }
  .editor-pane.pane-focused { box-shadow: inset 0 0 0 1px var(--accent-line); }

  .tabs-bar {
    display: flex;
    align-items: stretch;
    flex-shrink: 0;
    overflow-x: auto;
    border-bottom: 1px solid var(--stroke-0);
    background: var(--bg-1);
    scrollbar-width: thin;
    scrollbar-color: var(--stroke-1) transparent;
  }
  .tabs-bar::-webkit-scrollbar { height: 4px; }
  .tabs-bar::-webkit-scrollbar-track { background: transparent; }
  .tabs-bar::-webkit-scrollbar-thumb { background: var(--stroke-1); border-radius: 2px; }

  .file-tab {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 0 10px 0 12px;
    height: 34px;
    border: none;
    border-right: 1px solid var(--stroke-0);
    background: none;
    color: var(--fg-3);
    font-size: 12px;
    font-family: var(--font-ui);
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .file-tab:hover { background: var(--bg-4); color: var(--fg-1); }
  .file-tab.tab-active {
    background: var(--bg-0);
    color: var(--fg-0);
    border-bottom: 2px solid var(--accent);
  }
  .file-tab.tab-dragging { opacity: 0.4; cursor: grabbing; }
  .file-tab.tab-deleted .tab-name { text-decoration: line-through; color: var(--danger); opacity: 0.7; }
  .file-tab.tab-pinned { border-left: 2px solid var(--accent); }

  .tab-name { max-width: 140px; overflow: hidden; text-overflow: ellipsis; }

  .tab-pin {
    font-size: 9px;
    opacity: 0.6;
    flex-shrink: 0;
    line-height: 1;
  }
  .tab-dot { color: var(--accent); font-size: 10px; line-height: 1; }

  .tab-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border: none;
    background: none;
    border-radius: 3px;
    cursor: pointer;
    color: inherit;
    opacity: 0;
    padding: 0;
    flex-shrink: 0;
  }
  .file-tab:hover .tab-close,
  .file-tab.tab-active .tab-close { opacity: 0.6; }
  .tab-close:hover { background: var(--bg-4); opacity: 1 !important; }

  .drop-indicator {
    width: 2px;
    align-self: stretch;
    background: var(--accent);
    border-radius: 1px;
    margin: 4px 1px;
    pointer-events: none;
    flex-shrink: 0;
  }

  .tab-pin-separator {
    width: 1px;
    align-self: stretch;
    background: var(--border, rgba(255,255,255,0.12));
    margin: 4px 2px;
    flex-shrink: 0;
    pointer-events: none;
  }

  .editor-topbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 16px;
    height: 34px;
    border-bottom: 1px solid var(--stroke-0);
    background: var(--bg-2);
    flex-shrink: 0;
    font-size: 12px;
    overflow: hidden;
  }

  .editor-breadcrumb {
    display: flex;
    align-items: center;
    gap: 1px;
    overflow: hidden;
    flex: 1;
    font-family: var(--font-ui);
    font-size: 12px;
  }

  .breadcrumb-sep {
    color: var(--fg-4);
    padding: 0 1px;
    font-size: 11px;
    flex-shrink: 0;
  }

  .breadcrumb-seg {
    background: none;
    border: none;
    color: var(--fg-3);
    font: inherit;
    cursor: pointer;
    padding: 1px 3px;
    border-radius: 3px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 140px;
    flex-shrink: 1;
  }
  .breadcrumb-seg:hover { background: var(--bg-4); color: var(--fg-1); }

  .breadcrumb-file {
    color: var(--fg-0);
    font-weight: 600;
    padding: 1px 3px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 200px;
    flex-shrink: 0;
  }
  .editor-body { flex: 1; overflow: hidden; position: relative; }


  .editor-statusbar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 12px;
    height: 22px;
    border-top: 1px solid var(--stroke-0);
    background: var(--bg-1);
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-3);
  }

  .statusbar-item { white-space: nowrap; }
  .statusbar-sep { color: var(--fg-4); }
  .statusbar-dirty { color: var(--accent); }
  .statusbar-saving { color: var(--fg-3); font-style: italic; }

  .statusbar-btn {
    background: none;
    border: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
    padding: 0 2px;
    border-radius: 2px;
    white-space: nowrap;
  }
  .statusbar-btn:hover { background: var(--bg-4); color: var(--fg-1); }
  .statusbar-active { color: var(--accent); }

  .statusbar-blame-spacer { flex: 1; }

  .statusbar-blame {
    color: var(--fg-3);
    font-family: var(--font-mono);
    font-size: 11px;
    opacity: 0.85;
  }

  .statusbar-blame-uncommitted {
    cursor: default;
  }


  .editor-skeleton { padding: 20px 24px; }

  .editor-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 12px;
    color: var(--fg-3);
    font-size: 13px;
  }
  .editor-placeholder-path {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-4);
  }

  .recent-files {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 1px;
    margin-top: 8px;
    width: 280px;
    max-width: 100%;
  }
  .recent-files-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--fg-4);
    padding: 0 6px 4px;
  }
  .recent-file-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    border-radius: 4px;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--fg-2);
    font-size: 12px;
    text-align: left;
    min-width: 0;
  }
  .recent-file-btn:hover { background: var(--bg-2); color: var(--fg-0); }
  .recent-file-name {
    font-family: var(--font-mono);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex-shrink: 0;
    max-width: 140px;
  }
  .recent-file-dir {
    font-size: 10px;
    color: var(--fg-4);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
  }
</style>
