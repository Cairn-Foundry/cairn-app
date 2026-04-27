<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { readText } from '@tauri-apps/plugin-clipboard-manager';
  import { EditorView, keymap, hoverTooltip, GutterMarker, gutter } from '@codemirror/view';
  import { EditorState, EditorSelection, Compartment, Prec, StateEffect, StateField, type Extension } from '@codemirror/state';
  import { showMinimap } from '@replit/codemirror-minimap';
  import { javascript, scopeCompletionSource } from '@codemirror/lang-javascript';
  import { buildEditorTheme, buildHighlight, buildDiffGutterTheme, resolveLanguageExtension, type EditorLanguage } from '$lib/utils/editor-theme';
  import { lineNumbers, rectangularSelection, crosshairCursor, drawSelection, highlightWhitespace } from '@codemirror/view';
  import {
    autocompletion, completionKeymap, acceptCompletion,
    closeBrackets, closeBracketsKeymap,
    snippetCompletion, completeFromList,
  } from '@codemirror/autocomplete';
  import {
    syntaxHighlighting, syntaxTree,
    bracketMatching, foldGutter, foldKeymap, indentOnInput,
    codeFolding,
  } from '@codemirror/language';
  import {
    history, historyKeymap, defaultKeymap,
    insertTab, toggleComment, toggleBlockComment,
    moveLineUp, moveLineDown, copyLineDown,
    deleteLine, selectLine, indentMore, indentLess,
    selectParentSyntax, cursorMatchingBracket, selectAll,
    addCursorAbove, addCursorBelow,
  } from '@codemirror/commands';
  import { gotoLine } from '@codemirror/search';
  import { shortcuts, activeShortcuts, toCmKey, bindingToLabels } from '$lib/stores/shortcuts';
  import type { ShortcutId, ShortcutBinding } from '$lib/types/shortcuts';
  import { settings } from '$lib/stores/settings';
  import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';
  import { lintKeymap } from '@codemirror/lint';

  export let content: string = '';
  export let onChange: ((value: string) => void) | undefined = undefined;
  export let onBlur: (() => void) | undefined = undefined;
  export let onCursorChange: ((line: number, col: number) => void) | undefined = undefined;
  export let initialCursorPos: number = 0;
  export let initialScrollTop: number = 0;

  export function getState(): { cursorPos: number; scrollTop: number } {
    if (!view) return { cursorPos: 0, scrollTop: 0 };
    return {
      cursorPos: view.state.selection.main.head,
      scrollTop: view.scrollDOM.scrollTop,
    };
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

  export let language: EditorLanguage = 'ts';
  export let readonly: boolean = true;
  export let minimapEnabled: boolean = true;
  export let fontSize: number = 13;
  type DiffHunkLine = { type: '+' | '-' | ' '; content: string };
  type DiffHunk = { oldStart: number; newStart: number; newEnd: number; lines: DiffHunkLine[] };

  export let diffHunks: DiffHunk[] = [];
  export let stagedHunks: DiffHunk[] = [];
  export let onDiffClick: ((hunk: DiffHunk) => void) | undefined = undefined;
  export let showWhitespace: boolean = false;
  export let savedState: EditorState | null = null;

  let container: HTMLDivElement;
  let view: EditorView;

  // ── Context menu ────────────────────────────────────────────────────────────

  type ContextMenuState = { x: number; y: number; hasSelection: boolean };
  let ctxMenu: ContextMenuState | null = null;
  let ctxMenuEl: HTMLElement | null = null;

  function openContextMenu(event: MouseEvent) {
    event.preventDefault();
    if (!view) return;

    const sel = view.state.selection.main;
    const hasSelection = !sel.empty;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const menuW = 220;
    const menuH = 320; // approximate

    let x = event.clientX;
    let y = event.clientY;
    if (x + menuW > vw - 8) x = Math.max(8, x - menuW);
    if (y + menuH > vh - 8) y = Math.max(8, y - menuH);

    ctxMenu = { x, y, hasSelection };
  }

  function closeContextMenu() {
    ctxMenu = null;
  }

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
    const text = view.state.sliceDoc(from, to);
    await navigator.clipboard.writeText(text);
    view.focus();
  }

  async function cmdCut() {
    closeContextMenu();
    if (!view || readonly) return;
    const { from, to } = view.state.selection.main;
    const text = view.state.sliceDoc(from, to);
    await navigator.clipboard.writeText(text);
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

  // ── Git diff gutter ────────────────────────────────────────────────────────

  type DiffKind = 'added' | 'modified' | 'deleted';

  const diffEffect = StateEffect.define<Map<number, DiffKind>>();
  const diffField = StateField.define<Map<number, DiffKind>>({
    create: () => new Map(),
    update: (value, tr) => {
      for (const e of tr.effects) if (e.is(diffEffect)) return e.value;
      return value;
    },
  });

  function hunksToLineMap(hunks: DiffHunk[]): Map<number, DiffKind> {
    const map = new Map<number, DiffKind>();
    for (const hunk of hunks) {
      let newLine = hunk.newStart;
      let prevWasDelete = false;
      let inDeletionBlock = false;
      let deletionPoint = 0;
      let deletionHadPlus = false;

      function flushDeletion() {
        if (inDeletionBlock && !deletionHadPlus) {
          const marker = Math.max(1, deletionPoint);
          if (!map.has(marker)) map.set(marker, 'deleted');
        }
        inDeletionBlock = false;
        deletionHadPlus = false;
        prevWasDelete = false;
      }

      for (const l of hunk.lines) {
        if (l.type === '-') {
          if (!inDeletionBlock) { deletionPoint = newLine; deletionHadPlus = false; }
          inDeletionBlock = true;
          prevWasDelete = true;
        } else if (l.type === '+') {
          map.set(newLine, prevWasDelete ? 'modified' : 'added');
          prevWasDelete = false;
          inDeletionBlock = false;
          deletionHadPlus = false;
          newLine++;
        } else {
          flushDeletion();
          newLine++;
        }
      }
      flushDeletion();
    }
    return map;
  }

  class DiffMarker extends GutterMarker {
    kind: DiffKind;
    lineNum: number;
    staged: boolean;
    constructor(kind: DiffKind, lineNum: number, staged = false) {
      super();
      this.kind = kind;
      this.lineNum = lineNum;
      this.staged = staged;
    }
    toDOM() {
      const el = document.createElement('div');
      el.className = `cm-diff-marker cm-diff-${this.kind}${this.staged ? ' cm-diff-staged' : ''}`;
      return el;
    }
  }

  const stagedDiffField = StateEffect.define<Map<number, DiffKind>>();
  const stagedField = StateField.define<Map<number, DiffKind>>({
    create: () => new Map(),
    update: (value, tr) => {
      for (const e of tr.effects) if (e.is(stagedDiffField)) return e.value;
      return value;
    },
  });

  $: if (view) {
    view.dispatch({ effects: stagedDiffField.of(hunksToLineMap(stagedHunks)) });
  }

  function buildDiffGutter(): Extension {
    return [
      diffField,
      stagedField,
      gutter({
        class: 'cm-diff-gutter',
        lineMarker(v, line) {
          const num = v.state.doc.lineAt(line.from).number;
          const kind = v.state.field(diffField).get(num);
          const stagedKind = v.state.field(stagedField).get(num);
          if (stagedKind) return new DiffMarker(stagedKind, num, true);
          if (kind) return new DiffMarker(kind, num, false);
          return null;
        },
        lineMarkerChange: (update) =>
          update.startState.field(diffField) !== update.state.field(diffField) ||
          update.startState.field(stagedField) !== update.state.field(stagedField),
        initialSpacer: () => new DiffMarker('added', 0),
        domEventHandlers: {
          mousedown(v, line) {
            const lineNum = v.state.doc.lineAt(line.from).number;
            if (!v.state.field(diffField).has(lineNum) && !v.state.field(stagedField).has(lineNum)) return false;
            const allHunks = [...diffHunks, ...stagedHunks];
            const hunk = allHunks.find(h => lineNum >= h.newStart && lineNum <= h.newEnd);
            if (hunk) onDiffClick?.(hunk);
            return true;
          },
        },
      }),
    ];
  }

  const minimapCompartment = new Compartment();
  const fontSizeCompartment = new Compartment();
  const shortcutKeymapCompartment = new Compartment();
  const themeCompartment = new Compartment();
  const highlightCompartment = new Compartment();
  const whitespaceCompartment = new Compartment();

  export function setContent(text: string): void {
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== text) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: text }, userEvent: 'input' });
    }
  }

  function duplicateLineStay(view: EditorView): boolean {
    const { state } = view;
    const changes = state.changeByRange(range => {
      const line = state.doc.lineAt(range.from);
      return {
        changes: { from: line.to, to: line.to, insert: '\n' + line.text },
        range,
      };
    });
    view.dispatch(state.update(changes, { scrollIntoView: true, userEvent: 'input' }));
    return true;
  }

  function buildShortcutKeymap(bindings: Record<ShortcutId, ShortcutBinding | null>): Extension {
    const defs: { id: ShortcutId; run: (view: EditorView) => boolean }[] = [
      { id: 'toggleLineComment',  run: toggleComment },
      { id: 'toggleBlockComment', run: toggleBlockComment },
      { id: 'moveLineUp',         run: moveLineUp },
      { id: 'moveLineDown',       run: moveLineDown },
      { id: 'copyLineDown',       run: copyLineDown },
      { id: 'deleteLine',         run: deleteLine },
      { id: 'selectLine',         run: selectLine },
      { id: 'matchingBracket',    run: cursorMatchingBracket },
      { id: 'indentMore',         run: indentMore },
      { id: 'indentLess',         run: indentLess },
      { id: 'expandSelection',    run: selectParentSyntax },
      { id: 'goToLine',           run: gotoLine },
      { id: 'addCursorAbove',     run: addCursorAbove },
      { id: 'addCursorBelow',     run: addCursorBelow },
      { id: 'duplicateLine',      run: duplicateLineStay },
    ];
    return keymap.of(
      defs
        .filter(d => bindings[d.id] !== null)
        .map(d => ({ key: toCmKey(bindings[d.id]!), run: d.run }))
    );
  }

  function buildFontSizeTheme(size: number): Extension {
    return fontSizeCompartment.of(EditorView.theme({
      '&': { fontSize: `${size}px` },
      '.cm-lineNumbers .cm-gutterElement': { fontSize: `${size - 1.5}px` },
    }));
  }

  function buildMinimapExtension(enabled: boolean): Extension {
    return minimapCompartment.of(
      enabled
        ? showMinimap.of({ create: () => { const dom = document.createElement('div'); return { dom }; }, displayText: 'blocks', showOverlay: 'always' })
        : []
    );
  }

  // ── Snippets ───────────────────────────────────────────────────────────────

  const jsSnippets = [
    snippetCompletion('if (${condition}) {\n\t${}\n}', { label: 'if', detail: 'if statement', type: 'keyword' }),
    snippetCompletion('if (${condition}) {\n\t${}\n} else {\n\t${}\n}', { label: 'ifelse', detail: 'if/else', type: 'keyword' }),
    snippetCompletion('for (let ${i} = 0; ${i} < ${n}; ${i}++) {\n\t${}\n}', { label: 'for', detail: 'for loop', type: 'keyword' }),
    snippetCompletion('for (const ${item} of ${iterable}) {\n\t${}\n}', { label: 'forof', detail: 'for…of', type: 'keyword' }),
    snippetCompletion('for (const ${key} in ${object}) {\n\t${}\n}', { label: 'forin', detail: 'for…in', type: 'keyword' }),
    snippetCompletion('while (${condition}) {\n\t${}\n}', { label: 'while', detail: 'while loop', type: 'keyword' }),
    snippetCompletion('function ${name}(${params}) {\n\t${}\n}', { label: 'function', detail: 'function declaration', type: 'keyword' }),
    snippetCompletion('const ${name} = (${params}) => {\n\t${}\n}', { label: 'arrow', detail: 'arrow function', type: 'keyword' }),
    snippetCompletion('const ${name} = async (${params}) => {\n\t${}\n}', { label: 'asyncarrow', detail: 'async arrow', type: 'keyword' }),
    snippetCompletion('async function ${name}(${params}) {\n\t${}\n}', { label: 'asyncfn', detail: 'async function', type: 'keyword' }),
    snippetCompletion('class ${Name} {\n\tconstructor(${params}) {\n\t\t${}\n\t}\n}', { label: 'class', detail: 'class declaration', type: 'keyword' }),
    snippetCompletion('try {\n\t${}\n} catch (${error}) {\n\t${}\n}', { label: 'try', detail: 'try/catch', type: 'keyword' }),
    snippetCompletion('try {\n\t${}\n} catch (${error}) {\n\t${}\n} finally {\n\t${}\n}', { label: 'trycf', detail: 'try/catch/finally', type: 'keyword' }),
    snippetCompletion('switch (${expr}) {\n\tcase ${value}:\n\t\t${}\n\t\tbreak;\n\tdefault:\n\t\tbreak;\n}', { label: 'switch', detail: 'switch statement', type: 'keyword' }),
    snippetCompletion('import { ${names} } from \'${module}\'', { label: 'import', detail: 'named import', type: 'keyword' }),
    snippetCompletion('import ${name} from \'${module}\'', { label: 'importd', detail: 'default import', type: 'keyword' }),
    snippetCompletion('export const ${name} = ${value}', { label: 'exportc', detail: 'export const', type: 'keyword' }),
    snippetCompletion('export function ${name}(${params}) {\n\t${}\n}', { label: 'exportf', detail: 'export function', type: 'keyword' }),
    snippetCompletion('export default ${value}', { label: 'exportd', detail: 'export default', type: 'keyword' }),
    snippetCompletion('console.log(${value})', { label: 'log', detail: 'console.log', type: 'function' }),
    snippetCompletion('console.error(${value})', { label: 'logerr', detail: 'console.error', type: 'function' }),
    snippetCompletion('console.warn(${value})', { label: 'logwarn', detail: 'console.warn', type: 'function' }),
    snippetCompletion('const ${name} = await ${promise}', { label: 'await', detail: 'await expression', type: 'keyword' }),
    snippetCompletion('new Promise((${resolve}, ${reject}) => {\n\t${}\n})', { label: 'promise', detail: 'new Promise', type: 'function' }),
    snippetCompletion('setTimeout(() => {\n\t${}\n}, ${delay})', { label: 'timeout', detail: 'setTimeout', type: 'function' }),
  ];

  const tsSnippets = [
    ...jsSnippets,
    snippetCompletion('interface ${Name} {\n\t${}\n}', { label: 'interface', detail: 'interface declaration', type: 'keyword' }),
    snippetCompletion('type ${Name} = ${definition}', { label: 'type', detail: 'type alias', type: 'keyword' }),
    snippetCompletion('enum ${Name} {\n\t${Member},\n}', { label: 'enum', detail: 'enum declaration', type: 'keyword' }),
    snippetCompletion('as ${Type}', { label: 'as', detail: 'type cast', type: 'keyword' }),
    snippetCompletion('<${Type}>(${value})', { label: 'cast', detail: 'angle bracket cast', type: 'keyword' }),
    snippetCompletion('${name}?: ${Type}', { label: 'optprop', detail: 'optional property', type: 'property' }),
    snippetCompletion('Record<${Key}, ${Value}>', { label: 'Record', detail: 'Record type', type: 'type' }),
    snippetCompletion('Partial<${Type}>', { label: 'Partial', detail: 'Partial type', type: 'type' }),
    snippetCompletion('Required<${Type}>', { label: 'Required', detail: 'Required type', type: 'type' }),
    snippetCompletion('Readonly<${Type}>', { label: 'Readonly', detail: 'Readonly type', type: 'type' }),
    snippetCompletion('Array<${Type}>', { label: 'Array', detail: 'Array type', type: 'type' }),
    snippetCompletion('Promise<${Type}>', { label: 'Promise', detail: 'Promise type', type: 'type' }),
  ];

  // ── Hover tooltip ──────────────────────────────────────────────────────────

  function buildHoverTooltip() {
    return hoverTooltip((editorView, pos) => {
      const { state } = editorView;
      const leaf = syntaxNodeAt(state, pos);
      if (!leaf) return null;

      const name = state.sliceDoc(leaf.from, leaf.to).trim();
      if (!name || name.length > 80 || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) return null;

      const info = resolveInfo(state, leaf, name);
      if (!info) return null;

      return {
        pos: leaf.from,
        end: leaf.to,
        above: true,
        create() {
          const body = document.createElement('div');
          body.className = 'cairn-hover-body';

          const header = document.createElement('div');
          const badge = document.createElement('span');
          badge.className = `cairn-hover-kind cairn-hover-kind-${info.kind}`;
          badge.textContent = info.kind;
          header.appendChild(badge);

          const sig = document.createElement('span');
          sig.className = 'cairn-hover-name';
          sig.textContent = info.signature;
          header.appendChild(sig);

          if (info.returnType) {
            const ret = document.createElement('span');
            ret.className = 'cairn-hover-type';
            ret.textContent = ' → ' + info.returnType;
            header.appendChild(ret);
          }
          body.appendChild(header);

          if (info.doc) {
            const divider = document.createElement('div');
            divider.className = 'cairn-hover-divider';
            const docDiv = document.createElement('div');
            docDiv.className = 'cairn-hover-doc';
            docDiv.textContent = info.doc;
            body.appendChild(divider);
            body.appendChild(docDiv);
          }

          const wrap = document.createElement('div');
          wrap.className = 'cairn-hover';
          wrap.appendChild(body);
          return { dom: wrap };
        },
      };
    }, { hoverTime: 350 });
  }

  // ── Syntax tree helpers ────────────────────────────────────────────────────

  interface HoverInfo {
    kind: string;
    signature: string;
    returnType?: string;
    doc?: string;
  }

  type SyntaxNode = NonNullable<ReturnType<typeof syntaxNodeAt>>;

  function syntaxNodeAt(state: EditorState, pos: number) {
    try { return syntaxTree(state).resolveInner(pos, 1); } catch { return null; }
  }

  function resolveInfo(state: EditorState, leaf: SyntaxNode, name: string): HoverInfo | null {
    const leafType = leaf.type.name;
    const parentType = leaf.parent?.type.name ?? '';

    if (knownKeywords.has(name)) {
      return { kind: 'keyword', signature: name, doc: knownDocs[name] };
    }
    if (leafType === 'String' || leafType === 'TemplateString') {
      return { kind: 'string', signature: name };
    }
    if (leafType === 'Number') {
      return { kind: 'number', signature: name };
    }

    // Function definition (the identifier node's parent is the function node)
    if (
      parentType === 'FunctionDeclaration' ||
      parentType === 'FunctionExpression' ||
      parentType === 'MethodDeclaration' ||
      parentType === 'MethodDefinition' ||
      (parentType === 'VariableDeclarator' && leaf.parent && hasFunctionInit(leaf.parent))
    ) {
      const fnNode = parentType === 'VariableDeclarator' ? leaf.parent! : leaf.parent!;
      const params = extractParams(state, fnNode);
      return { kind: 'function', signature: `${name}(${params})`, returnType: 'unknown', doc: knownDocs[name] };
    }

    // Arrow function assigned to variable: `const foo = () => ...`
    if (parentType === 'VariableDeclarator') {
      return { kind: 'variable', signature: name, doc: knownDocs[name] };
    }

    // Function call
    if (parentType === 'CallExpression') {
      const args = extractCallArgs(state, leaf.parent!);
      return { kind: 'function', signature: `${name}(${args})`, doc: knownDocs[name] };
    }

    // Type / class
    if (
      leafType === 'TypeName' ||
      parentType === 'TypeAliasDeclaration' ||
      parentType === 'InterfaceDeclaration' ||
      parentType === 'ClassDeclaration' ||
      parentType === 'ClassExpression'
    ) {
      return { kind: 'type', signature: name, doc: knownDocs[name] };
    }

    // Property
    if (leafType === 'PropertyName' || parentType === 'MemberExpression') {
      return { kind: 'variable', signature: name, doc: knownDocs[name] };
    }

    // Plain identifier / variable
    if (leafType === 'VariableName' || leafType === 'Identifier' || parentType === 'LexicalDeclaration') {
      return { kind: 'variable', signature: name, doc: knownDocs[name] };
    }

    if (/^[A-Z]/.test(name)) return { kind: 'type', signature: name, doc: knownDocs[name] };
    if (name.length > 1)     return { kind: 'variable', signature: name, doc: knownDocs[name] };

    return null;
  }

  function hasFunctionInit(declarator: SyntaxNode): boolean {
    let child = declarator.firstChild;
    while (child) {
      const nt = child.type.name;
      if (nt === 'ArrowFunction' || nt === 'FunctionExpression') return true;
      child = child.nextSibling;
    }
    return false;
  }

  function extractParams(state: EditorState, fnNode: SyntaxNode): string {
    let child = fnNode.firstChild;
    while (child) {
      const nt = child.type.name;
      if (nt === 'ParamList' || nt === 'Parameters' || nt === 'FormalParameters') {
        return state.sliceDoc(child.from + 1, child.to - 1).trim();
      }
      child = child.nextSibling;
    }
    return '';
  }

  function extractCallArgs(state: EditorState, callNode: SyntaxNode): string {
    let child = callNode.firstChild;
    while (child) {
      const nt = child.type.name;
      if (nt === 'ArgList' || nt === 'Arguments') {
        return state.sliceDoc(child.from + 1, child.to - 1).trim();
      }
      child = child.nextSibling;
    }
    return '';
  }

  const knownKeywords = new Set([
    'const', 'let', 'var', 'function', 'class', 'import', 'export', 'async', 'await',
    'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue',
    'try', 'catch', 'finally', 'throw', 'new', 'delete', 'typeof', 'instanceof', 'void',
    'in', 'of', 'this', 'super', 'null', 'undefined', 'true', 'false',
  ]);

  const knownDocs: Record<string, string> = {
    console: 'Browser/Node.js console object for logging.',
    setTimeout: 'setTimeout(callback, delay) — runs callback after delay ms.',
    setInterval: 'setInterval(callback, delay) — runs callback every delay ms.',
    clearTimeout: 'Cancels a timeout created with setTimeout.',
    clearInterval: 'Cancels an interval created with setInterval.',
    Promise: 'Promise<T> — represents the eventual result of an async operation.',
    fetch: 'fetch(url, options?) → Promise<Response> — performs an HTTP request.',
    JSON: 'JSON.parse() / JSON.stringify() — serialization utilities.',
    Math: 'Math.abs, .floor, .ceil, .round, .max, .min, .random, .sqrt, …',
    Array: 'Array constructor. Use Array.from(), Array.isArray(), or [] literals.',
    Object: 'Object.keys(), .values(), .entries(), .assign(), .freeze(), …',
    String: 'String constructor. Methods: .trim(), .split(), .includes(), .replace(), …',
    Number: 'Number.isNaN(), .isFinite(), .parseInt(), .parseFloat(), .toFixed(n), …',
    Date: 'new Date() — current date. new Date(ms) / new Date(str) — from value.',
    Map: 'Map<K,V> — key-value collection preserving insertion order.',
    Set: 'Set<T> — collection of unique values.',
    WeakMap: 'WeakMap<K,V> — like Map but keys are weakly referenced.',
    WeakSet: 'WeakSet<T> — like Set but values are weakly referenced.',
    localStorage: 'localStorage.getItem(key) / .setItem(key, val) / .removeItem(key)',
    sessionStorage: 'sessionStorage — same API as localStorage, scoped to the tab session.',
    document: 'The root of the DOM. document.querySelector(), .createElement(), …',
    window: 'Global browser context. window.location, .history, .addEventListener, …',
    navigator: 'navigator.userAgent, .language, .onLine, .geolocation, …',
    location: 'window.location — current URL. .href, .pathname, .search, .hash.',
    history: 'history.pushState(), .replaceState(), .back(), .forward()',
    parseInt: 'parseInt(str, radix?) → number — parses an integer from a string.',
    parseFloat: 'parseFloat(str) → number — parses a float from a string.',
    isNaN: 'isNaN(value) → boolean — true if value is NaN.',
    isFinite: 'isFinite(value) → boolean — true if value is a finite number.',
    encodeURIComponent: 'encodeURIComponent(str) — encodes a URI component.',
    decodeURIComponent: 'decodeURIComponent(str) — decodes a URI component.',
    structuredClone: 'structuredClone(value) — deep-clones a value.',
    queueMicrotask: 'queueMicrotask(fn) — schedules fn as a microtask.',
    requestAnimationFrame: 'requestAnimationFrame(fn) — schedules fn before the next paint.',
    cancelAnimationFrame: 'Cancels a frame scheduled with requestAnimationFrame.',
    // keywords
    const: 'Block-scoped constant binding. Cannot be reassigned.',
    let: 'Block-scoped variable. Can be reassigned.',
    var: 'Function-scoped variable. Prefer const/let.',
    function: 'Declares a named function. Hoisted.',
    class: 'Declares a class with optional extends.',
    import: 'Imports exported bindings from a module.',
    export: 'Exports bindings from the current module.',
    async: 'Marks a function as async — it returns a Promise.',
    await: 'Pauses execution until the Promise resolves. Only inside async.',
    return: 'Exits the current function, optionally returning a value.',
    if: 'Conditional execution.',
    else: 'Alternative branch for an if statement.',
    for: 'Loop: for(init; cond; update) or for(x of/in y).',
    while: 'Loop while condition is true.',
    do: 'do { } while(cond) — runs body at least once.',
    switch: 'Multi-branch dispatch on a value.',
    break: 'Exits the current loop or switch.',
    continue: 'Skips to the next loop iteration.',
    try: 'Wraps code that may throw.',
    catch: 'Handles errors thrown in the try block.',
    finally: 'Runs after try/catch regardless of outcome.',
    throw: 'Throws an error (any value).',
    new: 'Creates an instance via a constructor function.',
    delete: 'Removes a property from an object.',
    typeof: 'typeof x → "string" | "number" | "boolean" | "object" | "function" | "undefined" | "symbol" | "bigint"',
    instanceof: 'x instanceof Constructor — true if x was created by Constructor.',
    void: 'Evaluates an expression and returns undefined.',
    in: '"prop" in obj — true if prop exists in obj.',
    of: 'Used in for…of loops to iterate over iterables.',
    this: 'The current execution context.',
    super: 'Calls the parent class constructor or accesses parent methods.',
    null: 'Intentional absence of a value.',
    undefined: 'A variable that has not been assigned a value.',
    true: 'Boolean true.',
    false: 'Boolean false.',
  };


  // ── Extensions ─────────────────────────────────────────────────────────────

  function buildExtensions(): Extension[] {
    const isJS = language === 'ts' || language === 'tsx' || language === 'js' || language === 'jsx';
    const isTS = language === 'ts' || language === 'tsx';
    const isJSX = language === 'tsx' || language === 'jsx';
    const jsLang = isJS ? javascript({ typescript: isTS, jsx: isJSX }) : null;
    const lang = jsLang ?? resolveLanguageExtension(language);
    const jsLanguageData = jsLang ? jsLang.language.data : null;

    const snippets: Extension[] = jsLanguageData
      ? [jsLanguageData.of({ autocomplete: completeFromList(isTS ? tsSnippets : jsSnippets) })]
      : [];

    const scopeCompletion: Extension[] = jsLanguageData
      ? [jsLanguageData.of({ autocomplete: scopeCompletionSource(globalThis) })]
      : [];

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
      shortcutKeymapCompartment.of([]),

      lang,
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
      highlightCompartment.of(syntaxHighlighting(buildHighlight('dark'))),
      foldGutter({ markerDOM: (open) => {
        const el = document.createElement('span');
        el.textContent = open ? '▾' : '▸';
        el.style.fontSize = '10px';
        el.style.lineHeight = '1.65';
        return el;
      }}),
      codeFolding(),
      search({ top: true }),
      highlightSelectionMatches({ minSelectionLength: 2, wholeWords: false }),
      autocompletion({ activateOnTyping: true, closeOnBlur: false, maxRenderedOptions: 12 }),
      ...snippets,
      ...scopeCompletion,
      buildHoverTooltip(),
      buildDiffGutter(),
      buildDiffGutterTheme(),
      buildMinimapExtension(minimapEnabled),
      themeCompartment.of(buildEditorTheme('dark')),
      buildFontSizeTheme(fontSize),
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
      const maxPos = view.state.doc.length;
      const pos = Math.min(initialCursorPos, maxPos);
      view.dispatch({ selection: { anchor: pos, head: pos } });
    }
    if (initialScrollTop > 0) {
      view.scrollDOM.scrollTop = initialScrollTop;
    }
  });

  $: if (view) {
    const current = view.state.doc.toString();
    if (current !== content) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: content } });
    }
  }

  $: if (view) {
    const ext = minimapEnabled
      ? showMinimap.of({ create: () => { const dom = document.createElement('div'); return { dom }; }, displayText: 'blocks', showOverlay: 'always' })
      : [];
    view.dispatch({ effects: minimapCompartment.reconfigure(ext) });
  }

  $: if (view) {
    view.dispatch({ effects: fontSizeCompartment.reconfigure(EditorView.theme({
      '&': { fontSize: `${fontSize}px` },
      '.cm-lineNumbers .cm-gutterElement': { fontSize: `${fontSize - 1.5}px` },
    })) });
  }

  $: if (view) {
    view.dispatch({ effects: diffEffect.of(hunksToLineMap(diffHunks)) });
  }

  $: if (view) {
    view.dispatch({ effects: shortcutKeymapCompartment.reconfigure(buildShortcutKeymap($activeShortcuts)) });
  }

  $: if (view) {
    const theme = $settings.theme ?? 'dark';
    view.dispatch({ effects: [
      themeCompartment.reconfigure(buildEditorTheme(theme)),
      highlightCompartment.reconfigure(syntaxHighlighting(buildHighlight(theme))),
    ]});
  }

  $: if (view) {
    view.dispatch({ effects: whitespaceCompartment.reconfigure(showWhitespace ? highlightWhitespace() : []) });
  }

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
      <span class="icon">⎘</span>Copy<span class="kbd">⌘C</span>
    </button>
    <button role="menuitem" disabled={!ctxMenu.hasSelection || readonly} on:click={cmdCut}>
      <span class="icon">✂</span>Cut<span class="kbd">⌘X</span>
    </button>
    <button role="menuitem" disabled={readonly} on:click={cmdPaste}>
      <span class="icon">⎗</span>Paste<span class="kbd">⌘V</span>
    </button>
    <button role="menuitem" on:click={() => runCmd(selectAll)}>
      <span class="icon"></span>Select All<span class="kbd">⌘A</span>
    </button>

    <div class="ctx-sep" role="separator"></div>

    <button role="menuitem" disabled={readonly} on:click={() => runCmd(toggleComment)}>
      <span class="icon"></span>Toggle Comment<span class="kbd">{bindingToLabels($shortcuts.toggleLineComment).join('')}</span>
    </button>
    <button role="menuitem" disabled={readonly} on:click={() => runCmd(toggleBlockComment)}>
      <span class="icon"></span>Toggle Block Comment<span class="kbd">{bindingToLabels($shortcuts.toggleBlockComment).join('')}</span>
    </button>

    <div class="ctx-sep" role="separator"></div>

    <button role="menuitem" disabled={readonly} on:click={() => runCmd(moveLineUp)}>
      <span class="icon">↑</span>Move Line Up<span class="kbd">{bindingToLabels($shortcuts.moveLineUp).join('')}</span>
    </button>
    <button role="menuitem" disabled={readonly} on:click={() => runCmd(moveLineDown)}>
      <span class="icon">↓</span>Move Line Down<span class="kbd">{bindingToLabels($shortcuts.moveLineDown).join('')}</span>
    </button>
    <button role="menuitem" disabled={readonly} on:click={() => runCmd(copyLineDown)}>
      <span class="icon"></span>Duplicate Line<span class="kbd">{bindingToLabels($shortcuts.copyLineDown).join('')}</span>
    </button>
    <button role="menuitem" disabled={readonly} on:click={() => runCmd(deleteLine)}>
      <span class="icon"></span>Delete Line<span class="kbd">{bindingToLabels($shortcuts.deleteLine).join('')}</span>
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
