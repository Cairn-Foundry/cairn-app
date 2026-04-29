export function normalizeLineEndings(text: string, le: 'CRLF' | 'LF'): string {
  return le === 'CRLF' ? text.replace(/\r\n/g, '\n') : text;
}

export function denormalizeLineEndings(text: string, le: 'CRLF' | 'LF'): string {
  return le === 'CRLF' ? text.replace(/\n/g, '\r\n') : text;
}

export function detectLineEndings(text: string): 'CRLF' | 'LF' {
  return text.includes('\r\n') ? 'CRLF' : 'LF';
}

export function detectIndentStyle(text: string): 'tabs' | 'spaces' | null {
  let tabs = 0, spaces = 0;
  const lines = text.split('\n');
  const limit = Math.min(lines.length, 100);
  for (let i = 0; i < limit; i++) {
    const line = lines[i];
    if (line.startsWith('\t')) tabs++;
    else if (/^  +\S/.test(line)) spaces++;
  }
  if (tabs === 0 && spaces === 0) return null;
  return tabs >= spaces ? 'tabs' : 'spaces';
}

export function detectSpaceSize(text: string): number {
  const counts: Record<number, number> = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^( +)\S/);
    if (m) { const n = m[1].length; counts[n] = (counts[n] ?? 0) + 1; }
  }
  const sorted = Object.keys(counts).map(Number).sort((a, b) => a - b);
  if (!sorted.length) return 2;
  return sorted.find(n => n <= 4) ?? sorted[0];
}

export function convertToSpaces(text: string, size: number): string {
  return text.split('\n').map(line => {
    let i = 0;
    while (line[i] === '\t') i++;
    return ' '.repeat(i * size) + line.slice(i);
  }).join('\n');
}

export function convertToTabs(text: string, size: number): string {
  const sp = ' '.repeat(size);
  return text.split('\n').map(line => {
    let i = 0;
    while (line.slice(i, i + size) === sp) i += size;
    return '\t'.repeat(i / size) + line.slice(i);
  }).join('\n');
}
