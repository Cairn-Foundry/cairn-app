<script lang="ts">
  /** Stands in for the CodeMirror editor: the pane's own behaviour is the subject. */
  export let doc: unknown = undefined;
  export let language: unknown = undefined;
  export let docPath = '';

  /** What FilesView reads off the editor when it switches tabs. */
  export function getState() { return { cursorPos: 0, scrollTop: 0 }; }
  export function getEditorState() { return null; }
</script>

<div data-code-editor data-path={docPath}>{doc ?? ''}{language ? '' : ''}</div>
