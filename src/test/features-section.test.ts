import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CairnSettings } from "$lib/services/settings-service";

const saved = vi.fn();
const settingsState = writable<Partial<CairnSettings>>({ aiFeatures: {} });
vi.mock("$lib/stores/settings", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	settings: {
		subscribe: settingsState.subscribe,
		save: (next: unknown) => saved(next),
	},
}));

const { cliProviders } = await import("$lib/stores/cli-providers");
const { default: FeaturesSection } = await import(
	"$lib/components/home/features/FeaturesSection.svelte"
);

const provider = (id: string, label: string, installed = true) =>
	({ id, label, installed, configured: installed }) as never;

beforeEach(() => {
	saved.mockReset();
	settingsState.set({ aiFeatures: {} });
	cliProviders.set([
		provider("claude-code", "Claude Code"),
		provider("codex", "Codex"),
	]);
});

const cards = () => Array.from(document.querySelectorAll(".feat-card"));
const triggerOf = (card: Element) =>
	card.querySelector(".feat-select button") as HTMLElement;

describe("FeaturesSection", () => {
	/** The native select is banned app-wide: the popup it draws ignores the theme. */
	it("picks the provider with Cairn's own dropdown", async () => {
		render(FeaturesSection);
		await tick();
		expect(document.querySelector("select")).toBeNull();
		expect(triggerOf(cards()[0])).not.toBeNull();
	});

	it("offers every assist CLI, and only those", async () => {
		render(FeaturesSection);
		await tick();
		await userEvent.click(triggerOf(cards()[0]));
		const labels = [...document.querySelectorAll(".select-option")].map((o) =>
			o.textContent?.trim(),
		);
		expect(labels).toEqual(["Claude Code", "Codex"]);
	});

	it("assigns the chosen provider to that feature alone", async () => {
		render(FeaturesSection);
		await tick();
		await userEvent.click(triggerOf(cards()[0]));
		const codex = [...document.querySelectorAll(".select-option")].find((o) =>
			o.textContent?.includes("Codex"),
		);
		await userEvent.click(codex as HTMLElement);
		const written = saved.mock.calls[0][0] as {
			aiFeatures: Record<string, { providerId: string }>;
		};
		expect(written.aiFeatures.commitMessage.providerId).toBe("codex");
		expect(Object.keys(written.aiFeatures)).toEqual(["commitMessage"]);
	});

	/**
	 * Free text on purpose: a model released after this version has to work by
	 * being typed, not by waiting for a release of Cairn.
	 */
	it("takes a model id the suggestions do not list", async () => {
		render(FeaturesSection);
		await tick();
		const field = cards()[0].querySelector("input[list]") as HTMLInputElement;
		await userEvent.type(field, "claude-opus-5");
		await userEvent.tab();
		const written = saved.mock.calls.at(-1)?.[0] as {
			aiFeatures: Record<string, { model: string }>;
		};
		expect(written.aiFeatures.commitMessage.model).toBe("claude-opus-5");
	});

	it("warns when the pinned CLI is not installed", async () => {
		settingsState.set({
			aiFeatures: {
				commitMessage: {
					providerId: "codex",
					model: "",
					promptTemplate: "",
				},
			},
		});
		cliProviders.set([
			provider("claude-code", "Claude Code"),
			provider("codex", "Codex", false),
		]);
		render(FeaturesSection);
		await tick();
		expect(cards()[0].querySelector(".bad")?.textContent).toContain("Codex");
	});
});
