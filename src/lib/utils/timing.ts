export const CLIPBOARD_CLEAR_DELAY = 1500;
export const SEARCH_DEBOUNCE_MS = 280;
export const EDITOR_JUMP_DELAY_MS = 60;
/**
 * Cadence of the background git refresh. One tick spawns roughly eight git
 * processes, so it is deliberately slower than a plain status read would need.
 */
export const GIT_REFRESH_INTERVAL_MS = 5000;
