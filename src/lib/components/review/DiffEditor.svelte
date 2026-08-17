<script lang="ts">
  /**
   * Read-only side by side diff of one file, filling its positioned parent.
   * Both panes scroll together.
   */
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import { unselectableGutters } from '$lib/utils/editor/editor-extensions';
  import { MergeView } from '@codemirror/merge';
  import { EditorState, Compartment, type Extension } from '@codemirror/state';
  import { EditorView, GutterMarker, gutter, lineNumbers } from '@codemirror/view';
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

  const dispatch = createEventDispatcher<{ markerClick: { line: number; side: 'old' | 'new' } }>();

  class DiscussionMarker extends GutterMarker {
    marker: DiffMarker;
    constructor(marker: DiffMarker) {
      super();
      this.marker = marker;
    }
    eq(other: DiscussionMarker): boolean {
      return other.marker.count === this.marker.count && other.marker.isResolved === this.marker.isResolved;
    }
    toDOM(): Node {
      const el = document.createElement('span');
      el.className = `cm-review-marker ${this.marker.isResolved ? 'is-resolved' : ''}`;
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

  let cleanupScroll: (() => void) | undefined;
  let destroyed = false;

  onMount(async () => {
    // MergeView misaligns the last chunk when one side lacks its trailing newline.
    const normalize = (s: string) => s.endsWith('\n') ? s : s + '\n';
    // The language mode is fetched on demand, so the view is built once it is in hand.
    const exts = await buildExtensions();
    if (destroyed) return;
    mergeView = new MergeView({
      a: { doc: normalize(oldContent), extensions: [lineNumbers(), oldMarkersCompartment.of(markerGutter('old', markers)), ...exts] },
      b: { doc: normalize(newContent), extensions: [lineNumbers(), newMarkersCompartment.of(markerGutter('new', markers)), ...exts] },
      parent: container,
      highlightChanges: true,
      gutter: true,
    });

    const [elA, elB] = Array.from(
      mergeView.dom.querySelectorAll<HTMLElement>('.cm-mergeViewEditor')
    );
    if (elA && elB) {
      let syncing = false;
      const syncA = () => {
        if (syncing) return;
        syncing = true;
        elB.scrollTop = elA.scrollTop;
        syncing = false;
      };
      const syncB = () => {
        if (syncing) return;
        syncing = true;
        elA.scrollTop = elB.scrollTop;
        syncing = false;
      };
      elA.addEventListener('scroll', syncA);
      elB.addEventListener('scroll', syncB);
      cleanupScroll = () => {
        elA.removeEventListener('scroll', syncA);
        elB.removeEventListener('scroll', syncB);
      };
    }
  });

  onDestroy(() => {
    destroyed = true;
    cleanupScroll?.();
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
  .diff-mount :global(.cm-mergeView) {
    width: 100%;
    position: absolute;
      inset: 0;
  }
  .diff-mount :global(.cm-mergeViewEditor) {
    flex: 1 1 0% !important;
    overflow: auto;
    min-width: 0;
  }
  .diff-mount :global(.cm-mergeViewEditor .cm-editor) {
    height: 100%;
    width: 100%;
  }
  .diff-mount :global(.cm-mergeViewEditor .cm-scroller) {
    min-height: 100%;
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
