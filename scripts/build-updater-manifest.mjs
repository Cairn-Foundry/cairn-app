/**
 * Composes the Tauri updater manifest (latest.json) from the artifacts downloaded
 * by the release job. Run from the repository root:
 *
 *   node scripts/build-updater-manifest.mjs <version> <tag> <artifacts-dir> <out-file>
 *
 * Every platform key below must resolve to exactly one bundle plus its .sig, or the
 * script exits non-zero: a release missing one platform would leave those users
 * without any update path.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const PLATFORMS = [
	{
		dir: "bundle-macos-universal",
		pattern: /\.app\.tar\.gz$/,
		keys: ["darwin-aarch64", "darwin-x86_64"],
	},
	{
		dir: "bundle-windows-x86_64",
		pattern: /-setup\.exe$/,
		keys: ["windows-x86_64"],
	},
	{
		dir: "bundle-windows-aarch64",
		pattern: /-setup\.exe$/,
		keys: ["windows-aarch64"],
	},
	{
		dir: "bundle-linux-x86_64",
		pattern: /\.AppImage$/,
		keys: ["linux-x86_64"],
	},
	{
		dir: "bundle-linux-aarch64",
		pattern: /\.AppImage$/,
		keys: ["linux-aarch64"],
	},
];

function fail(message) {
	console.error(`build-updater-manifest: ${message}`);
	process.exit(1);
}

function listFiles(dir) {
	const entries = [];
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) entries.push(...listFiles(path));
		else entries.push(path);
	}
	return entries;
}

const [version, tag, artifactsDir, outFile] = process.argv.slice(2);
if (!version || !tag || !artifactsDir || !outFile) {
	fail(
		"usage: build-updater-manifest.mjs <version> <tag> <artifacts-dir> <out-file>",
	);
}

const repository = process.env.GITHUB_REPOSITORY;
if (!repository) fail("GITHUB_REPOSITORY is not set");

const platforms = {};

for (const { dir, pattern, keys } of PLATFORMS) {
	const root = join(artifactsDir, dir);
	let files;
	try {
		files = listFiles(root);
	} catch {
		fail(`missing artifact directory ${dir}`);
	}

	const bundles = files.filter((file) => pattern.test(file));
	if (bundles.length !== 1) {
		fail(
			`expected exactly one bundle matching ${pattern} in ${dir}, found ${bundles.length}`,
		);
	}

	const bundle = bundles[0];
	const signaturePath = `${bundle}.sig`;
	if (!files.includes(signaturePath)) {
		fail(`missing signature for ${basename(bundle)} in ${dir}`);
	}

	const signature = readFileSync(signaturePath, "utf-8").trim();
	if (!signature) fail(`empty signature for ${basename(bundle)}`);

	// The bundle name comes from productName, which contains a space: it has to be
	// percent-encoded or the updater cannot resolve the URL.
	const url = `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(basename(bundle))}`;
	for (const key of keys) platforms[key] = { signature, url };
}

const manifest = {
	version,
	notes: (process.env.RELEASE_NOTES ?? "").trim(),
	pub_date: new Date().toISOString(),
	platforms,
};

writeFileSync(outFile, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
	`build-updater-manifest: ${Object.keys(platforms).length} platforms written to ${outFile}`,
);
