// Delays and debounce windows shared across the app, gathered so a value is
// tuned in one place rather than guessed again at each call site.

/** How long a "copied" confirmation stays up. */
export const CLIPBOARD_CLEAR_DELAY = 1500;
/** Typing settle time before a search is actually issued. */
export const SEARCH_DEBOUNCE_MS = 280;
/** Lets the editor lay out before scrolling to a position in a fresh tab. */
export const EDITOR_JUMP_DELAY_MS = 60;
/**
 * A `didChange` on every keystroke saturates a language server, so the editor
 * batches them. Long enough to swallow a burst of typing, short enough that
 * diagnostics still feel live.
 */
export const LSP_CHANGE_DEBOUNCE_MS = 300;
/**
 * Cadence of the background git refresh. One tick spawns roughly eight git
 * processes, so it is deliberately slower than a plain status read would need.
 */
export const GIT_REFRESH_INTERVAL_MS = 5000;
/**
 * Cadence used while the git view is closed. Only the workflow badges are fed
 * then, and they do not need second-level freshness, so the recurring cost is
 * halved without the user perceiving it.
 */
export const GIT_REFRESH_IDLE_INTERVAL_MS = 10000;
/**
 * How long a load may take before it is worth showing a placeholder. Below it
 * the content is already there, and a skeleton that appears and vanishes in the
 * same breath reads as a flicker rather than as progress.
 */
export const SKELETON_DELAY_MS = 150;
