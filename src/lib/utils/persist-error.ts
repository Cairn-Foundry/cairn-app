/**
 * Persistence to `~/.cairn` runs in the background: no caller awaits it and no
 * view shows its outcome, so a rejected write used to vanish into an empty
 * `catch`. A conversation, a setting or an editor state could then fail to
 * reach the disk with nothing anywhere saying so.
 *
 * The failure stays non-fatal - retrying a debounced write would fight the next
 * one - but it is reported, so a broken save is visible in the console instead
 * of being silently lost.
 */
export function reportPersistError(what: string, error: unknown): void {
	console.error(`[cairn] failed to save ${what}:`, error);
}

/** Attaches the reporter to a fire-and-forget save. */
export function persist(what: string, write: Promise<unknown>): void {
	void write.catch((e) => reportPersistError(what, e));
}
