/**
 * The `@token` an agent answers to at the prompt. Whitespace collapses to a
 * dash, so "Code Reviewer" and "Code-Reviewer" claim the same token - which is
 * why the agent form warns when two agents would collide.
 */
export function mentionToken(name: string): string {
	return name.trim().replace(/\s+/g, "-");
}
