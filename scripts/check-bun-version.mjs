/**
 * Refuses an install by a Bun too old to read the committed lockfile.
 *
 * `bun.lock` is the text lockfile Bun 1.2 introduced. Bun 1.1 and older do not
 * read it at all: they ignore every pinned version, resolve the ranges in
 * package.json fresh from the registry, and write a binary `bun.lockb` beside
 * it. Nothing fails, so the install looks normal - it just pins nothing, and
 * the tree ends up on versions no one else builds against. That silence is
 * what this guard replaces.
 *
 * Wired as the `preinstall` script, and written for Bun rather than as a shell
 * script so `bun install` keeps working where `bash` is absent.
 */

const MIN = "1.2.0";

const part = (v, i) => Number.parseInt(v.split(".")[i] ?? "0", 10) || 0;
const older = (a, b) => {
	for (let i = 0; i < 3; i++) {
		if (part(a, i) !== part(b, i)) return part(a, i) < part(b, i);
	}
	return false;
};

const have = typeof Bun !== "undefined" ? Bun.version : process.versions?.bun;

if (!have) {
	console.error(
		`This project is built with Bun (>= ${MIN}); see https://bun.sh to install it.`,
	);
	process.exit(1);
}

if (older(have, MIN)) {
	console.error(
		[
			`Bun ${have} cannot read bun.lock, the text lockfile committed here (Bun >= ${MIN}).`,
			"",
			"Installing with it would resolve every dependency range from the registry",
			"instead, write a bun.lockb next to the lockfile, and leave you on versions",
			"nobody else builds against - without printing a single warning.",
			"",
			"    bun upgrade          # then, from the repository root:",
			"    rm -f bun.lockb",
			"    bun install",
		].join("\n"),
	);
	process.exit(1);
}
