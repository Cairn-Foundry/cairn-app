<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { MergeView } from '@codemirror/merge';
  import { EditorState, Compartment, type Extension } from '@codemirror/state';
  import { EditorView, lineNumbers } from '@codemirror/view';
  import { syntaxHighlighting, bracketMatching } from '@codemirror/language';
  import { settings } from '$lib/stores/settings';
  import {
    buildEditorTheme,
    buildHighlight,
    resolveLanguageExtension,
    type EditorLanguage,
  } from '$lib/utils/editor/editor-theme';

  export let oldContent: string = '';
  export let newContent: string = '';
  export let language: EditorLanguage = 'ts';

  let container: HTMLDivElement;
  let mergeView: MergeView;

  const themeCompartment = new Compartment();
  const highlightCompartment = new Compartment();

  function buildExtensions(): Extension[] {
    const theme = $settings.theme ?? 'dark';
    return [
      resolveLanguageExtension(language),
      lineNumbers(),
      bracketMatching(),
      EditorView.lineWrapping,
      EditorState.readOnly.of(true),
      themeCompartment.of(buildEditorTheme(theme)),
      highlightCompartment.of(syntaxHighlighting(buildHighlight(theme))),
      EditorView.theme({
        '.cm-activeLine': { backgroundColor: 'transparent !important' },
        '.cm-activeLineGutter': { backgroundColor: 'transparent !important' },
      }),
    ];
  }

  $: if (mergeView) {
    const theme = $settings.theme ?? 'dark';
    const effects = [
      themeCompartment.reconfigure(buildEditorTheme(theme)),
      highlightCompartment.reconfigure(syntaxHighlighting(buildHighlight(theme))),
    ];
    mergeView.a.dispatch({ effects });
    mergeView.b.dispatch({ effects });
  }

  let cleanupScroll: (() => void) | undefined;

  onMount(() => {
    const normalize = (s: string) => s.endsWith('\n') ? s : s + '\n';
    const exts = buildExtensions();
    mergeView = new MergeView({
      a: { doc: normalize(oldContent), extensions: [...exts] },
      b: { doc: normalize(newContent), extensions: [...exts] },
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
