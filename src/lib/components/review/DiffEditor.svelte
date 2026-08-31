<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * Read-only side by side diff of one file, filling its positioned parent.
   * Both panes scroll together.
   */
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import { unselectableGutters } from '$lib/utils/editor/editor-extensions';
  import { MergeView } from '@codemirror/merge';
  import { EditorState, Compartment, RangeSet, StateEffect, StateField, type Extension } from '@codemirror/state';
  import { Decoration, type DecorationSet, EditorView, GutterMarker, gutter, gutterLineClass, lineNumbers } from '@codemirror/view';
  import { syntaxHighlighting, bracketMatching } from '@codemirror/language';
  import { settings, activeSyntaxTokens } from '$lib/stores/settings';
  import type { DiffMarker } from '$lib/utils/review/diff-markers';
  import {
    buildEditorTheme,
    buildHighlight,
    resolveLanguageExtension,
    type EditorLanguage,
  } from '$lib/utils/editor/editor-theme';

  export let oldContent: string = '';
  export let newContent: string = '';
  export let language: EditorLanguage = 'ts';
  /** Discussion anchors shown as gutter markers, one per line and side. */
  export let markers: DiffMarker[] = [];

  const dispatch = createEventDispatcher<{
    markerClick: { line: number; side: 'old' | 'new' };
    /** Lines picked in the line-number gutter: a click, or shift+click to extend. */
    lineSelect: { side: 'old' | 'new'; from: number; to: number };
  }>();

  const setSelectedLines = StateEffect.define<{ from: number; to: number } | null>();
  const selectedLine = Decoration.line({ class: 'cm-comment-line' });
  const selectedLinesField = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(value, tr) {
      for (const effect of tr.effects) {
        if (!effect.is(setSelectedLines)) continue;
        if (!effect.value) return Decoration.none;
        const ranges = [];
        for (let n = effect.value.from; n <= Math.min(effect.value.to, tr.state.doc.lines); n++) {
          ranges.push(selectedLine.range(tr.state.doc.line(n).from));
        }
        return Decoration.set(ranges);
      }
      return value.map(tr.changes);
    },
    provide: (field) => EditorView.decorations.from(field),
  });
  class SelectedGutterMarker extends GutterMarker {
    elementClass = 'cm-comment-gutter';
  }
  const selectedGutter = new SelectedGutterMarker();
  const selectedGutterField = StateField.define<RangeSet<GutterMarker>>({
    create: () => RangeSet.empty,
    update(value, tr) {
      for (const effect of tr.effects) {
        if (!effect.is(setSelectedLines)) continue;
        if (!effect.value) return RangeSet.empty;
        const ranges = [];
        for (let n = effect.value.from; n <= Math.min(effect.value.to, tr.state.doc.lines); n++) {
          ranges.push(selectedGutter.range(tr.state.doc.line(n).from));
        }
        return RangeSet.of(ranges);
      }
      return value.map(tr.changes);
    },
    provide: (field) => gutterLineClass.from(field),
  });

  let lineSelection: { side: 'old' | 'new'; anchor: number; from: number; to: number } | null = null;

  function paneOf(side: 'old' | 'new'): EditorView | undefined {
    return side === 'old' ? mergeView?.a : mergeView?.b;
  }

  export function clearLineSelection(): void {
    if (!lineSelection) return;
    paneOf(lineSelection.side)?.dispatch({ effects: setSelectedLines.of(null) });
    lineSelection = null;
  }

  let isDraggingLines = false;

  function selectLines(view: EditorView, side: 'old' | 'new', anchor: number, number: number): void {
    if (lineSelection && lineSelection.side !== side) clearLineSelection();
    lineSelection = { side, anchor, from: Math.min(anchor, number), to: Math.max(anchor, number) };
    view.dispatch({ effects: setSelectedLines.of({ from: lineSelection.from, to: lineSelection.to }) });
  }

  function selectableLineNumbers(side: 'old' | 'new'): Extension {
    return lineNumbers({
      domEventHandlers: {
        mousedown(view, line, event) {
          const number = view.state.doc.lineAt(line.from).number;
          const isExtending = (event as MouseEvent).shiftKey && lineSelection?.side === side;
          selectLines(view, side, isExtending && lineSelection ? lineSelection.anchor : number, number);
          isDraggingLines = true;
          document.addEventListener('mouseup', () => {
            isDraggingLines = false;
            if (lineSelection) dispatch('lineSelect', { side, from: lineSelection.from, to: lineSelection.to });
          }, { once: true });
          return true;
        },
        mousemove(view, line) {
          if (!isDraggingLines || lineSelection?.side !== side) return false;
          const number = view.state.doc.lineAt(line.from).number;
          if (number === lineSelection.to || number === lineSelection.from) return false;
          selectLines(view, side, lineSelection.anchor, number);
          return true;
        },
      },
    });
  }

  class DiscussionMarker extends GutterMarker {
    marker: DiffMarker;
    constructor(marker: DiffMarker) {
      super();
      this.marker = marker;
    }
    eq(other: DiscussionMarker): boolean {
      return other.marker.count === this.marker.count
        && other.marker.isResolved === this.marker.isResolved
        && other.marker.kind === this.marker.kind;
    }
    toDOM(): Node {
      const el = document.createElement('span');
      el.className = `cm-review-marker kind-${this.marker.kind ?? 'discussion'} ${this.marker.isResolved ? 'is-resolved' : ''}`;
      el.textContent = String(this.marker.count);
      el.dataset.line = String(this.marker.line);
      el.dataset.side = this.marker.side;
      return el;
    }
  }

  function markerGutter(side: 'old' | 'new', list: DiffMarker[]): Extension {
    const byLine = new Map(list.filter(m => m.side === side).map(m => [m.line, m]));
    return gutter({
      class: 'cm-review-gutter',
      lineMarker(view, line) {
        const number = view.state.doc.lineAt(line.from).number;
        const marker = byLine.get(number);
        return marker ? new DiscussionMarker(marker) : null;
      },
      lineMarkerChange: () => false,
      domEventHandlers: {
        click(_view, line) {
          const number = _view.state.doc.lineAt(line.from).number;
          if (!byLine.has(number)) return false;
          dispatch('markerClick', { line: number, side });
          return true;
        },
      },
    });
  }

  /** Scrolls both panes so the line sits in view; `side` picks the document the line number refers to. */
  export function scrollToLine(line: number, side: 'old' | 'new'): void {
    if (!mergeView) return;
    const view = side === 'old' ? mergeView.a : mergeView.b;
    const clamped = Math.max(1, Math.min(line, view.state.doc.lines));
    const pos = view.state.doc.line(clamped).from;
    view.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: 'center' }),
    });
  }

  let container: HTMLDivElement;
  let mergeView: MergeView;

  const themeCompartment = new Compartment();
  const highlightCompartment = new Compartment();
  const oldMarkersCompartment = new Compartment();
  const newMarkersCompartment = new Compartment();

  /** Editor extensions shared by both panes, with theme and highlight in compartments so they can be swapped later. */
  async function buildExtensions(): Promise<Extension[]> {
    const theme = $settings.theme;
    return [
      await resolveLanguageExtension(language),
      unselectableGutters,
      bracketMatching(),
      EditorView.lineWrapping,
      EditorState.readOnly.of(true),
      selectedLinesField,
      selectedGutterField,
      themeCompartment.of(buildEditorTheme(theme)),
      highlightCompartment.of(syntaxHighlighting(buildHighlight(theme, $activeSyntaxTokens))),
      EditorView.theme({
        '.cm-activeLine': { backgroundColor: 'transparent !important' },
        '.cm-activeLineGutter': { backgroundColor: 'transparent !important' },
      }),
    ];
  }

  $: if (mergeView) {
    const theme = $settings.theme;
    const effects = [
      themeCompartment.reconfigure(buildEditorTheme(theme)),
      highlightCompartment.reconfigure(syntaxHighlighting(buildHighlight(theme, $activeSyntaxTokens))),
    ];
    mergeView.a.dispatch({ effects });
    mergeView.b.dispatch({ effects });
  }

  $: if (mergeView) {
    mergeView.a.dispatch({ effects: oldMarkersCompartment.reconfigure(markerGutter('old', markers)) });
    mergeView.b.dispatch({ effects: newMarkersCompartment.reconfigure(markerGutter('new', markers)) });
  }

  let destroyed = false;

  // MergeView misaligns the last chunk when one side lacks its trailing newline.
  const normalize = (s: string) => (s.endsWith('\n') ? s : s + '\n');

  /**
   * Replaces both documents when the props no longer match what is on screen.
   *
   * The view is built inside an async mount - the language mode is a dynamic
   * import - so the content it captured can already be stale by the time it
   * exists: switching files while a mode is still loading built the editor on
   * the props of a file the user had already left. Reconciling here makes the
   * props the single source of truth rather than the mount's timing.
   */
  function syncDocs(
    _view: MergeView | null,
    _old: string,
    _new: string,
  ) {
    if (!mergeView) return;
    const wantA = normalize(oldContent);
    const wantB = normalize(newContent);
    const haveA = mergeView.a.state.doc.toString();
    const haveB = mergeView.b.state.doc.toString();
    if (haveA !== wantA) {
      mergeView.a.dispatch({
        changes: { from: 0, to: mergeView.a.state.doc.length, insert: wantA },
      });
    }
    if (haveB !== wantB) {
      mergeView.b.dispatch({
        changes: { from: 0, to: mergeView.b.state.doc.length, insert: wantB },
      });
    }
    // The documents were replaced, so this is another file: the offset the
    // reader left in the previous one means nothing here, and keeping it drops
    // them into the middle of a file they have not started.
    if (haveA !== wantA || haveB !== wantB) scrollToTop();
  }

  /**
   * The pair shares one scroller - `mergeView.dom` is the `.cm-mergeView`
   * element that carries the overflow - so the whole view goes back to the top.
   */
  function scrollToTop() {
    if (mergeView) (mergeView.dom as HTMLElement).scrollTop = 0;
  }

  // Named dependencies, so the statement re-runs on either document changing
  // and on the view coming into existence.
  $: syncDocs(mergeView, oldContent, newContent);

  onMount(async () => {
    // The language mode is fetched on demand, so the view is built once it is in hand.
    const exts = await buildExtensions();
    if (destroyed) return;
    mergeView = new MergeView({
      a: { doc: normalize(oldContent), extensions: [lineNumbers(), oldMarkersCompartment.of(markerGutter('old', markers)), ...exts] },
      b: { doc: normalize(newContent), extensions: [selectableLineNumbers('new'), newMarkersCompartment.of(markerGutter('new', markers)), ...exts] },
      parent: container,
      highlightChanges: true,
      gutter: true,
    });

  });

  onDestroy(() => {
    destroyed = true;
    mergeView?.destroy();
  });
</script>

<div bind:this={container} class="diff-mount"></div>

<style>
  .diff-mount {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }
  /* One scrollbar for the pair. `@codemirror/merge` is built for this: it lets
     both editors grow to their full content height and expects the container to
     scroll them together. Giving each pane its own `overflow` instead produced
     two scrollbars that had to be kept in step by hand, and the two sides drift
     apart whenever their line heights differ. */
  .diff-mount :global(.cm-mergeView) {
    width: 100%;
    position: absolute;
    inset: 0;
    overflow-y: auto;
    overflow-x: hidden;
  }
  .diff-mount :global(.cm-mergeViewEditors) {
    align-items: stretch;
    /* Short files still fill the pane rather than stopping mid-way. */
    min-height: 100%;
  }
  .diff-mount :global(.cm-mergeViewEditor) {
    flex: 1 1 0% !important;
    min-width: 0;
    overflow: visible;
  }
  .diff-mount :global(.cm-mergeGutter) {
    background: oklch(0.14 0.008 70);
    border-left: 1px solid oklch(0.26 0.008 70);
    border-right: 1px solid oklch(0.26 0.008 70);
    width: 16px;
    flex-shrink: 0;
  }
  .diff-mount :global(.cm-review-gutter) {
    width: 18px;
  }
  .diff-mount :global(.cm-mergeViewEditor:last-child .cm-lineNumbers .cm-gutterElement) {
    cursor: pointer;
  }
  .diff-mount :global(.cm-mergeViewEditor:last-child .cm-lineNumbers .cm-gutterElement:hover),
  .diff-mount :global(.cm-lineNumbers .cm-gutterElement.cm-comment-gutter) {
    color: var(--accent);
    background: oklch(0.75 0.15 240 / 0.18);
  }
  .diff-mount :global(.cm-comment-line) {
    background: oklch(0.75 0.15 240 / 0.22) !important;
  }
  .diff-mount :global(.cm-review-marker) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 14px;
    height: 14px;
    padding: 0 3px;
    margin-top: 2px;
    border-radius: 7px;
    font-size: 9px;
    font-weight: 700;
    line-height: 1;
    background: var(--accent);
    color: var(--bg-0);
    cursor: pointer;
  }
  .diff-mount :global(.cm-review-marker.is-resolved) {
    background: var(--fg-3);
  }
  .diff-mount :global(.cm-review-marker.kind-issue) { background: var(--danger); }
  .diff-mount :global(.cm-review-marker.kind-question) { background: oklch(0.82 0.14 60); }
  .diff-mount :global(.cm-review-marker.kind-refactor) { background: oklch(0.7 0.14 280); }
  .diff-mount :global(.cm-review-marker.kind-note) { background: var(--fg-3); }
  .diff-mount :global(.cm-review-marker.kind-comment) {
    background: transparent;
    border: 1.5px solid var(--accent);
    color: var(--accent);
  }
  .diff-mount :global(.cm-deletedChunk) {
    background: oklch(0.70 0.18 15 / 0.12);
  }
  .diff-mount :global(.cm-deletedChunk .cm-deletedLine) {
    background: oklch(0.70 0.18 15 / 0.18);
  }
  .diff-mount :global(.cm-changedLine) {
    background: oklch(0.78 0.14 135 / 0.10);
  }
  .diff-mount :global(.cm-changedText) {
    background: oklch(0.78 0.14 135 / 0.28);
  }
</style>
