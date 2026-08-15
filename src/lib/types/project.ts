/** The tracker a ticket was imported from. */
export type TicketSource = "gitlab" | "github" | "jira";

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

/** A unit of work an instance is created for, imported from a tracker. */
export interface Ticket {
	id: string;
	source: TicketSource;
	title: string;
	description: string;
	url: string | null;
}
