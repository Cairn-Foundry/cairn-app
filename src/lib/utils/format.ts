/** Convert arbitrary text to a URL/branch-friendly slug. */
export function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}

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

export function formatDate(ts: number): string {
	return new Intl.DateTimeFormat(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
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
