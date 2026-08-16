import { getGreetingPools } from "$lib/i18n";

function pickRandom<T>(items: T[]): T {
	return items[Math.floor(Math.random() * items.length)] as T;
}

/** Time-of-day + day-of-week greeting, randomized within its bucket. */
export function pickGreeting(now: Date = new Date()): string {
	const pools = getGreetingPools();
	const day = now.getDay();
	const hour = now.getHours();

	if (day === 0 || day === 6) return pickRandom(pools.weekend);
	if (hour >= 5 && hour < 12) return pickRandom(pools.morning);
	if (hour >= 12 && hour < 18) return pickRandom(pools.afternoon);
	if (hour >= 18 && hour < 23) return pickRandom(pools.evening);
	return pickRandom(pools.night);
}

/** A Minecraft-splash-style one-liner, picked fresh on every visit. */
export function pickTagline(): string {
	return pickRandom(getGreetingPools().splashes);
}
