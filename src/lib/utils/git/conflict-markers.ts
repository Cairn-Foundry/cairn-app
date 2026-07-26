/**
 * True when `text` still contains git conflict markers (an unresolved
 * `<<<<<<<` / `>>>>>>>` pair). Mirrors the marker detection used by the
 * editor conflict extension so callers agree on what "resolved" means.
 */
export function hasConflictMarkers(text: string): boolean {
	return /^<<<<<<</m.test(text) && /^>>>>>>>/m.test(text);
}
