<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * Read-only unified diff of one file, rendered by CodeMirror's inline merge view.
   * Grows with its content and is meant to be embedded in a list rather than filled.
   */
  import { onMount, onDestroy } from 'svelte';
  import { inlineDiffTheme, unselectableGutters } from '$lib/utils/editor/editor-extensions';
  import { unifiedMergeView } from '@codemirror/merge';
  import { EditorState, Compartment, type Extension } from '@codemirror/state';
  import { EditorView, lineNumbers } from '@codemirror/view';
  import { syntaxHighlighting, bracketMatching } from '@codemirror/language';
  import { settings, activeSyntaxTokens } from '$lib/stores/settings';
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
  let view: EditorView;

  const themeCompartment = new Compartment();
  const highlightCompartment = new Compartment();

  /** Editor extensions for the current theme, with theme and highlight kept in compartments so they can be swapped later. */
  async function buildExtensions(): Promise<Extension[]> {
    const theme = $settings.theme;
    return [
      unifiedMergeView({
        original: oldContent,
        mergeControls: false,
        gutter: true,
        syntaxHighlightDeletions: true,
      }),
      await resolveLanguageExtension(language),
      lineNumbers(),
      unselectableGutters,
      bracketMatching(),
      EditorView.lineWrapping,
      EditorState.readOnly.of(true),
      themeCompartment.of(buildEditorTheme(theme)),
      highlightCompartment.of(syntaxHighlighting(buildHighlight(theme, $activeSyntaxTokens))),
      inlineDiffTheme,
    ];
  }

  $: if (view) {
    const theme = $settings.theme;
    view.dispatch({ effects: [
      themeCompartment.reconfigure(buildEditorTheme(theme)),
      highlightCompartment.reconfigure(syntaxHighlighting(buildHighlight(theme, $activeSyntaxTokens))),
    ]});
  }

  let destroyed = false;

  onMount(async () => {
    // The language mode is fetched on demand, so the view is built once it is in hand.
    const extensions = await buildExtensions();
    if (destroyed) return;
    view = new EditorView({
      state: EditorState.create({ doc: newContent, extensions }),
      parent: container,
    });
  });

  onDestroy(() => {
    destroyed = true;
    view?.destroy();
  });
</script>

<div bind:this={container} class="inline-diff-mount"></div>

<style>
  .inline-diff-mount {
    max-height: 320px;
    overflow: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--stroke-1) transparent;
  }
  .inline-diff-mount :global(.cm-editor) { height: auto; }

  /* @codemirror/merge inline-diff classes, themed to match the app. */
  .inline-diff-mount :global(.cm-changedLine),
  .inline-diff-mount :global(.cm-insertedLine) {
    background: color-mix(in oklch, var(--success) 10%, transparent);
  }
  .inline-diff-mount :global(.cm-changedText) {
    background: color-mix(in oklch, var(--success) 28%, transparent);
  }
  .inline-diff-mount :global(.cm-deletedChunk) {
    background: color-mix(in oklch, var(--danger) 12%, transparent);
  }
  .inline-diff-mount :global(.cm-deletedChunk .cm-deletedText) {
    background: color-mix(in oklch, var(--danger) 28%, transparent);
  }
  .inline-diff-mount :global(.cm-changeGutter) { width: 3px; }
  .inline-diff-mount :global(.cm-changedLineGutter) { background: var(--success); }
  .inline-diff-mount :global(.cm-deletedLineGutter) { background: var(--danger); }
</style>
