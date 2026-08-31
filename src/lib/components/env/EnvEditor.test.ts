// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { describe, expect, it, vi } from "vitest";
import type { EnvVariable } from "$lib/services/env-service";
import { RESERVED_KEY_PREFIX } from "$lib/utils/env/env-file";
import EnvEditor from "./EnvEditor.svelte";

function variable(overrides: Partial<EnvVariable> = {}): EnvVariable {
	return {
		id: "v1",
		key: "DATABASE_URL",
		value: "postgres://localhost",
		perInstance: false,
		defaultValue: "",
		secret: false,
		enabled: true,
		...overrides,
	};
}

function mount(props: Record<string, unknown> = {}) {
	const onSave = vi.fn();
	const onClose = vi.fn();
	const result = render(EnvEditor, {
		props: { variable: variable(), scope: "project", ...props },
		events: {
			save: (e: CustomEvent) => onSave(e.detail),
			close: () => onClose(),
		},
	});
	return { ...result, onSave, onClose };
}

const keyField = () =>
	document.querySelector(".ee-input.mono") as HTMLInputElement;
const saveButton = () =>
	screen.getByRole("button", {
		name: /save|enregistrer/i,
	}) as HTMLButtonElement;
const error = () => document.querySelector(".ee-error")?.textContent ?? "";
const toggleNamed = (name: RegExp) => {
	const label = Array.from(document.querySelectorAll(".ee-toggle")).find((el) =>
		name.test(el.querySelector(".ee-toggle-name")?.textContent ?? ""),
	);
	return label?.querySelector("input") as HTMLInputElement | undefined;
};

async function typeKey(text: string) {
	const field = keyField();
	await userEvent.clear(field);
	if (text) await userEvent.type(field, text);
	await tick();
}

describe("EnvEditor", () => {
	describe("the key it accepts", () => {
		it("saves a POSIX-shaped name", async () => {
			const { onSave } = mount();
			await typeKey("API_TOKEN");
			await userEvent.click(saveButton());
			expect(onSave.mock.calls[0][0].variable.key).toBe("API_TOKEN");
		});

		it("accepts a leading underscore and digits after the first character", async () => {
			const { onSave } = mount();
			await typeKey("_A1_B2");
			expect(error()).toBe("");
			await userEvent.click(saveButton());
			expect(onSave.mock.calls[0][0].variable.key).toBe("_A1_B2");
		});

		it("refuses a name starting with a digit", async () => {
			mount();
			await typeKey("1INVALID");
			expect(error()).not.toBe("");
			expect(saveButton().disabled).toBe(true);
		});

		it("refuses a name with a dash or a space", async () => {
			mount();
			for (const bad of ["MY-KEY", "MY KEY"]) {
				await typeKey(bad);
				expect(error(), bad).not.toBe("");
			}
		});

		/** The prefix is the app's own; letting a user shadow it would be silent. */
		it("refuses the reserved prefix, whatever its case", async () => {
			mount();
			for (const bad of [`${RESERVED_KEY_PREFIX}HOME`, "cairn_home"]) {
				await typeKey(bad);
				expect(error(), bad).not.toBe("");
				expect(saveButton().disabled, bad).toBe(true);
			}
		});

		it("distinguishes an invalid name from a reserved one", async () => {
			mount();
			await typeKey("1BAD");
			const invalid = error();
			await typeKey(`${RESERVED_KEY_PREFIX}BAD`);
			expect(error()).not.toBe(invalid);
		});

		/** An empty field is not yet a mistake, so it is not reported as one. */
		it("says nothing about an empty key, but refuses to save it", async () => {
			mount();
			await typeKey("");
			expect(error()).toBe("");
			expect(saveButton().disabled).toBe(true);
		});

		it("refuses a key that is only spaces", async () => {
			mount();
			await typeKey("   ");
			expect(saveButton().disabled).toBe(true);
		});

		it("trims what it saves", async () => {
			const { onSave } = mount();
			await typeKey("  TOKEN  ");
			await userEvent.click(saveButton());
			expect(onSave.mock.calls[0][0].variable.key).toBe("TOKEN");
		});

		it("clears the error once the key is fixed", async () => {
			mount();
			await typeKey("1BAD");
			expect(error()).not.toBe("");
			await typeKey("GOOD");
			expect(error()).toBe("");
			expect(saveButton().disabled).toBe(false);
		});
	});

	describe("the scope it saves into", () => {
		it("opens on the scope it was given", () => {
			mount({ scope: "global" });
			expect(document.querySelector(".step-count")?.textContent?.trim()).toBe(
				"Global",
			);
		});

		it("saves into the scope, unchanged, when nothing is picked", async () => {
			const { onSave } = mount({ scope: "global" });
			await userEvent.click(saveButton());
			expect(onSave.mock.calls[0][0].scope).toBe("global");
		});

		it("offers the instance scope only where there is an instance", async () => {
			mount({ canUseInstance: false });
			await userEvent.click(
				document.querySelector(".select-trigger") as HTMLElement,
			);
			const labels = screen
				.getAllByRole("option")
				.map((o) => o.textContent?.trim());
			expect(labels).toHaveLength(2);
			expect(labels.join(" ")).not.toMatch(/instance/i);
		});

		it("offers all three scopes where an instance exists", async () => {
			mount({ canUseInstance: true });
			await userEvent.click(
				document.querySelector(".select-trigger") as HTMLElement,
			);
			expect(screen.getAllByRole("option")).toHaveLength(3);
		});

		it("saves into the scope the user moved it to", async () => {
			const { onSave } = mount({ scope: "project" });
			await userEvent.click(
				document.querySelector(".select-trigger") as HTMLElement,
			);
			await userEvent.click(screen.getByRole("option", { name: /global/i }));
			await userEvent.click(saveButton());
			expect(onSave.mock.calls[0][0].scope).toBe("global");
		});
	});

	describe("per-instance overrides", () => {
		/** A variable already scoped to one instance cannot also vary by instance. */
		it("hides the per-instance choice in the instance scope", async () => {
			mount({ scope: "instance" });
			expect(toggleNamed(/instance/i)).toBeUndefined();
		});

		it("offers it in the project and global scopes", () => {
			mount({ scope: "project" });
			expect(toggleNamed(/instance/i)).toBeDefined();
		});

		it("drops the flag when the variable is moved into the instance scope", async () => {
			const { onSave } = mount({
				scope: "project",
				variable: variable({ perInstance: true }),
			});
			await userEvent.click(
				document.querySelector(".select-trigger") as HTMLElement,
			);
			await userEvent.click(screen.getByRole("option", { name: /instance/i }));
			await userEvent.click(saveButton());
			expect(onSave.mock.calls[0][0].variable.perInstance).toBe(false);
		});

		/** A per-instance variable has no shared value, only a default to prefill. */
		it("swaps the value field for a default once the flag is on", async () => {
			const { onSave } = mount({ scope: "project" });
			expect(document.querySelector("textarea")).not.toBeNull();
			await userEvent.click(toggleNamed(/instance/i) as HTMLElement);
			expect(document.querySelector("textarea")).toBeNull();

			const fields = Array.from(
				document.querySelectorAll<HTMLElement>(".ee-field .ee-label"),
			).map((el) => el.textContent?.trim());
			expect(fields.some((f) => /default|défaut/i.test(f ?? ""))).toBe(true);
			await userEvent.click(saveButton());
			expect(onSave.mock.calls[0][0].variable.perInstance).toBe(true);
		});

		it("keeps the value field when the flag is off", () => {
			mount({ scope: "project", variable: variable({ perInstance: false }) });
			expect(document.querySelector("textarea")).not.toBeNull();
		});
	});

	describe("secret values", () => {
		it("masks the value of a variable already marked secret", () => {
			mount({ variable: variable({ secret: true }) });
			expect(document.querySelector('input[type="password"]')).not.toBeNull();
			expect(document.querySelector("textarea")).toBeNull();
		});

		it("shows the value of an ordinary variable", () => {
			mount({ variable: variable({ secret: false }) });
			expect(document.querySelector('input[type="password"]')).toBeNull();
		});

		it("reveals a masked value on request, and hides it again", async () => {
			mount({ variable: variable({ secret: true }) });
			const reveal = document.querySelector(".ee-reveal") as HTMLElement;
			await userEvent.click(reveal);
			expect(document.querySelector('input[type="password"]')).toBeNull();
			await userEvent.click(
				document.querySelector(".ee-reveal") as HTMLElement,
			);
			expect(document.querySelector('input[type="password"]')).not.toBeNull();
		});

		it("names the reveal button for a screen reader", () => {
			mount({ variable: variable({ secret: true }) });
			expect(
				(document.querySelector(".ee-reveal") as HTMLElement).getAttribute(
					"aria-label",
				),
			).toBeTruthy();
		});

		it("saves the secret flag the user set", async () => {
			const { onSave } = mount({ variable: variable({ secret: false }) });
			await userEvent.click(toggleNamed(/secret/i) as HTMLElement);
			await userEvent.click(saveButton());
			expect(onSave.mock.calls[0][0].variable.secret).toBe(true);
		});
	});

	describe("saving and cancelling", () => {
		it("edits a copy, so cancelling changes nothing", async () => {
			const original = variable();
			const { onClose } = mount({ variable: original });
			await typeKey("CHANGED");
			await userEvent.click(
				screen.getByRole("button", { name: /cancel|annuler/i }),
			);
			expect(onClose).toHaveBeenCalled();
			expect(original.key).toBe("DATABASE_URL");
		});

		it("refuses to save an invalid key even if the button is forced", async () => {
			const { onSave } = mount();
			await typeKey("1BAD");
			saveButton().disabled = false;
			await userEvent.click(saveButton());
			expect(onSave).not.toHaveBeenCalled();
		});

		it("closes on Escape", async () => {
			const { onClose } = mount();
			await userEvent.type(screen.getByRole("dialog"), "{Escape}");
			expect(onClose).toHaveBeenCalled();
		});

		it("closes on a click on the backdrop", async () => {
			const { onClose } = mount();
			await userEvent.click(screen.getByRole("dialog"));
			expect(onClose).toHaveBeenCalled();
		});

		/** A click inside the form is not a click away from it. */
		it("stays open on a click inside the form", async () => {
			const { onClose } = mount();
			await userEvent.click(keyField());
			expect(onClose).not.toHaveBeenCalled();
		});

		it("keeps the other fields of the variable it was given", async () => {
			const { onSave } = mount({
				variable: variable({ id: "keep-me", enabled: false }),
			});
			await userEvent.click(saveButton());
			expect(onSave.mock.calls[0][0].variable).toMatchObject({
				id: "keep-me",
				enabled: false,
			});
		});
	});
});
