/**
 * The home directory, read off any path Cairn owns: everything it stores lives
 * under `~/.cairn`, so the segment before it is the home root.
 */
function homeOf(paths: string[]): string {
	for (const path of paths) {
		const at = path.indexOf("/.cairn/");
		if (at > 0) return path.slice(0, at);
	}
	return "";
}

/**
 * Strips the part of a path the user already knows. A tool line that says
 * `/Users/me/.cairn/projects/<uuid>/worktrees/feat-x/index.html` spends its
 * whole width on the one thing that never changes; inside that worktree the
 * file is `index.html`.
 *
 * Roots are stripped longest first, so a worktree inside a project directory
 * wins over the project itself. What is left of the home directory becomes
 * `~`, which keeps a path outside the worktree readable instead of merely
 * shorter.
 */
export function shortenPaths(text: string, roots: string[]): string {
	const usable = roots.filter(Boolean).sort((a, b) => b.length - a.length);
	let out = text;
	for (const root of usable) {
		out = out.split(`${root}/`).join("");
		// The root on its own is the place itself, not a file in it.
		out = out.split(root).join(".");
	}
	const home = homeOf(usable);
	if (home) out = out.split(`${home}/`).join("~/");
	return out;
}
