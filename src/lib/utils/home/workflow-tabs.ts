import { t } from "$lib/i18n";
import type { WorkflowTabConfig } from "$lib/services/settings-service";

/**
 * The workflow tabs a project starts with. `order` is stored rather than
 * implied by position, since the user can reorder and disable them.
 */
export const DEFAULT_WF_TABS: WorkflowTabConfig[] = [
	{
		key: "files",
		name: t("workflowTabs.files") as string,
		icon: "folder",
		enabled: true,
		order: 0,
	},
	{
		key: "agent",
		name: t("workflowTabs.agent") as string,
		icon: "agent",
		enabled: true,
		order: 1,
	},
	{
		key: "tests",
		name: t("workflowTabs.tests") as string,
		icon: "tests",
		enabled: true,
		order: 2,
	},
	{
		key: "git",
		name: t("workflowTabs.git") as string,
		icon: "git",
		enabled: true,
		order: 3,
	},
	{
		key: "cicd",
		name: t("workflowTabs.cicd") as string,
		icon: "ci",
		enabled: true,
		order: 4,
	},
	{
		key: "review",
		name: t("workflowTabs.review") as string,
		icon: "review",
		enabled: true,
		order: 5,
	},
];
