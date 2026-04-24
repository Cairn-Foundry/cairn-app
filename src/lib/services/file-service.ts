import { invoke } from '@tauri-apps/api/core';

export interface FileNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: FileNode[];
}

export async function readDirTree(path: string): Promise<FileNode[]> {
  return invoke<FileNode[]>('read_dir_tree', { path });
}

export async function readFile(path: string): Promise<string | null> {
  return invoke<string | null>('read_file', { path });
}

export async function writeFile(path: string, content: string): Promise<void> {
  return invoke<void>('write_file', { path, content });
}

export async function deletePath(path: string): Promise<void> {
  return invoke<void>('delete_path', { path });
}

export async function renamePath(from: string, to: string): Promise<void> {
  return invoke<void>('rename_path', { from, to });
}

export async function createFileOrDir(path: string, isDir: boolean): Promise<void> {
  return invoke<void>('create_file_or_dir', { path, isDir });
}

export async function copyPath(from: string, to: string): Promise<void> {
  return invoke<void>('copy_path', { from, to });
}

export async function revealInFileManager(path: string): Promise<void> {
  return invoke<void>('reveal_in_file_manager', { path });
}

export async function openInTerminal(path: string): Promise<void> {
  return invoke<void>('open_in_terminal', { path });
}

export type GitStatusMap = Record<string, 'staged' | 'modified' | 'untracked' | 'deleted'>;

export interface SearchMatch {
  path: string;
  line: number;
  col: number;
  text: string;
  matchStart: number;
  matchEnd: number;
}

export interface SearchOptions {
  caseSensitive: boolean;
  isRegex: boolean;
  includeGlob: string;
  excludeGlob: string;
}

export async function searchInFiles(root: string, query: string, opts: SearchOptions): Promise<SearchMatch[]> {
  return invoke<SearchMatch[]>('search_in_files', {
    root,
    query,
    caseSensitive: opts.caseSensitive,
    isRegex: opts.isRegex,
    includeGlob: opts.includeGlob,
    excludeGlob: opts.excludeGlob,
  });
}

export async function gitStatus(worktreePath: string): Promise<GitStatusMap> {
  return invoke<GitStatusMap>('git_status', { worktreePath });
}

const EXT_LANG: Record<string, string> = {
  ts: 'ts', tsx: 'tsx', mts: 'ts',
  js: 'js', jsx: 'jsx', mjs: 'js', cjs: 'js',
  vue: 'vue',
  svelte: 'svelte',
  html: 'html', htm: 'html',
  css: 'css', scss: 'css', less: 'css',
  md: 'markdown', mdx: 'markdown',
  xml: 'xml', svg: 'xml',
  yaml: 'yaml', yml: 'yaml',
  py: 'python',
  rs: 'rust',
  java: 'java',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', h: 'cpp', hpp: 'cpp',
  php: 'php',
  sql: 'sql',
  json: 'json', jsonc: 'json',
  toml: 'text', ini: 'text', env: 'text',
  sh: 'text', bash: 'text', zsh: 'text',
  txt: 'text',
};

const BINARY_EXT = new Set([
  'png','jpg','jpeg','gif','webp','ico','bmp','tiff','svg',
  'pdf','doc','docx','xls','xlsx','ppt','pptx',
  'zip','tar','gz','bz2','xz','7z','rar',
  'mp3','mp4','wav','ogg','flac','avi','mov','mkv',
  'wasm','bin','exe','dll','so','dylib','a','o',
  'ttf','otf','woff','woff2','eot',
  'db','sqlite','sqlite3',
]);

export function langFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return EXT_LANG[ext] ?? 'text';
}

export function isBinaryPath(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return BINARY_EXT.has(ext);
}
