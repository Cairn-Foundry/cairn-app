<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { basicSetup } from 'codemirror';
  import { EditorView } from '@codemirror/view';
  import { EditorState } from '@codemirror/state';
  import { javascript } from '@codemirror/lang-javascript';
  import { sql } from '@codemirror/lang-sql';
  import { json } from '@codemirror/lang-json';
  import { autocompletion } from '@codemirror/autocomplete';

  export let content: string = '';
  export let language: 'ts' | 'js' | 'sql' | 'json' | 'text' = 'ts';
  export let readonly: boolean = true;

  let container: HTMLDivElement;
  let view: EditorView;

  const cairnTheme = EditorView.theme({
    '&': {
      backgroundColor: 'oklch(0.16 0.008 70)',
      color: 'oklch(0.82 0.005 80)',
      height: '100%',
      fontSize: '13px',
      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    },
    '.cm-content': { padding: '12px 0', caretColor: 'oklch(0.72 0.14 250)' },
    '.cm-focused': { outline: 'none' },
    '.cm-line': { padding: '0 16px 0 0', lineHeight: '1.65' },
    '.cm-gutters': {
      backgroundColor: 'oklch(0.16 0.008 70)',
      borderRight: '1px solid oklch(0.26 0.008 70)',
      color: 'oklch(0.36 0.006 80)',
    },
    '.cm-gutter': { minWidth: '44px' },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 12px 0 8px', fontSize: '11.5px' },
    '.cm-activeLineGutter': { backgroundColor: 'oklch(0.215 0.008 70)' },
    '.cm-activeLine': { backgroundColor: 'oklch(0.215 0.008 70)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
      backgroundColor: 'oklch(0.72 0.14 250 / 0.22) !important',
    },
    '.cm-cursor': { borderLeftColor: 'oklch(0.72 0.14 250)' },
    '.cm-tooltip': {
      backgroundColor: 'oklch(0.245 0.008 70)',
      border: '1px solid oklch(0.32 0.008 70)',
      borderRadius: '5px',
      color: 'oklch(0.82 0.005 80)',
    },
    '.cm-tooltip-autocomplete ul li[aria-selected]': {
      backgroundColor: 'oklch(0.72 0.14 250 / 0.2)',
      color: 'oklch(0.96 0.005 80)',
    },
  }, { dark: true });

  function buildExtensions() {
    const lang = language === 'sql' ? sql()
               : language === 'json' ? json()
               : javascript({ typescript: language === 'ts' });
    return [
      basicSetup,
      lang,
      autocompletion(),
      cairnTheme,
      EditorView.lineWrapping,
      EditorState.readOnly.of(readonly),
    ];
  }

  onMount(() => {
    view = new EditorView({
      state: EditorState.create({ doc: content, extensions: buildExtensions() }),
      parent: container,
    });
  });

  $: if (view) {
    const current = view.state.doc.toString();
    if (current !== content) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: content } });
    }
  }

  onDestroy(() => view?.destroy());
</script>

<div bind:this={container} class="editor-mount"></div>

<style>
  .editor-mount { height: 100%; overflow: hidden; }
  .editor-mount :global(.cm-editor) { height: 100%; }
  .editor-mount :global(.cm-scroller) {
    overflow: auto;
    scrollbar-width: thin;
    scrollbar-color: oklch(0.32 0.008 70) transparent;
  }
</style>
