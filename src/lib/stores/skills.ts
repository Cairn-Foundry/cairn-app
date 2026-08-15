/** Claude Code skills discovered across the registered projects, read-only: discovered by scanning every project path. */
import { get, writable } from "svelte/store";
import { listSkills, type Skill } from "$lib/services/skill-service";
import { projects } from "$lib/stores/project";

export const skills = writable<Skill[]>([]);
export const skillsLoading = writable(false);
export const skillsError = writable("");

/** Rescans every registered project; errors land in the error store rather than throwing. */
export async function loadSkills(): Promise<void> {
	skillsLoading.set(true);
	skillsError.set("");
	try {
		const known = get(projects).map((p) => ({
			id: p.id,
			name: p.name,
			path: p.path,
		}));
		skills.set(await listSkills(known));
	} catch (e) {
		skillsError.set(String(e));
	} finally {
		skillsLoading.set(false);
	}
}
