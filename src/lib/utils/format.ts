/** Convert arbitrary text to a URL/branch-friendly slug. */
export function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}

/** A byte count for display, one decimal above the byte unit. */
export function formatBytes(bytes: number): string {
	const units = ["B", "KB", "MB", "GB"];
	let value = Math.max(0, bytes);
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

/** Date and time in the system locale, for anything read outside a transcript. */
export function formatDate(ts: number): string {
	return new Intl.DateTimeFormat(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(new Date(ts));
}

/** The time of day of a timestamp, as the clock a message is stamped with. */
export function formatClock(ts: number, locale?: string): string {
	return new Intl.DateTimeFormat(locale, {
		hour: "2-digit",
		minute: "2-digit",
	}).format(new Date(ts));
}

/**
 * Groups thousands with a space, so a token count reads at a glance: 1000
 * becomes "1 000". A plain space, not a narrow one, because the codebase stays
 * on plain ASCII.
 */
export function formatCount(value: number): string {
	const rounded = Math.round(value);
	const sign = rounded < 0 ? "-" : "";
	const digits = Math.abs(rounded).toString();
	let grouped = "";
	for (let i = 0; i < digits.length; i++) {
		if (i > 0 && (digits.length - i) % 3 === 0) grouped += " ";
		grouped += digits[i];
	}
	return sign + grouped;
}

/**
 * An amount in dollars, kept readable at both ends of the scale: a single turn
 * costs fractions of a cent and must not round to "$0.00", while a month of
 * work must not drag four decimals behind it.
 */
export function formatUsd(value: number): string {
	const abs = Math.abs(value);
	if (abs === 0) return "$0";
	if (abs < 0.01) return `$${value.toFixed(4)}`;
	if (abs < 100) return `$${value.toFixed(2)}`;
	return `$${formatCount(value)}`;
}

/**
 * A token count at a glance: thousands and millions are abbreviated, because a
 * chart axis reading "12 480 000" says less than "12.5M".
 */
export function formatTokens(value: number): string {
	const abs = Math.abs(value);
	if (abs >= 1_000_000)
		return `${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
	if (abs >= 10_000) return `${Math.round(value / 1000)}k`;
	return formatCount(value);
}

/**
 * A duration a human can size up: seconds below a minute, then minutes and
 * seconds, then hours and minutes. "122s" says much less than "2min2s".
 */
export function formatDuration(ms: number): string {
	const totalSeconds = Math.max(0, ms) / 1000;
	if (totalSeconds < 60) {
		return `${totalSeconds < 10 ? totalSeconds.toFixed(1) : Math.round(totalSeconds)}s`;
	}
	const seconds = Math.round(totalSeconds);
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) {
		const rest = seconds % 60;
		return rest === 0 ? `${minutes}min` : `${minutes}min${rest}s`;
	}
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	return rest === 0 ? `${hours}h` : `${hours}h${rest}min`;
}
