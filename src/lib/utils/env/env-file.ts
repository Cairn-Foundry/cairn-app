// Reading and writing `.env` files: the subset of shell quoting dotenv files
// actually use, including values spanning several lines inside quotes.

/** One `KEY=value` assignment, with the value already unquoted. */
export interface ParsedEnvEntry {
	key: string;
	value: string;
}

/** Parse result; `invalid` keeps the lines verbatim so they can be reported. */
interface ParsedEnvFile {
	entries: ParsedEnvEntry[];
	invalid: string[];
}

const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ASSIGNMENT = /^(?:export\s+)?([^=]+)=(.*)$/s;
const UNQUOTED_SAFE = /^[A-Za-z0-9_@%+=:,./-]*$/;

/** Keys Cairn exports itself, which a user variable must not shadow. */
export const RESERVED_KEY_PREFIX = "CAIRN_";

/** A POSIX-shaped name: letter or underscore first, then alphanumerics. */
export function isValidEnvKey(key: string): boolean {
	return KEY.test(key);
}

/** Case-insensitive, so `cairn_x` is refused as readily as `CAIRN_X`. */
export function isReservedEnvKey(key: string): boolean {
	return key.toUpperCase().startsWith(RESERVED_KEY_PREFIX);
}

/** Resolves the backslash escapes a double-quoted value may contain. */
function unescapeDoubleQuoted(raw: string): string {
	return raw.replace(/\\([nrtvf\\"'$`])/g, (_, char: string) => {
		switch (char) {
			case "n":
				return "\n";
			case "r":
				return "\r";
			case "t":
				return "\t";
			case "v":
				return "\v";
			case "f":
				return "\f";
			default:
				return char;
		}
	});
}

/**
 * Reads the value that starts at `rest`, consuming as many of the following
 * lines as the opening quote requires. Returns the value and how many extra
 * lines were swallowed.
 */
function readValue(rest: string, following: string[]): [string, number] {
	const quote = rest[0];
	if (quote !== '"' && quote !== "'") {
		const withoutComment = rest.replace(/\s+#.*$/, "");
		return [withoutComment.trim(), 0];
	}

	const escaped = quote === '"';
	let body = rest.slice(1);
	let consumed = 0;

	for (;;) {
		const end = findClosingQuote(body, quote, escaped);
		if (end !== -1) {
			const value = body.slice(0, end);
			return [escaped ? unescapeDoubleQuoted(value) : value, consumed];
		}
		if (consumed >= following.length) {
			return [escaped ? unescapeDoubleQuoted(body) : body, consumed];
		}
		body += `\n${following[consumed]}`;
		consumed += 1;
	}
}

/** Index of the terminating quote, skipping escaped ones in double quotes. */
function findClosingQuote(
	body: string,
	quote: string,
	escaped: boolean,
): number {
	for (let i = 0; i < body.length; i++) {
		if (escaped && body[i] === "\\") {
			i += 1;
			continue;
		}
		if (body[i] === quote) return i;
	}
	return -1;
}

/**
 * Blank lines and comments are skipped, a later assignment overwrites an
 * earlier one for the same key, and anything unparseable lands in `invalid`
 * rather than aborting the file.
 */
export function parseEnvFile(content: string): ParsedEnvFile {
	const lines = content.split(/\r?\n/);
	const entries: ParsedEnvEntry[] = [];
	const invalid: string[] = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;

		const match = ASSIGNMENT.exec(trimmed);
		if (!match) {
			invalid.push(trimmed);
			continue;
		}

		const key = match[1].trim();
		if (!isValidEnvKey(key)) {
			invalid.push(trimmed);
			continue;
		}

		const [value, consumed] = readValue(match[2].trim(), lines.slice(i + 1));
		i += consumed;

		const existing = entries.findIndex((e) => e.key === key);
		if (existing === -1) entries.push({ key, value });
		else entries[existing] = { key, value };
	}

	return { entries, invalid };
}

/** Quotes only when needed, preferring single quotes; newlines force double. */
export function quoteEnvValue(value: string): string {
	if (UNQUOTED_SAFE.test(value)) return value;
	if (!value.includes("'") && !value.includes("\n")) return `'${value}'`;
	return `"${value
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/\n/g, "\\n")
		.replace(/\r/g, "\\r")}"`;
}

/** Entries back to `.env` text, one assignment per line. */
export function serializeEnvFile(entries: ParsedEnvEntry[]): string {
	return entries
		.map((entry) => `${entry.key}=${quoteEnvValue(entry.value)}`)
		.join("\n");
}
