// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// The one place that knows whether a forge link comes from the bound
// integration or from the remote URL heuristics of remote-url.ts.

import { forgeWebLink } from "$lib/services/integration-service";
import { capabilitiesOf } from "$lib/stores/integrations";
import type { WebLinkTarget } from "$lib/types/integrations";
import {
	buildBranchUrl,
	buildCommitUrl,
	buildCompareUrl,
	buildFileUrl,
	parseRemoteUrl,
} from "$lib/utils/git/remote-url";

/**
 * What an "Open on ..." entry names: the bound forge's label, else the host of
 * the remote; null when neither is known, so the entry can be hidden.
 */
export function forgeLabel(
	forge: { label: string } | null,
	remoteUrl: string,
): string | null {
	return forge?.label ?? parseRemoteUrl(remoteUrl)?.host ?? null;
}

/**
 * The pipeline list of a branch on the forge, as the CI step's header button
 * opens it - the list, never a single pipeline. An empty ref gives the index of
 * every pipeline; an unknown forge gives "", so the caller can fall back.
 */
export function buildPipelinesUrl(
	forge: { kind: string; webUrl: string } | null | undefined,
	ref: string,
): string {
	if (!forge?.webUrl) return "";
	const base = forge.webUrl.replace(/\/+$/, "");
	if (forge.kind === "github") {
		return ref
			? `${base}/actions?query=branch%3A${encodeURIComponent(ref)}`
			: `${base}/actions`;
	}
	return ref
		? `${base}/-/pipelines?ref=${encodeURIComponent(ref)}`
		: `${base}/-/pipelines`;
}

/** The remote-only fallback: GitHub or GitLab URL shapes guessed from the host. */
export function fallbackForgeLink(
	remoteUrl: string,
	target: WebLinkTarget,
): string | null {
	switch (target.type) {
		case "file":
			return buildFileUrl(remoteUrl, target.ref, target.path, target.line);
		case "commit":
			return buildCommitUrl(remoteUrl, target.sha);
		case "branch":
			return buildBranchUrl(remoteUrl, target.name);
		case "compare":
			return buildCompareUrl(remoteUrl, target.base, target.head);
		default:
			return null;
	}
}

/**
 * The bound forge answers when the project has the `forge` capability, the
 * remote URL otherwise. A forge that fails to answer falls back the same way,
 * so a link is never lost to a network hiccup.
 */
export async function forgeLink(
	projectId: string,
	remoteUrl: string,
	target: WebLinkTarget,
): Promise<string | null> {
	if (capabilitiesOf(projectId).forge !== null) {
		try {
			const url = await forgeWebLink(projectId, target);
			if (url) return url;
		} catch {
			// falls through to the remote-based link
		}
	}
	return fallbackForgeLink(remoteUrl, target);
}
