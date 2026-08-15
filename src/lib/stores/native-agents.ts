import { get, writable } from "svelte/store";
import {
	listNativeAgents,
	type NativeAgent,
} from "$lib/services/native-agent-service";
import { projects } from "$lib/stores/project";

export const nativeAgents = writable<NativeAgent[]>([]);
export const nativeAgentsLoading = writable(false);
export const nativeAgentsError = writable("");

export async function loadNativeAgents(): Promise<void> {
	nativeAgentsLoading.set(true);
	nativeAgentsError.set("");
	try {
		const known = get(projects).map((p) => ({
			id: p.id,
			name: p.name,
			path: p.path,
		}));
		nativeAgents.set(await listNativeAgents(known));
	} catch (e) {
		nativeAgentsError.set(String(e));
	} finally {
		nativeAgentsLoading.set(false);
	}
}
