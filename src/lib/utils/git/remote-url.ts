/** A git remote broken into what a browsable link needs. */
export type ParsedRemote = {
	host: string;
	/** Namespace and repository name, without the trailing `.git`. */
	path: string;
	/** Browsable https URL of the repository. */
	webUrl: string;
};

/**
 * Normalizes the forms `git remote get-url` can return - scp-like ssh
 * (`git@host:group/repo.git`), ssh:// with an optional port, and http(s) with
 * optional credentials - into a browsable https URL.
 */
export function parseRemoteUrl(remote: string): ParsedRemote | null {
	const trimmed = remote.trim();
	if (!trimmed) return null;

	const scpLike = /^(?:[^@/]+@)?([^/:]+):(?!\/)(.+)$/.exec(trimmed);
	let host: string;
	let path: string;

	if (scpLike) {
		host = scpLike[1];
		path = scpLike[2];
	} else {
		let url: URL;
		try {
			url = new URL(trimmed);
		} catch {
			return null;
		}
		if (!/^(https?|ssh|git):$/.test(url.protocol)) return null;
		host = url.hostname;
		path = url.pathname;
	}

	host = host.replace(/^\/+/, "");
	path = path
		.replace(/^\/+/, "")
		.replace(/\/+$/, "")
		.replace(/\.git$/, "");
	if (!host || !path) return null;

	return { host, path, webUrl: `https://${host}/${path}` };
}

/**
 * Deep link to the "new merge request" form of the forge hosting `remote`.
 * GitHub uses the compare form; everything else follows the GitLab shape, which
 * covers self-hosted instances whose hostname says nothing about the product.
 */
function isGitHubHost(host: string): boolean {
	return host === "github.com" || host.endsWith(".github.com");
}

function encodePath(path: string): string {
	return path.split("/").map(encodeURIComponent).join("/");
}

/** Deep link to a file, at a line when given, on the forge hosting `remote`. */
export function buildFileUrl(
	remote: string,
	ref: string,
	path: string,
	line: number | null = null,
): string | null {
	const parsed = parseRemoteUrl(remote);
	if (!parsed || !ref || !path) return null;
	const anchor = line === null ? "" : `#L${line}`;
	if (isGitHubHost(parsed.host)) {
		return `${parsed.webUrl}/blob/${encodeURIComponent(ref)}/${encodePath(path)}${anchor}`;
	}
	return `${parsed.webUrl}/-/blob/${encodeURIComponent(ref)}/${encodePath(path)}${anchor}`;
}

/** Deep link to a commit on the forge hosting `remote`. */
export function buildCommitUrl(remote: string, sha: string): string | null {
	const parsed = parseRemoteUrl(remote);
	if (!parsed || !sha) return null;
	if (isGitHubHost(parsed.host)) return `${parsed.webUrl}/commit/${sha}`;
	return `${parsed.webUrl}/-/commit/${sha}`;
}

/** Deep link to a branch on the forge hosting `remote`. */
export function buildBranchUrl(remote: string, branch: string): string | null {
	const parsed = parseRemoteUrl(remote);
	if (!parsed || !branch) return null;
	if (isGitHubHost(parsed.host)) {
		return `${parsed.webUrl}/tree/${encodeURIComponent(branch)}`;
	}
	return `${parsed.webUrl}/-/tree/${encodeURIComponent(branch)}`;
}

/** Deep link to the comparison of two refs on the forge hosting `remote`. */
export function buildCompareUrl(
	remote: string,
	base: string,
	head: string,
): string | null {
	const parsed = parseRemoteUrl(remote);
	if (!parsed || !base || !head) return null;
	const range = `${encodeURIComponent(base)}...${encodeURIComponent(head)}`;
	if (isGitHubHost(parsed.host)) return `${parsed.webUrl}/compare/${range}`;
	return `${parsed.webUrl}/-/compare/${range}`;
}

export function buildMergeRequestUrl(
	remote: string,
	sourceBranch: string,
	targetBranch: string,
): string | null {
	const parsed = parseRemoteUrl(remote);
	if (!parsed || !sourceBranch) return null;

	if (isGitHubHost(parsed.host)) {
		const range = targetBranch
			? `${encodeURIComponent(targetBranch)}...${encodeURIComponent(sourceBranch)}`
			: encodeURIComponent(sourceBranch);
		return `${parsed.webUrl}/compare/${range}?expand=1`;
	}

	const params = new URLSearchParams({
		"merge_request[source_branch]": sourceBranch,
	});
	if (targetBranch) params.set("merge_request[target_branch]", targetBranch);
	return `${parsed.webUrl}/-/merge_requests/new?${params.toString()}`;
}
