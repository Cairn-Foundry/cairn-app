/** The key one instance's integration state is stored under, `projectId:instanceId`. */
export function integrationKey(projectId: string, instanceId: string): string {
	return `${projectId}:${instanceId}`;
}
