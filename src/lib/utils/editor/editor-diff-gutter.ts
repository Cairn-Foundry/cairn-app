import { GutterMarker, gutter } from '@codemirror/view';
import { StateEffect, StateField, type Extension } from '@codemirror/state';
import type { DiffHunk, DiffHunkLine } from '$lib/services/file-service';

export type { DiffHunk, DiffHunkLine };
export type DiffKind = 'added' | 'modified' | 'deleted';

export const setUnstagedDiff = StateEffect.define<Map<number, DiffKind>>();
export const setStagedDiff = StateEffect.define<Map<number, DiffKind>>();

export const unstagedDiffField = StateField.define<Map<number, DiffKind>>({
  create: () => new Map(),
  update: (value, tr) => {
    for (const e of tr.effects) if (e.is(setUnstagedDiff)) return e.value;
    return value;
  },
});

export const stagedDiffField = StateField.define<Map<number, DiffKind>>({
  create: () => new Map(),
  update: (value, tr) => {
    for (const e of tr.effects) if (e.is(setStagedDiff)) return e.value;
    return value;
  },
});

export function hunksToLineMap(hunks: DiffHunk[]): Map<number, DiffKind> {
  const map = new Map<number, DiffKind>();
  for (const hunk of hunks) {
    let newLine = hunk.newStart;
    let prevWasDelete = false;
    let inDeletionBlock = false;
    let deletionPoint = 0;
    let deletionHadPlus = false;

    const flushDeletion = () => {
      if (inDeletionBlock && !deletionHadPlus) {
        const marker = Math.max(1, deletionPoint);
        if (!map.has(marker)) map.set(marker, 'deleted');
      }
      inDeletionBlock = false;
      deletionHadPlus = false;
      prevWasDelete = false;
    };

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
  constructor(readonly kind: DiffKind, readonly lineNum: number, readonly staged = false) { super(); }
  toDOM() {
    const el = document.createElement('div');
    el.className = `cm-diff-marker cm-diff-${this.kind}${this.staged ? ' cm-diff-staged' : ''}`;
    return el;
  }
}

export function buildDiffGutter(opts: {
  getHunks: () => DiffHunk[];
  getStagedHunks: () => DiffHunk[];
  onClick?: (hunk: DiffHunk) => void;
}): Extension {
  return [
    unstagedDiffField,
    stagedDiffField,
    gutter({
      class: 'cm-diff-gutter',
      lineMarker(v, line) {
        const num = v.state.doc.lineAt(line.from).number;
        const kind = v.state.field(unstagedDiffField).get(num);
        const stagedKind = v.state.field(stagedDiffField).get(num);
        if (stagedKind) return new DiffMarker(stagedKind, num, true);
        if (kind) return new DiffMarker(kind, num, false);
        return null;
      },
      lineMarkerChange: (update) =>
        update.startState.field(unstagedDiffField) !== update.state.field(unstagedDiffField) ||
        update.startState.field(stagedDiffField) !== update.state.field(stagedDiffField),
      initialSpacer: () => new DiffMarker('added', 0),
      domEventHandlers: {
        mousedown(v, line) {
          const lineNum = v.state.doc.lineAt(line.from).number;
          if (!v.state.field(unstagedDiffField).has(lineNum) && !v.state.field(stagedDiffField).has(lineNum)) return false;
          const allHunks = [...opts.getHunks(), ...opts.getStagedHunks()];
          const hunk = allHunks.find(h => lineNum >= h.newStart && lineNum <= h.newEnd);
          if (hunk) opts.onClick?.(hunk);
          return true;
        },
      },
    }),
  ];
}
