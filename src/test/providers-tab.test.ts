import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

const setProviderApiKey = vi.fn();
const deleteProviderApiKey = vi.fn();
vi.mock("$lib/services/ai-provider-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	setProviderApiKey: (...a: unknown[]) => setProviderApiKey(...a),
	deleteProviderApiKey: (...a: unknown[]) => deleteProviderApiKey(...a),
}));

const runProbe = vi.fn();
const refreshProviderModels = vi.fn();
vi.mock("$lib/stores/ai-providers", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	runProbe: (...a: unknown[]) => runProbe(...a),
	refreshProviderModels: (...a: unknown[]) => refreshProviderModels(...a),
	loadAiProviders: vi.fn().mockResolvedValue(undefined),
}));

const {
	aiProviders,
	apiKeyStatus,
	probeResults,
	probing,
	providerCapabilities,
	loadingModels,
	modelsError,
} = await import("$lib/stores/ai-providers");
const { PROVIDERS } = await import(
	"$lib/components/home/agents/providers-data"
);
const { default: ProvidersTab } = await import(
	"$lib/components/home/agents/ProvidersTab.svelte"
);

/** A provider that actually takes an API key, which the key tests are about. */
const KEYED = PROVIDERS.find(
	(p) => p.hasApiKey && p.status !== "coming-soon",
) as (typeof PROVIDERS)[number];
/** The provider the tab opens on, used where the key is beside the point. */
const FIRST = PROVIDERS[0];

const items = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".ag-item"));
const keyField = () =>
	document.querySelector(
		'.ag-detail input[type="password"]',
	) as HTMLInputElement;
const keySetMark = () => document.querySelector(".key-set");
const chips = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".ag-chip"));
const chipLabels = () =>
	chips().map((c) => c.querySelector(".selectable")?.textContent);
const buttonNamed = (pattern: RegExp) =>
	Array.from(
		document.querySelectorAll<HTMLButtonElement>(".ag-detail .btn"),
	).find((b) =>
		pattern.test((b.textContent ?? "").trim()),
	) as HTMLButtonElement;
const settingsOf = (id: string) => {
	let value: Record<string, unknown> = {};
	aiProviders.subscribe((c) => {
		value = (c.providers[id] ?? {}) as never;
	})();
	return value;
};

async function settle() {
	await tick();
	await tick();
	await tick();
}

/** The settings a provider panel needs before it can render its fields. */
const BASE_SETTINGS = {
	enabled: true,
	baseUrl: "",
	model: "",
	customModels: [] as string[],
	temperature: 0.7,
	maxTokens: 4096,
	timeout: 60,
	streaming: true,
	binaryPath: "",
	effort: "",
	permissionMode: "",
	extraArgs: [] as string[],
};

/** Seeds the provider the tab opens on. */
function seedOpen(settings: Record<string, unknown> = {}) {
	aiProviders.set({
		providers: {
			[FIRST.id]: { ...BASE_SETTINGS, ...settings },
			[KEYED.id]: { ...BASE_SETTINGS },
		},
		defaultProviderId: "",
	} as never);
}

function seed(settings: Record<string, unknown> = {}) {
	aiProviders.set({
		providers: {
			[KEYED.id]: { ...BASE_SETTINGS, ...settings },
			[FIRST.id]: { ...BASE_SETTINGS },
		},
		defaultProviderId: "",
	} as never);
}

beforeEach(() => {
	setProviderApiKey.mockReset().mockResolvedValue({ set: true });
	deleteProviderApiKey.mockReset().mockResolvedValue(undefined);
	runProbe.mockReset().mockResolvedValue(undefined);
	refreshProviderModels.mockReset().mockResolvedValue(undefined);
	seed();
	void FIRST;
	apiKeyStatus.set({});
	probeResults.set({});
	probing.set({});
	providerCapabilities.set({} as never);
	loadingModels.set({});
	modelsError.set({});
});

describe("ProvidersTab", () => {
	describe("the provider list", () => {
		it("lists every provider it knows", async () => {
			render(ProvidersTab, {});
			await settle();
			expect(items()).toHaveLength(PROVIDERS.length);
		});

		it("marks the provider on screen, and only that one", async () => {
			render(ProvidersTab, {});
			await settle();
			expect(
				items().filter((i) => i.classList.contains("active")),
			).toHaveLength(1);
		});

		it("switches to the provider that was picked", async () => {
			render(ProvidersTab, {});
			await settle();
			const other = items().find(
				(i) => !i.classList.contains("active"),
			) as HTMLElement;
			await userEvent.click(other);
			await tick();
			expect(other.classList.contains("active")).toBe(true);
		});

		it("narrows the list to what was searched", async () => {
			render(ProvidersTab, {});
			await settle();
			const search = document.querySelector(
				".ag-master input",
			) as HTMLInputElement;
			await userEvent.type(search, PROVIDERS[0].name.slice(0, 4));
			expect(items().length).toBeLessThan(PROVIDERS.length);
		});
	});

	describe("the api key", () => {
		/** The key panel only exists for a provider that takes one. */
		async function openKeyed() {
			render(ProvidersTab, {});
			await settle();
			const row = items().find((i) =>
				i.textContent?.includes(KEYED.name),
			) as HTMLElement;
			await userEvent.click(row);
			await settle();
		}

		it("asks for a key when none is stored", async () => {
			await openKeyed();
			expect(keyField()).not.toBeNull();
			expect(keySetMark()).toBeNull();
		});

		/** The disabled button and the guard in the handler are two defences. */
		it("refuses to save an empty key", async () => {
			await openKeyed();
			expect(buttonNamed(/save/i).disabled).toBe(true);
			await userEvent.type(keyField(), "   ");
			expect(buttonNamed(/save/i).disabled).toBe(true);

			const save = buttonNamed(/save/i);
			save.disabled = false;
			await userEvent.click(save);
			await settle();
			expect(setProviderApiKey).not.toHaveBeenCalled();
		});

		it("stores the key that was typed, trimmed", async () => {
			await openKeyed();
			await userEvent.type(keyField(), "  sk-secret  ");
			await userEvent.click(buttonNamed(/save/i));
			await settle();
			expect(setProviderApiKey).toHaveBeenCalledWith(KEYED.id, "sk-secret");
		});

		/** The key never lingers in the field once it is stored. */
		/**
		 * The panel switches to "key stored" from the status the save returned,
		 * so the field going is checked alongside the draft being dropped: a
		 * key left in the draft would come back on the next replace.
		 */
		it("clears the field once the key is stored", async () => {
			await openKeyed();
			await userEvent.type(keyField(), "sk-secret");
			await userEvent.click(buttonNamed(/save/i));
			await settle();
			expect(keySetMark()).not.toBeNull();
			expect(keyField()).toBeNull();

			await userEvent.click(buttonNamed(/replace/i));
			await tick();
			expect(keyField().value).toBe("");
		});

		it("re-probes the provider once a key is stored", async () => {
			await openKeyed();
			await userEvent.type(keyField(), "sk-secret");
			await userEvent.click(buttonNamed(/save/i));
			await settle();
			expect(runProbe).toHaveBeenCalledWith(KEYED.id);
		});

		it("says a key is stored without showing it", async () => {
			apiKeyStatus.set({ [KEYED.id]: { set: true } } as never);
			await openKeyed();
			expect(keySetMark()).not.toBeNull();
			expect(keyField()).toBeNull();
			expect(document.body.textContent).not.toContain("sk-");
		});

		it("removes the stored key on request", async () => {
			apiKeyStatus.set({ [KEYED.id]: { set: true } } as never);
			await openKeyed();
			await userEvent.click(buttonNamed(/remove/i));
			await settle();
			expect(deleteProviderApiKey).toHaveBeenCalledWith(KEYED.id);
			expect(runProbe).toHaveBeenCalledWith(KEYED.id);
		});

		it("offers to replace a stored key", async () => {
			apiKeyStatus.set({ [KEYED.id]: { set: true } } as never);
			await openKeyed();
			await userEvent.click(buttonNamed(/replace/i));
			await tick();
			expect(keyField()).not.toBeNull();
		});

		/** Switching provider must not carry a half-typed key across. */
		/**
		 * Switching provider must not carry a half-typed key across. Checked by
		 * coming back to the same provider, since the other panel may not even
		 * show a key field.
		 */
		it("drops a half-typed key when another provider is picked", async () => {
			await openKeyed();
			await userEvent.type(keyField(), "half-typed");

			const other = items().find(
				(i) => !i.classList.contains("active"),
			) as HTMLElement;
			await userEvent.click(other);
			await settle();

			const back = items().find((i) =>
				i.textContent?.includes(KEYED.name),
			) as HTMLElement;
			await userEvent.click(back);
			await settle();
			expect(keyField().value).toBe("");
		});
	});

	describe("custom models", () => {
		/** These act on the provider the tab opens on, not the keyed one. */
		const OPEN = FIRST;
		const customField = () =>
			document.getElementById("p-custom") as HTMLInputElement;

		it("adds the model that was typed", async () => {
			render(ProvidersTab, {});
			await settle();
			await userEvent.type(customField(), "my-model");
			await userEvent.click(buttonNamed(/add/i));
			await tick();
			expect(settingsOf(OPEN.id).customModels).toEqual(["my-model"]);
		});

		it("clears the field once the model is added", async () => {
			render(ProvidersTab, {});
			await settle();
			await userEvent.type(customField(), "my-model");
			await userEvent.click(buttonNamed(/add/i));
			await tick();
			expect(customField().value).toBe("");
		});

		/** The same model twice is one model. */
		it("refuses a model that is already there", async () => {
			seedOpen({ customModels: ["my-model"] });
			render(ProvidersTab, {});
			await settle();
			await userEvent.type(customField(), "my-model");
			expect(buttonNamed(/add/i).disabled).toBe(true);

			const add = buttonNamed(/add/i);
			add.disabled = false;
			await userEvent.click(add);
			await tick();
			expect(settingsOf(OPEN.id).customModels).toEqual(["my-model"]);
		});

		it("refuses an empty model", async () => {
			render(ProvidersTab, {});
			await settle();
			expect(buttonNamed(/add/i).disabled).toBe(true);
		});

		it("lists the custom models as chips", async () => {
			seedOpen({ customModels: ["a", "b"] });
			render(ProvidersTab, {});
			await settle();
			expect(chipLabels()).toEqual(["a", "b"]);
		});

		it("removes the model that was asked for", async () => {
			seedOpen({ customModels: ["a", "b"] });
			render(ProvidersTab, {});
			await settle();
			await userEvent.click(
				chips()[0].querySelector(".ag-chip-remove") as HTMLElement,
			);
			await tick();
			expect(settingsOf(OPEN.id).customModels).toEqual(["b"]);
		});

		/**
		 * Removing the model in use would leave the provider pointing at a model
		 * that no longer exists, so it falls back to the provider's default.
		 */
		it("falls back to the default when the model in use is removed", async () => {
			seedOpen({ customModels: ["a", "b"], model: "a" });
			render(ProvidersTab, {});
			await settle();
			await userEvent.click(
				chips()[0].querySelector(".ag-chip-remove") as HTMLElement,
			);
			await tick();
			expect(settingsOf(OPEN.id).model).toBe("");
		});

		it("leaves the model in use alone when another is removed", async () => {
			seedOpen({ customModels: ["a", "b"], model: "a" });
			render(ProvidersTab, {});
			await settle();
			await userEvent.click(
				chips()[1].querySelector(".ag-chip-remove") as HTMLElement,
			);
			await tick();
			expect(settingsOf(OPEN.id).model).toBe("a");
		});

		it("names the remove action for a screen reader", async () => {
			seedOpen({ customModels: ["a"] });
			render(ProvidersTab, {});
			await settle();
			expect(
				chips()[0].querySelector(".ag-chip-remove")?.getAttribute("aria-label"),
			).toBeTruthy();
		});
	});
});
