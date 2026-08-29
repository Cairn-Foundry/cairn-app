<script lang="ts">
  /** Stands in for the CodeMirror editor: the pane's own behaviour is the subject. */
  export let doc: unknown = undefined;
  export let language: unknown = undefined;
  export let docPath = '';
</script>

<div data-code-editor data-path={docPath}>{doc ?? ''}{language ? '' : ''}</div>
