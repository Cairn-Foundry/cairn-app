import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { javascript } from '@codemirror/lang-javascript';
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
import type { Extension } from '@codemirror/state';

export type EditorLanguage =
  | 'ts' | 'tsx' | 'js' | 'jsx' | 'vue' | 'svelte' | 'sql' | 'json'
  | 'html' | 'css' | 'markdown' | 'xml' | 'yaml' | 'python' | 'rust'
  | 'java' | 'cpp' | 'php' | 'text';

export function resolveLanguageExtension(lang: EditorLanguage): Extension {
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

export function buildHighlight(theme: string): HighlightStyle {
  const dark = theme !== 'light';
  const kw   = dark ? 'oklch(0.72 0.19 295)' : 'oklch(0.42 0.18 295)';
  const fn_  = dark ? 'oklch(0.84 0.16 55)'  : 'oklch(0.50 0.16 55)';
  const def  = dark ? 'oklch(0.88 0.005 80)'  : 'oklch(0.18 0.005 70)';
  const ty   = dark ? 'oklch(0.78 0.13 200)'  : 'oklch(0.38 0.13 200)';
  const prop = dark ? 'oklch(0.80 0.11 225)'  : 'oklch(0.38 0.11 225)';
  const str  = dark ? 'oklch(0.78 0.14 135)'  : 'oklch(0.38 0.14 135)';
  const re   = dark ? 'oklch(0.76 0.14 50)'   : 'oklch(0.44 0.14 50)';
  const num  = dark ? 'oklch(0.82 0.14 60)'   : 'oklch(0.44 0.14 60)';
  const cmt  = dark ? 'oklch(0.50 0.010 80)'  : 'oklch(0.62 0.010 80)';
  const op   = dark ? 'oklch(0.80 0.06 250)'  : 'oklch(0.42 0.08 250)';
  const punc = dark ? 'oklch(0.65 0.006 80)'  : 'oklch(0.46 0.006 70)';
  const br   = dark ? 'oklch(0.72 0.08 80)'   : 'oklch(0.42 0.06 70)';
  const tag  = dark ? 'oklch(0.72 0.18 15)'   : 'oklch(0.44 0.18 15)';
  const meta = dark ? 'oklch(0.56 0.010 80)'  : 'oklch(0.52 0.010 80)';
  const err  = dark ? 'oklch(0.70 0.18 15)'   : 'oklch(0.48 0.18 15)';
  return HighlightStyle.define([
    { tag: t.keyword,                              color: kw,   fontStyle: 'italic' },
    { tag: t.controlKeyword,                       color: kw,   fontStyle: 'italic' },
    { tag: t.definitionKeyword,                    color: kw,   fontStyle: 'italic' },
    { tag: t.moduleKeyword,                        color: kw,   fontStyle: 'italic' },
    { tag: t.operatorKeyword,                      color: kw,   fontStyle: 'italic' },
    { tag: t.function(t.variableName),             color: fn_  },
    { tag: t.function(t.definition(t.variableName)), color: fn_ },
    { tag: t.definition(t.variableName),           color: def  },
    { tag: t.variableName,                         color: def  },
    { tag: t.typeName,                             color: ty   },
    { tag: t.className,                            color: ty   },
    { tag: t.definition(t.typeName),               color: ty   },
    { tag: t.propertyName,                         color: prop },
    { tag: t.definition(t.propertyName),           color: prop },
    { tag: t.string,                               color: str  },
    { tag: t.special(t.string),                    color: str  },
    { tag: t.regexp,                               color: re   },
    { tag: t.number,                               color: num  },
    { tag: t.bool,                                 color: kw,   fontStyle: 'italic' },
    { tag: t.null,                                 color: kw,   fontStyle: 'italic' },
    { tag: t.atom,                                 color: kw   },
    { tag: t.comment,                              color: cmt,  fontStyle: 'italic' },
    { tag: t.lineComment,                          color: cmt,  fontStyle: 'italic' },
    { tag: t.blockComment,                         color: cmt,  fontStyle: 'italic' },
    { tag: t.operator,                             color: op   },
    { tag: t.punctuation,                          color: punc },
    { tag: t.bracket,                              color: br   },
    { tag: t.tagName,                              color: tag  },
    { tag: t.attributeName,                        color: ty   },
    { tag: t.attributeValue,                       color: str  },
    { tag: t.namespace,                            color: ty   },
    { tag: t.meta,                                 color: meta },
    { tag: t.modifier,                             color: kw,   fontStyle: 'italic' },
    { tag: t.self,                                 color: kw,   fontStyle: 'italic' },
    { tag: t.special(t.variableName),              color: fn_  },
    { tag: t.inserted,                             color: str  },
    { tag: t.deleted,                              color: err  },
    { tag: t.changed,                              color: num  },
    { tag: t.invalid,                              color: err, textDecoration: 'underline wavy' },
  ]);
}

export function buildEditorTheme(theme: string): Extension {
  if (theme === 'light') return buildLightTheme();
  if (theme === 'high-contrast') return buildHighContrastTheme();
  return buildDarkTheme();
}

export function buildSyntaxHighlighting(theme: string): Extension {
  return syntaxHighlighting(buildHighlight(theme));
}

export function buildDiffGutterTheme(): Extension {
  return EditorView.theme({
    '.cm-diff-gutter': { width: '8px', minWidth: '8px' },
    '.cm-diff-gutter .cm-gutterElement': { padding: '0', width: '8px', cursor: 'pointer' },
    '.cm-diff-marker': { width: '8px', height: '100%', cursor: 'pointer' },
  });
}

function buildDarkTheme(): Extension {
  return EditorView.theme({
    '&': { backgroundColor: 'oklch(0.16 0.008 70)', color: 'oklch(0.88 0.005 80)', height: '100%', fontFamily: 'var(--font-mono)' },
    '.cm-content': { padding: '12px 0', caretColor: 'oklch(0.72 0.14 250)' },
    '.cm-focused': { outline: 'none' },
    '.cm-line': { padding: '0 16px 0 0', lineHeight: '1.65' },
    '.cm-gutters': { backgroundColor: 'oklch(0.16 0.008 70)', borderRight: '1px solid oklch(0.26 0.008 70)', color: 'oklch(0.42 0.006 80)' },
    '.cm-gutter': { minWidth: '12px' },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 12px 0 8px', fontSize: '11.5px' },
    '.cm-activeLineGutter': { backgroundColor: 'oklch(0.215 0.008 70)' },
    '.cm-activeLine': { backgroundColor: 'oklch(0.215 0.008 70)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'oklch(0.72 0.14 250 / 0.22) !important' },
    '.cm-cursor': { borderLeftColor: 'oklch(0.72 0.14 250)' },
    '.cm-matchingBracket': { backgroundColor: 'oklch(0.72 0.14 250 / 0.18)', outline: '1px solid oklch(0.72 0.14 250 / 0.4)', borderRadius: '2px' },
    '.cm-nonmatchingBracket': { backgroundColor: 'oklch(0.70 0.18 15 / 0.25)', outline: '1px solid oklch(0.70 0.18 15 / 0.5)' },
    '.cm-selectionMatch': { backgroundColor: 'oklch(0.72 0.14 250 / 0.12)', outline: '1px solid oklch(0.72 0.14 250 / 0.25)', borderRadius: '2px' },
    '.cm-searchMatch': { backgroundColor: 'oklch(0.82 0.14 60 / 0.28)', borderRadius: '2px' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'oklch(0.82 0.14 60 / 0.55)' },
    '.cm-panels-top': { borderBottom: '1px solid oklch(0.26 0.008 70)' },
    '.cm-foldGutter': { minWidth: '16px' },
    '.cm-foldGutter .cm-gutterElement': { padding: '0 2px', cursor: 'pointer', userSelect: 'none' },
    '.cm-foldGutter .cm-gutterElement:hover': { color: 'oklch(0.78 0.14 250)' },
    '.cm-foldPlaceholder': { backgroundColor: 'oklch(0.26 0.008 70)', border: '1px solid oklch(0.34 0.008 70)', borderRadius: '3px', color: 'oklch(0.60 0.006 80)', padding: '0 6px', margin: '0 4px', fontSize: '11px', cursor: 'pointer' },
    '.cm-tooltip': { backgroundColor: 'oklch(0.20 0.008 70)', border: '1px solid oklch(0.32 0.008 70)', borderRadius: '6px', color: 'oklch(0.88 0.005 80)', boxShadow: '0 4px 20px oklch(0 0 0 / 0.55)', fontSize: '12.5px' },
    '.cm-diff-added': { backgroundColor: 'oklch(0.78 0.14 135)' },
    '.cm-diff-modified': { backgroundColor: 'oklch(0.82 0.14 60)' },
    '.cm-diff-staged': { backgroundColor: 'oklch(0.72 0.14 250)' },
    '.cm-diff-deleted': { backgroundColor: 'oklch(0.72 0.20 25)', height: '3px', alignSelf: 'flex-end' },
    '.cm-highlightSpace, .cm-highlightTab': { color: 'oklch(0.36 0.006 80)' },
  }, { dark: true });
}

function buildLightTheme(): Extension {
  return EditorView.theme({
    '&': { backgroundColor: 'oklch(0.97 0.006 80)', color: 'oklch(0.18 0.008 70)', height: '100%', fontFamily: 'var(--font-mono)' },
    '.cm-content': { padding: '12px 0', caretColor: 'oklch(0.42 0.18 250)' },
    '.cm-focused': { outline: 'none' },
    '.cm-line': { padding: '0 16px 0 0', lineHeight: '1.65' },
    '.cm-gutters': { backgroundColor: 'oklch(0.94 0.007 75)', borderRight: '1px solid oklch(0.87 0.007 70)', color: 'oklch(0.58 0.008 70)' },
    '.cm-gutter': { minWidth: '44px' },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 12px 0 8px', fontSize: '11.5px' },
    '.cm-activeLineGutter': { backgroundColor: 'oklch(0.91 0.008 70)' },
    '.cm-activeLine': { backgroundColor: 'oklch(0.91 0.008 70)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'oklch(0.42 0.14 250 / 0.20) !important' },
    '.cm-cursor': { borderLeftColor: 'oklch(0.42 0.18 250)' },
    '.cm-matchingBracket': { backgroundColor: 'oklch(0.42 0.14 250 / 0.15)', outline: '1px solid oklch(0.42 0.14 250 / 0.35)', borderRadius: '2px' },
    '.cm-nonmatchingBracket': { backgroundColor: 'oklch(0.48 0.18 15 / 0.2)', outline: '1px solid oklch(0.48 0.18 15 / 0.4)' },
    '.cm-selectionMatch': { backgroundColor: 'oklch(0.42 0.14 250 / 0.10)', outline: '1px solid oklch(0.42 0.14 250 / 0.22)', borderRadius: '2px' },
    '.cm-searchMatch': { backgroundColor: 'oklch(0.60 0.14 60 / 0.28)', borderRadius: '2px' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'oklch(0.60 0.14 60 / 0.55)' },
    '.cm-foldGutter': { minWidth: '16px' },
    '.cm-foldGutter .cm-gutterElement': { padding: '0 2px', cursor: 'pointer', userSelect: 'none' },
    '.cm-foldGutter .cm-gutterElement:hover': { color: 'oklch(0.42 0.14 250)' },
    '.cm-foldPlaceholder': { backgroundColor: 'oklch(0.91 0.008 70)', border: '1px solid oklch(0.80 0.008 70)', borderRadius: '3px', color: 'oklch(0.52 0.006 80)', padding: '0 6px', margin: '0 4px', fontSize: '11px', cursor: 'pointer' },
    '.cm-tooltip': { backgroundColor: 'oklch(0.97 0.006 80)', border: '1px solid oklch(0.80 0.008 70)', borderRadius: '6px', color: 'oklch(0.18 0.008 70)', boxShadow: '0 4px 20px oklch(0 0 0 / 0.15)', fontSize: '12.5px' },
    '.cm-diff-added': { backgroundColor: 'oklch(0.55 0.18 135)' },
    '.cm-diff-modified': { backgroundColor: 'oklch(0.60 0.18 60)' },
    '.cm-diff-staged': { backgroundColor: 'oklch(0.50 0.18 250)' },
    '.cm-diff-deleted': { backgroundColor: 'oklch(0.55 0.22 25)', height: '3px', alignSelf: 'flex-end' },
    '.cm-highlightSpace, .cm-highlightTab': { color: 'oklch(0.68 0.008 70)' },
  }, { dark: false });
}

function buildHighContrastTheme(): Extension {
  return EditorView.theme({
    '&': { backgroundColor: 'oklch(0.0 0 0)', color: 'oklch(1.0 0 0)', height: '100%', fontFamily: 'var(--font-mono)' },
    '.cm-content': { padding: '12px 0', caretColor: 'oklch(0.72 0.14 250)' },
    '.cm-focused': { outline: 'none' },
    '.cm-line': { padding: '0 16px 0 0', lineHeight: '1.65' },
    '.cm-gutters': { backgroundColor: 'oklch(0.08 0 0)', borderRight: '1px solid oklch(0.32 0 0)', color: 'oklch(0.55 0 0)' },
    '.cm-gutter': { minWidth: '44px' },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 12px 0 8px', fontSize: '11.5px' },
    '.cm-activeLineGutter': { backgroundColor: 'oklch(0.12 0 0)' },
    '.cm-activeLine': { backgroundColor: 'oklch(0.12 0 0)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'oklch(0.72 0.14 250 / 0.35) !important' },
    '.cm-cursor': { borderLeftColor: 'oklch(0.72 0.14 250)', borderLeftWidth: '2px' },
    '.cm-matchingBracket': { backgroundColor: 'oklch(0.72 0.14 250 / 0.25)', outline: '1px solid oklch(0.72 0.14 250 / 0.6)', borderRadius: '2px' },
    '.cm-tooltip': { backgroundColor: 'oklch(0.08 0 0)', border: '1px solid oklch(0.48 0 0)', borderRadius: '6px', color: 'oklch(1.0 0 0)', boxShadow: '0 4px 20px oklch(0 0 0 / 0.8)', fontSize: '12.5px' },
    '.cm-diff-added': { backgroundColor: 'oklch(0.78 0.14 135)' },
    '.cm-diff-modified': { backgroundColor: 'oklch(0.82 0.14 60)' },
    '.cm-diff-deleted': { backgroundColor: 'oklch(0.72 0.20 25)', height: '3px', alignSelf: 'flex-end' },
  }, { dark: true });
}
