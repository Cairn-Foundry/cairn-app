# Binary file preview

Opening a `.png`, a `.pdf` or any other non-text file used to give an editor tab with an empty body
and a "Binary file - preview not available" placeholder. Those files now render in the tab, in read
only, as a normal editor tab (so they survive a restart, drag and split like any other).

## Kinds

`src/lib/utils/files/files-preview.ts` maps an extension to a `PreviewKind`:

- `image` - png, jpg, jpeg, gif, webp, bmp, ico, avif, apng
- `svg` - rendered from the buffer being edited, not from disk
- `pdf` - rendered by the webview
- `binary` - everything else

`isBinaryPath` (`services/file-service.ts`) still decides whether a tab is a preview tab or a text
tab; `previewKindFromPath` only decides how a preview tab draws itself. SVG is deliberately absent
from `BINARY_EXT`: it stays a text tab, editable, with a preview toggle.

## Rendering

`components/files/BinaryPreview.svelte` receives the *absolute* path (`EditorPane` resolves it with
`absolutePathOf`, hence its new `worktreePath` prop) and the kind:

- an image is served through Tauri's asset protocol (`convertFileSrc`), enabled for `$HOME/**` in
  `tauri.conf.json`. When the webview refuses that URL the `error` event falls back to a
  `data:` URL built from `read_file_base64`, and only a failure of *both* shows the fallback card.
- a pdf always goes through the `data:` URL: an `<embed>` gives no error event, so there would be no
  way to recover from a refused `asset://` URL. Above 24 MB the fallback card is shown instead.
- svg is rendered from the tab's `pending` text through a `data:image/svg+xml` URL, so an unsaved
  edit shows in the preview, and no file is read from disk at all. The eye button in the status bar
  switches between rendering and source.

  The preview is an **overlay** (`.editor-preview-overlay`, absolutely positioned over
  `.editor-body`), never a branch that replaces `CodeEditor`. Toggling a branch would tear down and
  rebuild the whole CodeMirror instance - and its language-server document with it - on every click,
  which locks the UI when the button is clicked repeatedly. The editor stays mounted and untouched
  underneath; only a cheap overlay appears and disappears.
- any other binary shows its size, a hex dump of its first 1024 bytes, and a button opening it in the
  system application (`openPath`, which is why `opener:allow-open-path` was added to the capability).

The status bar drops the text-only items (cursor position, line endings, indent, whitespace, format)
on a preview tab and shows the kind instead.

## Backend

`read_file_preview` (`src-tauri/src/commands/files.rs`) returns `{ size, headHex }` - the file size
plus the first 1024 bytes as hex. It never loads the whole file, so a large binary costs nothing;
`read_file` is not called at all for a preview tab.
