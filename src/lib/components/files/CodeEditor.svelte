<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { EditorView, keymap, hoverTooltip } from '@codemirror/view';
  import { EditorState, Prec, type Extension } from '@codemirror/state';
  import { javascript, scopeCompletionSource } from '@codemirror/lang-javascript';
  import { html } from '@codemirror/lang-html';
  import { css } from '@codemirror/lang-css';
  import { markdown } from '@codemirror/lang-markdown';
  import { xml } from '@codemirror/lang-xml';
  import { yaml } from '@codemirror/lang-yaml';
  import { python } from '@codemirror/lang-python';
  import { rust } from '@codemirror/lang-rust';
  import { java } from '@codemirror/lang-java';
  import { cpp } from '@codemirror/lang-cpp';
  import { php } from '@codemirror/lang-php';
  import { sql } from '@codemirror/lang-sql';
  import { json } from '@codemirror/lang-json';
  import { vue } from '@codemirror/lang-vue';
  import { svelte } from 'codemirror-lang-svelte';
  import { languages } from '@codemirror/language-data';
  import { lineNumbers, rectangularSelection, crosshairCursor } from '@codemirror/view';
  import {
    autocompletion, completionKeymap, acceptCompletion,
    closeBrackets, closeBracketsKeymap,
    snippetCompletion, completeFromList,
  } from '@codemirror/autocomplete';
  import {
    HighlightStyle, syntaxHighlighting, syntaxTree,
    bracketMatching, foldGutter, foldKeymap, indentOnInput,
    codeFolding,
  } from '@codemirror/language';
  import { tags as t } from '@lezer/highlight';
  import {
    history, historyKeymap, defaultKeymap,
    insertTab, toggleComment, toggleBlockComment,
    moveLineUp, moveLineDown, copyLineDown,
    deleteLine, selectLine, indentMore, indentLess,
    selectParentSyntax, cursorMatchingBracket,
  } from '@codemirror/commands';
  import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';
  import { lintKeymap } from '@codemirror/lint';

  export let content: string = '';
  export let onChange: ((value: string) => void) | undefined = undefined;
  export let onBlur: (() => void) | undefined = undefined;
  export let initialCursorPos: number = 0;
  export let initialScrollTop: number = 0;

  export function getState(): { cursorPos: number; scrollTop: number } {
    if (!view) return { cursorPos: 0, scrollTop: 0 };
    return {
      cursorPos: view.state.selection.main.head,
      scrollTop: view.scrollDOM.scrollTop,
    };
  }

  type EditorLanguage =
    | 'ts'
    | 'tsx'
    | 'js'
    | 'jsx'
    | 'vue'
    | 'svelte'
    | 'sql'
    | 'json'
    | 'html'
    | 'css'
    | 'markdown'
    | 'xml'
    | 'yaml'
    | 'python'
    | 'rust'
    | 'java'
    | 'cpp'
    | 'php'
    | 'text';

  export let language: EditorLanguage = 'ts';
  export let readonly: boolean = true;

  let container: HTMLDivElement;
  let view: EditorView;

  // ── Highlight style ────────────────────────────────────────────────────────

  const cairnHighlight = HighlightStyle.define([
    { tag: t.keyword,                              color: 'oklch(0.72 0.19 295)', fontStyle: 'italic' },
    { tag: t.controlKeyword,                       color: 'oklch(0.72 0.19 295)', fontStyle: 'italic' },
    { tag: t.definitionKeyword,                    color: 'oklch(0.72 0.19 295)', fontStyle: 'italic' },
    { tag: t.moduleKeyword,                        color: 'oklch(0.72 0.19 295)', fontStyle: 'italic' },
    { tag: t.operatorKeyword,                      color: 'oklch(0.72 0.19 295)', fontStyle: 'italic' },
    { tag: t.function(t.variableName),             color: 'oklch(0.84 0.16 55)'  },
    { tag: t.function(t.definition(t.variableName)), color: 'oklch(0.84 0.16 55)' },
    { tag: t.definition(t.variableName),           color: 'oklch(0.88 0.005 80)' },
    { tag: t.variableName,                         color: 'oklch(0.88 0.005 80)' },
    { tag: t.typeName,                             color: 'oklch(0.78 0.13 200)' },
    { tag: t.className,                            color: 'oklch(0.78 0.13 200)' },
    { tag: t.definition(t.typeName),               color: 'oklch(0.78 0.13 200)' },
    { tag: t.propertyName,                         color: 'oklch(0.80 0.11 225)' },
    { tag: t.definition(t.propertyName),           color: 'oklch(0.80 0.11 225)' },
    { tag: t.string,                               color: 'oklch(0.78 0.14 135)' },
    { tag: t.special(t.string),                    color: 'oklch(0.78 0.14 135)' },
    { tag: t.regexp,                               color: 'oklch(0.76 0.14 50)'  },
    { tag: t.number,                               color: 'oklch(0.82 0.14 60)'  },
    { tag: t.bool,                                 color: 'oklch(0.72 0.19 295)', fontStyle: 'italic' },
    { tag: t.null,                                 color: 'oklch(0.72 0.19 295)', fontStyle: 'italic' },
    { tag: t.atom,                                 color: 'oklch(0.72 0.19 295)' },
    { tag: t.comment,                              color: 'oklch(0.50 0.010 80)', fontStyle: 'italic' },
    { tag: t.lineComment,                          color: 'oklch(0.50 0.010 80)', fontStyle: 'italic' },
    { tag: t.blockComment,                         color: 'oklch(0.50 0.010 80)', fontStyle: 'italic' },
    { tag: t.operator,                             color: 'oklch(0.80 0.06 250)' },
    { tag: t.punctuation,                          color: 'oklch(0.65 0.006 80)' },
    { tag: t.bracket,                              color: 'oklch(0.72 0.08 80)'  },
    { tag: t.tagName,                              color: 'oklch(0.72 0.18 15)'  },
    { tag: t.attributeName,                        color: 'oklch(0.78 0.13 200)' },
    { tag: t.attributeValue,                       color: 'oklch(0.78 0.14 135)' },
    { tag: t.namespace,                            color: 'oklch(0.78 0.13 200)' },
    { tag: t.meta,                                 color: 'oklch(0.56 0.010 80)' },
    { tag: t.modifier,                             color: 'oklch(0.72 0.19 295)', fontStyle: 'italic' },
    { tag: t.self,                                 color: 'oklch(0.72 0.19 295)', fontStyle: 'italic' },
    { tag: t.special(t.variableName),              color: 'oklch(0.84 0.16 55)'  },
    { tag: t.inserted,                             color: 'oklch(0.78 0.14 135)' },
    { tag: t.deleted,                              color: 'oklch(0.70 0.18 15)'  },
    { tag: t.changed,                              color: 'oklch(0.82 0.14 60)'  },
    { tag: t.invalid,                              color: 'oklch(0.70 0.18 15)', textDecoration: 'underline wavy' },
  ]);

  // ── Theme ──────────────────────────────────────────────────────────────────

  const cairnTheme = EditorView.theme({
    '&': {
      backgroundColor: 'oklch(0.16 0.008 70)',
      color: 'oklch(0.88 0.005 80)',
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
      color: 'oklch(0.42 0.006 80)',
    },
    '.cm-gutter': { minWidth: '44px' },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 12px 0 8px', fontSize: '11.5px' },
    '.cm-activeLineGutter': { backgroundColor: 'oklch(0.215 0.008 70)' },
    '.cm-activeLine': { backgroundColor: 'oklch(0.215 0.008 70)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
      backgroundColor: 'oklch(0.72 0.14 250 / 0.22) !important',
    },
    '.cm-cursor': { borderLeftColor: 'oklch(0.72 0.14 250)' },

    // Matching brackets
    '.cm-matchingBracket': {
      backgroundColor: 'oklch(0.72 0.14 250 / 0.18)',
      outline: '1px solid oklch(0.72 0.14 250 / 0.4)',
      borderRadius: '2px',
    },
    '.cm-nonmatchingBracket': {
      backgroundColor: 'oklch(0.70 0.18 15 / 0.25)',
      outline: '1px solid oklch(0.70 0.18 15 / 0.5)',
    },

    // Selection highlight
    '.cm-selectionMatch': {
      backgroundColor: 'oklch(0.72 0.14 250 / 0.12)',
      outline: '1px solid oklch(0.72 0.14 250 / 0.25)',
      borderRadius: '2px',
    },

    // Search panel
    '.cm-searchMatch': { backgroundColor: 'oklch(0.82 0.14 60 / 0.28)', borderRadius: '2px' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'oklch(0.82 0.14 60 / 0.55)' },
    '.cm-search': {
      backgroundColor: 'oklch(0.19 0.008 70)',
      borderTop: '1px solid oklch(0.30 0.008 70)',
      padding: '6px 12px',
      display: 'flex',
      flexWrap: 'wrap',
      gap: '6px',
      alignItems: 'center',
      fontSize: '12.5px',
      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    },
    '.cm-search input': {
      backgroundColor: 'oklch(0.22 0.008 70)',
      border: '1px solid oklch(0.34 0.008 70)',
      borderRadius: '4px',
      color: 'oklch(0.88 0.005 80)',
      padding: '3px 8px',
      fontSize: '12.5px',
      outline: 'none',
    },
    '.cm-search input:focus': { borderColor: 'oklch(0.72 0.14 250 / 0.7)' },
    '.cm-search button': {
      backgroundColor: 'oklch(0.26 0.008 70)',
      border: '1px solid oklch(0.34 0.008 70)',
      borderRadius: '4px',
      color: 'oklch(0.78 0.005 80)',
      padding: '3px 10px',
      cursor: 'pointer',
      fontSize: '12px',
    },
    '.cm-search button:hover': { backgroundColor: 'oklch(0.30 0.008 70)' },
    '.cm-search label': { color: 'oklch(0.60 0.006 80)', fontSize: '12px' },

    // Code folding
    '.cm-foldGutter': { minWidth: '16px' },
    '.cm-foldGutter .cm-gutterElement': { padding: '0 2px', cursor: 'pointer', userSelect: 'none' },
    '.cm-foldGutter .cm-gutterElement:hover': { color: 'oklch(0.78 0.14 250)' },
    '.cm-foldPlaceholder': {
      backgroundColor: 'oklch(0.26 0.008 70)',
      border: '1px solid oklch(0.34 0.008 70)',
      borderRadius: '3px',
      color: 'oklch(0.60 0.006 80)',
      padding: '0 6px',
      margin: '0 4px',
      fontSize: '11px',
      cursor: 'pointer',
    },

    // Lint gutter & diagnostics
    '.cm-lintRange-error':   { textDecoration: 'underline wavy oklch(0.70 0.18 15)' },
    '.cm-lintRange-warning': { textDecoration: 'underline wavy oklch(0.82 0.14 60)' },
    '.cm-lintRange-info':    { textDecoration: 'underline wavy oklch(0.72 0.14 250)' },
    '.cm-lintGutter': { minWidth: '16px' },
    '.cm-lintPoint-error::after':   { color: 'oklch(0.70 0.18 15)' },
    '.cm-lintPoint-warning::after': { color: 'oklch(0.82 0.14 60)' },
    '.cm-lint-marker': { fontSize: '11px' },
    '.cm-lint-marker-error':   { content: '"●"', color: 'oklch(0.70 0.18 15)' },
    '.cm-lint-marker-warning': { content: '"●"', color: 'oklch(0.82 0.14 60)' },
    '.cm-tooltip.cm-tooltip-lint': {
      backgroundColor: 'oklch(0.20 0.008 70)',
      border: '1px solid oklch(0.32 0.008 70)',
      borderRadius: '6px',
      padding: '6px 10px',
      fontSize: '12.5px',
      color: 'oklch(0.88 0.005 80)',
      maxWidth: '400px',
    },

    // Autocomplete tooltip
    '.cm-tooltip': {
      backgroundColor: 'oklch(0.20 0.008 70)',
      border: '1px solid oklch(0.32 0.008 70)',
      borderRadius: '6px',
      color: 'oklch(0.88 0.005 80)',
      boxShadow: '0 4px 20px oklch(0 0 0 / 0.55)',
      fontSize: '12.5px',
    },
    '.cm-tooltip-autocomplete': { borderRadius: '6px' },
    '.cm-tooltip-autocomplete ul': { maxHeight: '260px' },
    '.cm-tooltip-autocomplete ul li': { padding: '4px 12px', lineHeight: '1.5' },
    '.cm-tooltip-autocomplete ul li[aria-selected]': {
      backgroundColor: 'oklch(0.72 0.14 250 / 0.22)',
      color: 'oklch(0.96 0.005 80)',
    },
    '.cm-completionIcon': { paddingRight: '6px', opacity: '0.7' },
    '.cm-completionLabel': { flex: '1' },
    '.cm-completionDetail': {
      color: 'oklch(0.54 0.006 80)',
      fontSize: '11.5px',
      fontStyle: 'italic',
      marginLeft: '8px',
    },

    // Hover tooltip
    '.cm-tooltip.cairn-hover': { padding: '0', maxWidth: '500px', borderRadius: '8px', overflow: 'hidden' },
    '.cairn-hover-body': {
      padding: '8px 12px',
      fontSize: '12.5px',
      lineHeight: '1.6',
      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    },
    '.cairn-hover-type':  { color: 'oklch(0.80 0.11 225)', fontStyle: 'italic' },
    '.cairn-hover-name':  { color: 'oklch(0.84 0.16 55)', fontWeight: '600' },
    '.cairn-hover-kind': {
      display: 'inline-block',
      padding: '1px 6px',
      borderRadius: '4px',
      fontSize: '10.5px',
      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      fontStyle: 'normal',
      fontWeight: '500',
      letterSpacing: '0.03em',
      textTransform: 'uppercase',
      marginRight: '6px',
    },
    '.cairn-hover-kind-function': { backgroundColor: 'oklch(0.84 0.16 55 / 0.15)',  color: 'oklch(0.84 0.16 55)'  },
    '.cairn-hover-kind-variable': { backgroundColor: 'oklch(0.80 0.11 225 / 0.15)', color: 'oklch(0.80 0.11 225)' },
    '.cairn-hover-kind-type':     { backgroundColor: 'oklch(0.78 0.13 200 / 0.15)', color: 'oklch(0.78 0.13 200)' },
    '.cairn-hover-kind-keyword':  { backgroundColor: 'oklch(0.72 0.19 295 / 0.15)', color: 'oklch(0.72 0.19 295)' },
    '.cairn-hover-kind-string':   { backgroundColor: 'oklch(0.78 0.14 135 / 0.15)', color: 'oklch(0.78 0.14 135)' },
    '.cairn-hover-kind-number':   { backgroundColor: 'oklch(0.82 0.14 60  / 0.15)', color: 'oklch(0.82 0.14 60)'  },
    '.cairn-hover-divider': { height: '1px', backgroundColor: 'oklch(0.28 0.008 70)', margin: '6px 0' },
    '.cairn-hover-doc': {
      color: 'oklch(0.64 0.006 80)',
      fontSize: '12px',
      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      fontStyle: 'normal',
      marginTop: '4px',
    },
  }, { dark: true });

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

  function resolveLanguageExtension(lang: EditorLanguage): Extension {
    switch (lang) {
      case 'tsx': return javascript({ typescript: true, jsx: true });
      case 'jsx': return javascript({ typescript: false, jsx: true });
      case 'vue': return vue();
      case 'svelte': return svelte();
      case 'sql': return sql();
      case 'json': return json();
      case 'html': return html();
      case 'css': return css();
      case 'markdown': return markdown({ codeLanguages: languages });
      case 'xml': return xml();
      case 'yaml': return yaml();
      case 'python': return python();
      case 'rust': return rust();
      case 'java': return java();
      case 'cpp': return cpp();
      case 'php': return php();
      case 'text': return [];
      default: return javascript({ typescript: lang === 'ts', jsx: false });
    }
  }

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
      // Highest-priority keymap: Tab/Enter accept completion, indentWithTab, comments, line ops
      Prec.highest(keymap.of([
        { key: 'Tab',            run: (v) => acceptCompletion(v) || insertTab(v) },
        { key: 'Enter',          run: acceptCompletion },
        ...closeBracketsKeymap,
        ...completionKeymap,
        { key: 'Mod-/', run: toggleComment },
        { key: 'Shift-Alt-a', run: toggleBlockComment },
        { key: 'Alt-ArrowUp',    run: moveLineUp },
        { key: 'Alt-ArrowDown',  run: moveLineDown },
        { key: 'Shift-Alt-ArrowDown', run: copyLineDown },
        { key: 'Mod-Shift-k',    run: deleteLine },
        { key: 'Mod-l',          run: selectLine },
        { key: 'Ctrl-m',         run: cursorMatchingBracket },
        { key: 'Mod-]',          run: indentMore },
        { key: 'Mod-[',          run: indentLess },
        { key: 'Alt-Shift-ArrowRight', run: selectParentSyntax },
        ...foldKeymap,
        ...lintKeymap,
        ...searchKeymap,
      ])),

      lang,
      lineNumbers(),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      closeBrackets(),
      bracketMatching(),
      indentOnInput(),
      rectangularSelection(),
      crosshairCursor(),
      syntaxHighlighting(cairnHighlight),
      foldGutter({ markerDOM: (open) => {
        const el = document.createElement('span');
        el.textContent = open ? '▾' : '▸';
        el.style.fontSize = '10px';
        el.style.lineHeight = '1.65';
        return el;
      }}),
      codeFolding(),
      search({ top: false }),
      highlightSelectionMatches({ minSelectionLength: 2, wholeWords: false }),
      autocompletion({ activateOnTyping: true, closeOnBlur: false, maxRenderedOptions: 12 }),
      ...snippets,
      ...scopeCompletion,
      buildHoverTooltip(),
      cairnTheme,
      EditorView.lineWrapping,
      EditorState.readOnly.of(readonly),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChange?.(update.state.doc.toString());
      }),
      EditorView.domEventHandlers({
        blur: () => { onBlur?.(); return false; },
      }),
    ];
  }

  onMount(() => {
    view = new EditorView({
      state: EditorState.create({ doc: content, extensions: buildExtensions() }),
      parent: container,
    });

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

  onDestroy(() => { view?.destroy(); });
</script>

<div bind:this={container} class="editor-mount"></div>

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
    scrollbar-color: oklch(0.32 0.008 70) transparent;
  }
</style>
