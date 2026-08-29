import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$lib/services/settings-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	updateSettings: vi.fn(async (next: unknown) => next),
}));

const loadAiProviders = vi.fn();
const refreshProviderModels = vi.fn();
vi.mock("$lib/stores/ai-providers", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	loadAiProviders: (...a: unknown[]) => loadAiProviders(...a),
	refreshProviderModels: (...a: unknown[]) => refreshProviderModels(...a),
}));

const { settings } = await import("$lib/stores/settings");
const { aiProviders, providerCapabilities } = await import(
	"$lib/stores/ai-providers"
);
const { AI_FEATURES, assignableProviders } = await import(
	"$lib/utils/home/ai-features"
);
const { default: FeaturesSection } = await import(
	"$lib/components/home/features/FeaturesSection.svelte"
);

const FEATURE = AI_FEATURES[0].id;

const cards = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".feat-card"));
const customBadges = () =>
	document.querySelectorAll(".feat-actions .feat-badge");
const emptyNote = () => document.querySelector(".feat-empty");
const selectsIn = (card: HTMLElement) =>
	Array.from(card.querySelectorAll<HTMLElement>(".select-trigger"));
const editButtonIn = (card: HTMLElement) =>
	card.querySelector(".feat-actions .btn") as HTMLElement;
const stored = () => {
	let value: Record<
		string,
		{ providerId: string; model: string; promptTemplate: string }
	> = {};
	settings.subscribe((s) => {
		value = (s.aiFeatures ?? {}) as never;
	})();
	return value;
};

/**
 * The assignable providers come from a static catalogue of agent CLIs, not
 * from the store: what the store carries is their settings and their models.
 */
const [FIRST_PROVIDER, SECOND_PROVIDER] = assignableProviders(null);

function seedModels() {
	providerCapabilities.set({
		[FIRST_PROVIDER.id]: { models: [{ id: "model-a", label: "Model A" }] },
		[SECOND_PROVIDER.id]: { models: [{ id: "model-b", label: "Model B" }] },
	} as never);
}

async function settle() {
	await tick();
	await tick();
	await tick();
}

beforeEach(async () => {
	loadAiProviders.mockReset().mockResolvedValue(undefined);
	refreshProviderModels.mockReset().mockResolvedValue(undefined);
	aiProviders.set({ providers: {}, defaultProviderId: "" } as never);
	providerCapabilities.set({} as never);
	await settings.save({ aiFeatures: {} });
});

describe("FeaturesSection", () => {
	describe("the cards", () => {
		it("loads the providers on arrival", async () => {
			render(FeaturesSection, {});
			await settle();
			expect(loadAiProviders).toHaveBeenCalled();
		});

		it("shows a card per feature", async () => {
			seedModels();
			render(FeaturesSection, {});
			await settle();
			expect(cards()).toHaveLength(AI_FEATURES.length);
			expect(emptyNote()).toBeNull();
		});

		/** Each CLI's model list is refreshed so the pickers are current. */
		it("refreshes the models of every provider it can assign", async () => {
			seedModels();
			render(FeaturesSection, {});
			await settle();
			for (const provider of assignableProviders(null)) {
				expect(refreshProviderModels).toHaveBeenCalledWith(provider.id);
			}
		});
	});

	describe("assigning a provider", () => {
		it("stores the provider that was picked", async () => {
			seedModels();
			render(FeaturesSection, {});
			await settle();
			await userEvent.click(selectsIn(cards()[0])[0]);
			const option = Array.from(
				document.querySelectorAll<HTMLElement>('[role="option"]'),
			).find(
				(o) => o.textContent?.trim() === FIRST_PROVIDER.name,
			) as HTMLElement;
			await userEvent.click(option);
			await tick();
			expect(stored()[FEATURE]?.providerId).toBe(FIRST_PROVIDER.id);
		});

		/**
		 * A model id belongs to one CLI, so changing provider drops the model
		 * rather than carrying a name the new provider does not know.
		 */
		it("drops the model when the provider changes", async () => {
			seedModels();
			await settings.save({
				aiFeatures: {
					[FEATURE]: {
						providerId: FIRST_PROVIDER.id,
						model: "model-a",
						promptTemplate: "",
					},
				},
			});
			render(FeaturesSection, {});
			await settle();
			await userEvent.click(selectsIn(cards()[0])[0]);
			const option = Array.from(
				document.querySelectorAll<HTMLElement>('[role="option"]'),
			).find(
				(o) => o.textContent?.trim() === SECOND_PROVIDER.name,
			) as HTMLElement;
			await userEvent.click(option);
			await tick();
			expect(stored()[FEATURE]?.providerId).toBe(SECOND_PROVIDER.id);
			expect(stored()[FEATURE]?.model).toBe("");
		});

		/**
		 * Started with another feature already assigned: with an empty map, a
		 * write that replaced everything would look identical to one that
		 * merged.
		 */
		it("leaves the other features alone", async () => {
			const other = AI_FEATURES[1].id;
			seedModels();
			await settings.save({
				aiFeatures: {
					[other]: {
						providerId: SECOND_PROVIDER.id,
						model: "model-b",
						promptTemplate: "kept",
					},
				},
			});
			render(FeaturesSection, {});
			await settle();
			await userEvent.click(selectsIn(cards()[0])[0]);
			const option = Array.from(
				document.querySelectorAll<HTMLElement>('[role="option"]'),
			).find(
				(o) => o.textContent?.trim() === FIRST_PROVIDER.name,
			) as HTMLElement;
			await userEvent.click(option);
			await tick();
			expect(stored()[FEATURE]?.providerId).toBe(FIRST_PROVIDER.id);
			expect(stored()[other]).toMatchObject({
				providerId: SECOND_PROVIDER.id,
				promptTemplate: "kept",
			});
		});

		/** A model the CLI no longer reports is still offered, so it is not lost. */
		it("keeps offering a pinned model the provider no longer reports", async () => {
			seedModels();
			await settings.save({
				aiFeatures: {
					[FEATURE]: {
						providerId: FIRST_PROVIDER.id,
						model: "retired-model",
						promptTemplate: "",
					},
				},
			});
			render(FeaturesSection, {});
			await settle();
			await userEvent.click(selectsIn(cards()[0])[1]);
			const labels = Array.from(
				document.querySelectorAll<HTMLElement>('[role="option"]'),
			).map((o) => o.textContent?.trim());
			expect(labels).toContain("retired-model");
		});
	});

	describe("the prompt template", () => {
		/**
		 * The regression this covers: the badge marking a customised template
		 * read the assignments through a plain function, so a template changed
		 * while the section was open never showed as custom.
		 */
		it("marks a feature whose template was customised", async () => {
			seedModels();
			render(FeaturesSection, {});
			await settle();
			expect(customBadges()).toHaveLength(0);

			await settings.save({
				aiFeatures: {
					[FEATURE]: {
						providerId: FIRST_PROVIDER.id,
						model: "",
						promptTemplate: "my own prompt",
					},
				},
			});
			await tick();
			expect(customBadges()).toHaveLength(1);
		});

		it("marks it on arrival too", async () => {
			seedModels();
			await settings.save({
				aiFeatures: {
					[FEATURE]: {
						providerId: FIRST_PROVIDER.id,
						model: "",
						promptTemplate: "my own prompt",
					},
				},
			});
			render(FeaturesSection, {});
			await settle();
			expect(customBadges()).toHaveLength(1);
		});

		it("marks nothing while every template is the default", async () => {
			seedModels();
			await settings.save({
				aiFeatures: {
					[FEATURE]: {
						providerId: FIRST_PROVIDER.id,
						model: "",
						promptTemplate: "",
					},
				},
			});
			render(FeaturesSection, {});
			await settle();
			expect(customBadges()).toHaveLength(0);
		});

		it("resets a customised template back to the default", async () => {
			seedModels();
			await settings.save({
				aiFeatures: {
					[FEATURE]: {
						providerId: FIRST_PROVIDER.id,
						model: "",
						promptTemplate: "my own prompt",
					},
				},
			});
			render(FeaturesSection, {});
			await settle();
			await userEvent.click(editButtonIn(cards()[0]));
			await tick();
			const reset = Array.from(
				cards()[0].querySelectorAll<HTMLElement>(".feat-actions .btn"),
			).pop() as HTMLElement;
			await userEvent.click(reset);
			await tick();
			expect(stored()[FEATURE]?.promptTemplate).toBe("");
		});

		it("closes the editor without storing anything", async () => {
			seedModels();
			render(FeaturesSection, {});
			await settle();
			await userEvent.click(editButtonIn(cards()[0]));
			await tick();
			const cancel = Array.from(
				cards()[0].querySelectorAll<HTMLElement>(".feat-actions .btn.ghost"),
			)[0];
			await userEvent.click(cancel);
			await tick();
			expect(document.querySelector("textarea")).toBeNull();
			expect(stored()[FEATURE]?.promptTemplate ?? "").toBe("");
		});

		it("opens an editor prefilled with the template in use", async () => {
			seedModels();
			render(FeaturesSection, {});
			await settle();
			await userEvent.click(editButtonIn(cards()[0]));
			await tick();
			const area = document.querySelector("textarea") as HTMLTextAreaElement;
			expect(area).not.toBeNull();
			expect(area.value.length).toBeGreaterThan(0);
		});

		it("stores the template that was written", async () => {
			seedModels();
			render(FeaturesSection, {});
			await settle();
			await userEvent.click(editButtonIn(cards()[0]));
			await tick();
			const area = document.querySelector("textarea") as HTMLTextAreaElement;
			await userEvent.clear(area);
			await userEvent.type(area, "my own prompt");
			// The editor is inline in the card, not a modal: the save button is
			// the one action that is not a ghost.
			const save = Array.from(
				cards()[0].querySelectorAll<HTMLElement>(".feat-actions .btn"),
			).find((b) => !b.classList.contains("ghost")) as HTMLElement;
			await userEvent.click(save);
			await tick();
			expect(stored()[FEATURE]?.promptTemplate).toBe("my own prompt");
		});
	});
});
