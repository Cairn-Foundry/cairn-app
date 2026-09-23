// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/** A registered repository, as persisted in projects.json. */
export interface Project {
	id: string;
	name: string;
	path: string;
	color: string;
	activeInstanceId: string | null;
	/** Overrides the global `branchTemplate` for this repository; absent leaves it to the global one. */
	branchTemplate?: string | null;
}

/** A grouping in the home project list; membership and order live in listing.json. */
export interface ProjectFolder {
	id: string;
	name: string;
	projectIds: string[];
	collapsed: boolean;
}
