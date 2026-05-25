export type TicketSource = "gitlab" | "github" | "jira" | "internal";

export interface Project {
	id: string;
	name: string;
	path: string;
	color: string;
	activeInstanceId: string | null;
}

export interface ProjectFolder {
	id: string;
	name: string;
	projectIds: string[];
	collapsed: boolean;
}

export interface Ticket {
	id: string;
	source: TicketSource;
	title: string;
	description: string;
	url: string | null;
}
