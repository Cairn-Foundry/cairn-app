import type { FileNode } from '$lib/services/file-service';

export function flattenTreeFilePaths(nodes: FileNode[]): string[] {
  const paths: string[] = [];
  for (const n of nodes) {
    if (!n.isDir) paths.push(n.path);
    if (n.children) paths.push(...flattenTreeFilePaths(n.children));
  }
  return paths;
}

export function scorePathMatch(path: string, q: string): number {
  if (!q) return 1;
  const lPath = path.toLowerCase();
  const lQ = q.toLowerCase();
  const filename = lPath.split('/').pop() ?? lPath;

  if (filename.startsWith(lQ)) return 100;
  if (filename.includes(lQ)) return 80;
  if (lPath.includes(lQ)) return 60;

  let pi = 0;
  for (const ch of lQ) {
    pi = lPath.indexOf(ch, pi);
    if (pi === -1) return -1;
    pi++;
  }
  return 30;
}

export function htmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function highlightPathMatch(path: string, q: string): string {
  if (!q) return htmlEscape(path);
  const lPath = path.toLowerCase();
  const lQ = q.toLowerCase();

  const idx = lPath.indexOf(lQ);
  if (idx !== -1) {
    return htmlEscape(path.slice(0, idx)) +
      `<mark>${htmlEscape(path.slice(idx, idx + q.length))}</mark>` +
      htmlEscape(path.slice(idx + q.length));
  }

  let result = '';
  let pi = 0;
  for (let i = 0; i < path.length; i++) {
    if (pi < lQ.length && path[i].toLowerCase() === lQ[pi]) {
      result += `<mark>${htmlEscape(path[i])}</mark>`;
      pi++;
    } else {
      result += htmlEscape(path[i]);
    }
  }
  return result;
}

export function matchesSearch(text: string, query: string): boolean {
  if (!query.trim()) return true;
  return text.toLowerCase().includes(query.toLowerCase());
}
