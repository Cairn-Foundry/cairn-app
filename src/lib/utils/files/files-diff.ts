import { gitFileDiff, gitStagedFileDiff, gitBlame, type DiffHunk, type BlameEntry } from '$lib/services/file-service';

export interface PaneDiffState {
  currentDiffHunks: DiffHunk[];
  currentStagedHunks: DiffHunk[];
  currentBlame: Map<number, BlameEntry>;
}

export function emptyDiffState(): PaneDiffState {
  return { currentDiffHunks: [], currentStagedHunks: [], currentBlame: new Map() };
}

export function hunkToSplit(hunk: DiffHunk): { old: string; new: string } {
  const oldLines = hunk.lines.filter(l => l.type === '-' || l.type === ' ').map(l => l.content);
  const newLines = hunk.lines.filter(l => l.type === '+' || l.type === ' ').map(l => l.content);
  return { old: oldLines.join('\n'), new: newLines.join('\n') };
}

export function untrackedDiffHunk(content: string): DiffHunk {
  const lines = content.split('\n');
  return { oldStart: 0, newStart: 1, newEnd: lines.length, lines: lines.map(l => ({ type: '+' as const, content: l })) };
}

export async function loadPaneDiff(
  worktreePath: string,
  path: string,
  status: string | undefined,
  currentPending: string,
): Promise<PaneDiffState> {
  if (status === 'deleted') return emptyDiffState();

  if (status === 'untracked') {
    return {
      currentDiffHunks: [untrackedDiffHunk(currentPending)],
      currentStagedHunks: [],
      currentBlame: new Map(),
    };
  }

  const blamePromise = gitBlame(worktreePath, path).catch((err) => {
    console.warn('gitBlame failed:', err);
    return new Map<number, BlameEntry>();
  });

  if (status) {
    const [unstaged, staged, blame] = await Promise.all([
      gitFileDiff(worktreePath, path),
      gitStagedFileDiff(worktreePath, path),
      blamePromise,
    ]);
    return { currentDiffHunks: unstaged.hunks, currentStagedHunks: staged.hunks, currentBlame: blame };
  }
  return { currentDiffHunks: [], currentStagedHunks: [], currentBlame: await blamePromise };
}

export function buildRevertedContent(pending: string, hunk: DiffHunk): string {
  const lines = pending.split('\n');
  const originalLines = hunk.lines.filter(l => l.type === '-' || l.type === ' ').map(l => l.content);
  const isDeleteOnly = !hunk.lines.some(l => l.type === '+');
  const afterIdx = isDeleteOnly ? Math.max(0, hunk.newStart - 1) : hunk.newEnd;
  return [
    ...lines.slice(0, hunk.newStart - 1),
    ...originalLines,
    ...lines.slice(afterIdx),
  ].join('\n');
}
