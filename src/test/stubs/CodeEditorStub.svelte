<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /** Stands in for the CodeMirror editor: the pane's own behaviour is the subject. */
  export let doc: unknown = undefined;
  /** What EditorPane actually passes: the tab's CodeMirror document. */
  export let content: unknown = undefined;
  export let language: unknown = undefined;
  export let docPath = '';

  /** What FilesView reads off the editor when it switches tabs. */
  export function getState() { return { cursorPos: 0, scrollTop: 0 }; }
  export function getEditorState() { return null; }

  $: shown = content ?? doc;
</script>

<div data-code-editor data-path={docPath}>{shown == null ? '' : String(shown)}{language ? '' : ''}</div>
