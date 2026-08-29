import { formatClock, formatDate } from "$lib/utils/format";

/**
 * A message or an activity line, seen only through when it happened. Messages
 * written before turns were timestamped carry `time` and nothing else: a clock
 * face like "10:02", which cannot be turned back into a date. Such a line keeps
 * being shown exactly as it was written rather than being given a day it never
 * recorded.
 */
interface TimeStamped {
	ts?: number;
	/** Legacy display time, read for what is already on disk, never written. */
	time?: string;
}

/** The clock face shown next to a turn in the transcript. */
export function messageClock(entry: TimeStamped, locale?: string): string {
	if (entry.ts) return formatClock(entry.ts, locale);
	return entry.time ?? "";
}

/** The full date, for anything read outside the app - an export, a tooltip. */
export function messageDate(entry: TimeStamped): string {
	if (entry.ts) return formatDate(entry.ts);
	return entry.time ?? "";
}
