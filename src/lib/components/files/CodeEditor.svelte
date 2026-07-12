<script context="module" lang="ts">
  import { Compartment as CompartmentModule } from '@codemirror/state';

  const minimapCompartment = new CompartmentModule();
  const fontSizeCompartment = new CompartmentModule();
  const shortcutKeymapCompartment = new CompartmentModule();
  const themeCompartment = new CompartmentModule();
  const highlightCompartment = new CompartmentModule();
  const whitespaceCompartment = new CompartmentModule();
</script>

<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { t } from '$lib/i18n';
  import { readText } from '@tauri-apps/plugin-clipboard-manager';
  import { EditorView, keymap } from '@codemirror/view';
  import { EditorState, EditorSelection, Prec, type Extension } from '@codemirror/state';
  import { javascript, scopeCompletionSource } from '@codemirror/lang-javascript';
  import {
    buildEditorTheme, buildHighlight, buildDiffGutterTheme,
    resolveLanguageExtension, type EditorLanguage,
  } from '$lib/utils/editor/editor-theme';
  import { lineNumbers, rectangularSelection, crosshairCursor, drawSelection, highlightWhitespace } from '@codemirror/view';
  import {
    autocompletion, completionKeymap, acceptCompletion,
    closeBrackets, closeBracketsKeymap, completeFromList,
  } from '@codemirror/autocomplete';
  import {
    syntaxHighlighting,
    bracketMatching, foldGutter, foldKeymap, indentOnInput,
    codeFolding,
  } from '@codemirror/language';
  import {
    history, historyKeymap, defaultKeymap,
    insertTab, toggleComment, toggleBlockComment,
    moveLineUp, moveLineDown, copyLineDown,
    deleteLine, selectAll,
  } from '@codemirror/commands';
  import { shortcuts, activeShortcuts, bindingToLabels } from '$lib/stores/shortcuts';
  import { settings } from '$lib/stores/settings';
  import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';
  import { lintKeymap } from '@codemirror/lint';
  import { jsSnippets, tsSnippets } from '$lib/utils/editor/editor-snippets';
  import {
    buildDiffGutter, setDiffBase, clearDiffBase, revertChunkAtLine,
    type GutterChunk,
  } from '$lib/utils/editor/editor-diff-gutter';
  import { buildFontSizeTheme, buildMinimap, buildShortcutKeymap, SHORTCUT_COMMANDS } from '$lib/utils/editor/editor-extensions';
  import { EDITOR_DEFAULTS, FOLD_MARKERS } from '$lib/utils/editor/editor-config';

  export let content: string = '';
  export let onChange: ((value: string) => void) | undefined = undefined;
  export let onBlur: (() => void) | undefined = undefined;
  export let onCursorChange: ((line: number, col: number) => void) | undefined = undefined;
  export let initialCursorPos: number = 0;
  export let initialScrollTop: number = 0;
  export let language: EditorLanguage = 'ts';
  export let readonly: boolean = true;
  export let minimapEnabled: boolean = true;
  export let fontSize: number = EDITOR_DEFAULTS.fontSize;
  export let baseContent: string | null = null;
  export let onChunkClick: ((chunk: GutterChunk) => void) | undefined = undefined;
  export let showWhitespace: boolean = false;
  export let savedState: EditorState | null = null;

  export function getState(): { cursorPos: number; scrollTop: number } {
    if (!view) return { cursorPos: 0, scrollTop: 0 };
    return { cursorPos: view.state.selection.main.head, scrollTop: view.scrollDOM.scrollTop };
  }

  export function getEditorState(): EditorState | null {
    return view?.state ?? null;
  }

  export function jumpTo(line: number, col: number) {
    if (!view) return;
    const doc = view.state.doc;
    const lineObj = doc.line(Math.max(1, Math.min(line, doc.lines)));
    const pos = Math.min(lineObj.from + Math.max(0, col - 1), lineObj.to);
    view.dispatch({
      selection: EditorSelection.cursor(pos),
      effects: EditorView.scrollIntoView(pos, { y: 'center' }),
    });
    view.focus();
  }

  export function setContent(text: string): void {
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== text) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: text }, userEvent: 'input' });
    }
  }

  export function revertChunkAt(line: number): boolean {
    if (!view) return false;
    const reverted = revertChunkAtLine(view, line);
    if (reverted) view.focus();
    return reverted;
  }

  export function runEditorCommand(id: string): boolean {
    if (!view) return false;
    const cmd = SHORTCUT_COMMANDS.find(c => c.id === id);
    if (!cmd) return false;
    const ran = cmd.run(view);
    if (ran) view.focus();
    return ran;
  }

  let container: HTMLDivElement;
  let view: EditorView;

  // -- Context menu ------------------------------------------------------------

  type ContextMenuState = { x: number; y: number; hasSelection: boolean };
  let ctxMenu: ContextMenuState | null = null;
  let ctxMenuEl: HTMLElement | null = null;

  function openContextMenu(event: MouseEvent) {
    event.preventDefault();
    if (!view) return;

    const hasSelection = !view.state.selection.main.empty;
    const { contextMenuWidth: menuW, contextMenuHeight: menuH, viewportPadding: pad } = EDITOR_DEFAULTS;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let x = event.clientX;
    let y = event.clientY;
    if (x + menuW > vw - pad) x = Math.max(pad, x - menuW);
    if (y + menuH > vh - pad) y = Math.max(pad, y - menuH);

    ctxMenu = { x, y, hasSelection };
  }

  function closeContextMenu() { ctxMenu = null; }

  function runCmd(cmd: (view: EditorView) => boolean) {
    closeContextMenu();
    if (!view) return;
    cmd(view);
    view.focus();
  }

  async function cmdCopy() {
    closeContextMenu();
    if (!view) return;
    const { from, to } = view.state.selection.main;
    await navigator.clipboard.writeText(view.state.sliceDoc(from, to));
    view.focus();
  }

  async function cmdCut() {
    closeContextMenu();
    if (!view || readonly) return;
    const { from, to } = view.state.selection.main;
    await navigator.clipboard.writeText(view.state.sliceDoc(from, to));
    view.dispatch({ changes: { from, to } });
    view.focus();
  }

  async function cmdPaste() {
    closeContextMenu();
    if (!view || readonly) return;
    const text = await readText();
    if (text == null) return;
    const { from, to } = view.state.selection.main;
    view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
    view.focus();
  }

  function handleCtxKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') closeContextMenu();
  }

  // -- Extensions -------------------------------------------------------------

  function buildLanguageExtensions(): Extension[] {
    const isJS = language === 'ts' || language === 'tsx' || language === 'js' || language === 'jsx';
    const isTS = language === 'ts' || language === 'tsx';
    const isJSX = language === 'tsx' || language === 'jsx';
    const jsLang = isJS ? javascript({ typescript: isTS, jsx: isJSX }) : null;
    const lang = jsLang ?? resolveLanguageExtension(language);
    const data = jsLang?.language.data;

    const exts: Extension[] = [lang];
    if (data) {
      exts.push(data.of({ autocomplete: completeFromList(isTS ? tsSnippets : jsSnippets) }));
      exts.push(data.of({ autocomplete: scopeCompletionSource(globalThis) }));
    }
    return exts;
  }

  function buildExtensions(): Extension[] {
    const theme = $settings.theme;

    return [
      Prec.highest(keymap.of([
        { key: 'Tab',   run: (v) => acceptCompletion(v) || insertTab(v) },
        { key: 'Enter', run: acceptCompletion },
        ...closeBracketsKeymap,
        ...completionKeymap,
        ...foldKeymap,
        ...lintKeymap,
        ...searchKeymap,
      ])),
      shortcutKeymapCompartment.of(buildShortcutKeymap($activeShortcuts)),

      ...buildLanguageExtensions(),
      lineNumbers(),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      closeBrackets(),
      bracketMatching(),
      indentOnInput(),
      rectangularSelection(),
      crosshairCursor(),
      drawSelection(),
      EditorView.clickAddsSelectionRange.of((e: MouseEvent) => e.altKey),
      whitespaceCompartment.of(showWhitespace ? highlightWhitespace() : []),
      highlightCompartment.of(syntaxHighlighting(buildHighlight(theme))),
      foldGutter({
        markerDOM: (open) => {
          const el = document.createElement('span');
          el.textContent = open ? FOLD_MARKERS.open : FOLD_MARKERS.closed;
          el.style.fontSize = '10px';
          el.style.lineHeight = '1.65';
          return el;
        },
      }),
      codeFolding(),
      search({ top: true }),
      highlightSelectionMatches({ minSelectionLength: EDITOR_DEFAULTS.selectionMatchMinLength, wholeWords: false }),
      autocompletion({ activateOnTyping: true, closeOnBlur: false, maxRenderedOptions: EDITOR_DEFAULTS.autocompleteMaxRendered }),
      buildDiffGutter({ onChunkClick: (chunk) => onChunkClick?.(chunk) }),
      buildDiffGutterTheme(),
      minimapCompartment.of(buildMinimap(minimapEnabled)),
      themeCompartment.of(buildEditorTheme(theme)),
      fontSizeCompartment.of(buildFontSizeTheme(fontSize)),
      EditorView.lineWrapping,
      EditorState.readOnly.of(readonly),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChange?.(update.state.doc.toString());
        if (update.docChanged || update.selectionSet) {
          const head = update.state.selection.main.head;
          const line = update.state.doc.lineAt(head);
          onCursorChange?.(line.number, head - line.from + 1);
        }
      }),
      EditorView.domEventHandlers({
        blur: () => { onBlur?.(); return false; },
        contextmenu: (e) => { openContextMenu(e); return true; },
      }),
    ];
  }

  onMount(() => {
    const initState = savedState ?? EditorState.create({ doc: content, extensions: buildExtensions() });
    view = new EditorView({ state: initState, parent: container });

    if (initialCursorPos > 0) {
      const pos = Math.min(initialCursorPos, view.state.doc.length);
      view.dispatch({ selection: { anchor: pos, head: pos } });
    }
    if (initialScrollTop > 0) {
      view.scrollDOM.scrollTop = initialScrollTop;
    }
  });

  // -- Reactive sync ----------------------------------------------------------

  let syncedBase: string | null | undefined = undefined;

  $: if (view) syncDocAndBase(content, baseContent);

  function syncDocAndBase(nextContent: string, nextBase: string | null) {
    const current = view.state.doc.toString();
    const docChanged = current !== nextContent;
    const baseChanged = nextBase !== syncedBase;
    if (!docChanged && !baseChanged) return;
    const applyBase = baseChanged || docChanged;
    view.dispatch({
      changes: docChanged ? { from: 0, to: current.length, insert: nextContent } : undefined,
      effects: applyBase
        ? [nextBase !== null ? setDiffBase.of(nextBase) : clearDiffBase.of(null)]
        : undefined,
    });
    syncedBase = nextBase;
  }

  $: if (view) view.dispatch({ effects: minimapCompartment.reconfigure(buildMinimap(minimapEnabled)) });

  $: if (view) view.dispatch({ effects: fontSizeCompartment.reconfigure(buildFontSizeTheme(fontSize)) });

  $: if (view) view.dispatch({ effects: shortcutKeymapCompartment.reconfigure(buildShortcutKeymap($activeShortcuts)) });

  $: if (view) {
    const theme = $settings.theme;
    view.dispatch({ effects: [
      themeCompartment.reconfigure(buildEditorTheme(theme)),
      highlightCompartment.reconfigure(syntaxHighlighting(buildHighlight(theme))),
    ]});
  }

  $: if (view) view.dispatch({ effects: whitespaceCompartment.reconfigure(showWhitespace ? highlightWhitespace() : []) });

  onDestroy(() => { view?.destroy(); });
</script>

<svelte:window
  on:keydown={(e) => { if (ctxMenu) handleCtxKeydown(e); }}
  on:mousedown={() => { if (ctxMenu) closeContextMenu(); }}
/>

<div bind:this={container} class="editor-mount"></div>

{#if ctxMenu}
  <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
  <!-- svelte-ignore a11y-no-noninteractive-tabindex -->
  <div
    bind:this={ctxMenuEl}
    class="ctx-menu"
    style="left:{ctxMenu.x}px;top:{ctxMenu.y}px"
    role="menu"
    tabindex="-1"
    on:mousedown|stopPropagation={() => {}}
  >
    <button role="menuitem" disabled={!ctxMenu.hasSelection} on:click={cmdCopy}>
      <span class="icon">⎘</span>{t('editor.contextMenu.copy')}<span class="kbd">⌘C</span>
    </button>
    <button role="menuitem" disabled={!ctxMenu.hasSelection || readonly} on:click={cmdCut}>
      <span class="icon">✂</span>{t('editor.contextMenu.cut')}<span class="kbd">⌘X</span>
    </button>
    <button role="menuitem" disabled={readonly} on:click={cmdPaste}>
      <span class="icon">⎗</span>{t('editor.contextMenu.paste')}<span class="kbd">⌘V</span>
    </button>
    <button role="menuitem" on:click={() => runCmd(selectAll)}>
      <span class="icon"></span>{t('editor.contextMenu.selectAll')}<span class="kbd">⌘A</span>
    </button>

    <div class="ctx-sep" role="separator"></div>

    <button role="menuitem" disabled={readonly} on:click={() => runCmd(toggleComment)}>
      <span class="icon"></span>{t('editor.contextMenu.toggleComment')}<span class="kbd">{bindingToLabels($shortcuts.toggleLineComment).join('')}</span>
    </button>
    <button role="menuitem" disabled={readonly} on:click={() => runCmd(toggleBlockComment)}>
      <span class="icon"></span>{t('editor.contextMenu.toggleBlockComment')}<span class="kbd">{bindingToLabels($shortcuts.toggleBlockComment).join('')}</span>
    </button>

    <div class="ctx-sep" role="separator"></div>

    <button role="menuitem" disabled={readonly} on:click={() => runCmd(moveLineUp)}>
      <span class="icon">↑</span>{t('editor.contextMenu.moveLineUp')}<span class="kbd">{bindingToLabels($shortcuts.moveLineUp).join('')}</span>
    </button>
    <button role="menuitem" disabled={readonly} on:click={() => runCmd(moveLineDown)}>
      <span class="icon">↓</span>{t('editor.contextMenu.moveLineDown')}<span class="kbd">{bindingToLabels($shortcuts.moveLineDown).join('')}</span>
    </button>
    <button role="menuitem" disabled={readonly} on:click={() => runCmd(copyLineDown)}>
      <span class="icon"></span>{t('editor.contextMenu.duplicateLine')}<span class="kbd">{bindingToLabels($shortcuts.copyLineDown).join('')}</span>
    </button>
    <button role="menuitem" disabled={readonly} on:click={() => runCmd(deleteLine)}>
      <span class="icon"></span>{t('editor.contextMenu.deleteLine')}<span class="kbd">{bindingToLabels($shortcuts.deleteLine).join('')}</span>
    </button>
  </div>
{/if}


<style>
  .editor-mount {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }
  .editor-mount :global(.cm-editor) { height: 100%; }
  .editor-mount :global(.cm-scroller) {
    overflow: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--stroke-1) transparent;
  }

  .ctx-menu {
    position: fixed;
    z-index: 9999;
    min-width: 220px;
    padding: 4px 0;
    background: var(--bg-2);
    border: 1px solid var(--stroke-1);
    border-radius: 8px;
    box-shadow: 0 8px 32px oklch(0 0 0 / 0.4), 0 2px 8px oklch(0 0 0 / 0.2);
    font-family: var(--font-ui);
    font-size: 12.5px;
    color: var(--fg-1);
    outline: none;
  }

  .ctx-menu button {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 5px 12px 5px 10px;
    background: none;
    border: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    border-radius: 4px;
    transition: background 80ms;
  }

  .ctx-menu button:hover:not(:disabled) {
    background: var(--bg-4);
    color: var(--fg-0);
  }

  .ctx-menu button:active:not(:disabled) {
    background: var(--bg-5);
  }

  .ctx-menu button:disabled {
    color: var(--fg-4);
    cursor: default;
  }

  .ctx-menu .icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    font-size: 11px;
    opacity: 0.6;
    flex-shrink: 0;
  }

  .ctx-menu .kbd {
    margin-left: auto;
    padding-left: 16px;
    font-size: 11px;
    color: var(--fg-3);
    letter-spacing: 0.02em;
    flex-shrink: 0;
  }

  .ctx-menu button:disabled .kbd {
    color: var(--fg-4);
  }

  .ctx-sep {
    height: 1px;
    margin: 4px 8px;
    background: var(--stroke-0);
  }


</style>
