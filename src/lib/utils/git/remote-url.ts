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
export function buildMergeRequestUrl(
	remote: string,
	sourceBranch: string,
	targetBranch: string,
): string | null {
	const parsed = parseRemoteUrl(remote);
	if (!parsed || !sourceBranch) return null;

	if (parsed.host === "github.com" || parsed.host.endsWith(".github.com")) {
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
