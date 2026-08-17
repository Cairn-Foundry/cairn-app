/** A registered repository, as persisted in projects.json. */
export interface Project {
	id: string;
	name: string;
	path: string;
	color: string;
	activeInstanceId: string | null;
}

/** A grouping in the home project list; membership and order live in listing.json. */
export interface ProjectFolder {
	id: string;
	name: string;
	projectIds: string[];
	collapsed: boolean;
}
