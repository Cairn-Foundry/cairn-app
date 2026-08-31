// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

const validateDirectory = vi.fn<(...a: unknown[]) => Promise<string>>(
	async (p) => p as string,
);
const cloneRepository = vi.fn(async (..._a: unknown[]) => "/cloned/repo");
vi.mock("$lib/services/project-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	validateDirectory: (...a: unknown[]) => validateDirectory(...a),
	cloneRepository: (...a: unknown[]) => cloneRepository(...a),
}));

const getRemoteUrl = vi.fn(async (..._a: unknown[]) => "");
vi.mock("$lib/services/git-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	getRemoteUrl: (...a: unknown[]) => getRemoteUrl(...a),
}));

const registerProject = vi.fn(async (..._a: unknown[]) => {});
vi.mock("$lib/stores/project", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	registerProject: (...a: unknown[]) => registerProject(...a),
}));

const saveProjectIntegrations = vi.fn(async (..._a: unknown[]) => {});
vi.mock("$lib/stores/integrations", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	saveProjectIntegrations: (...a: unknown[]) => saveProjectIntegrations(...a),
	loadConnections: vi.fn(async (..._a: unknown[]) => {}),
	loadKinds: vi.fn(async (..._a: unknown[]) => {}),
}));

const openDialog = vi.fn(async (..._a: unknown[]) => "/picked/folder");
vi.mock("@tauri-apps/plugin-dialog", () => ({
	open: (...a: unknown[]) => openDialog(...a),
}));

const { projects } = await import("$lib/stores/project");
const { project } = await import("./fixtures");
const { default: AddProject } = await import(
	"$lib/components/AddProject.svelte"
);

function mount(props: Record<string, unknown> = {}) {
	const onCreated = vi.fn((..._a: unknown[]) => undefined);
	const onClose = vi.fn((..._a: unknown[]) => undefined);
	render(AddProject, {
		props: { mode: "new", ...props },
		events: {
			created: (e: CustomEvent) => onCreated(e.detail),
			close: () => onClose(),
		},
	});
	return { onCreated, onClose };
}

const primary = () =>
	document.querySelector(".modal-foot .btn.primary") as HTMLButtonElement;
const backButton = () =>
	document.querySelector(".modal-foot .btn.ghost") as HTMLButtonElement;
const stepCount = () =>
	document.querySelector(".step-count")?.textContent?.trim() ?? "";
const heading = () => document.querySelector("h3")?.textContent?.trim() ?? "";
const dots = () =>
	Array.from(document.querySelectorAll(".step-dots span")).map(
		(d) => d.className,
	);
const field = (id: string) =>
	document.getElementById(id) as HTMLInputElement | null;
const pathField = () =>
	document.querySelector(".ap-input.mono") as HTMLInputElement;
const errorText = () => document.querySelector(".ap-error")?.textContent ?? "";
const backdrop = () => document.querySelector(".modal-backdrop") as HTMLElement;

async function settle() {
	await tick();
	await tick();
	await tick();
}

async function fill(input: HTMLInputElement, value: string) {
	await userEvent.clear(input);
	await userEvent.type(input, value);
}

/** Walks the wizard forward, filling each step the way the user would. */
async function advance() {
	await userEvent.click(primary());
	await settle();
}

beforeEach(() => {
	validateDirectory.mockReset().mockImplementation(async (p) => p as string);
	cloneRepository.mockReset().mockResolvedValue("/cloned/repo");
	getRemoteUrl.mockReset().mockResolvedValue("");
	registerProject.mockReset().mockResolvedValue(undefined);
	saveProjectIntegrations.mockReset().mockResolvedValue(undefined);
	openDialog.mockReset().mockResolvedValue("/picked/folder");
	projects.set([]);
});

describe("AddProject", () => {
	describe("the steps of each mode", () => {
		it("names the project before asking where it goes", () => {
			mount({ mode: "new" });
			expect(field("new-name")).not.toBeNull();
			expect(stepCount()).toContain("1");
		});

		/** Opening an existing folder starts from the folder itself. */
		it("asks for the folder first when opening one", () => {
			mount({ mode: "open" });
			expect(field("open-name")).toBeNull();
			expect(document.querySelector(".dir-btn")).not.toBeNull();
		});

		it("asks for the repository first when cloning", () => {
			mount({ mode: "clone" });
			expect(field("clone-url")).not.toBeNull();
		});

		it("walks a new project through three steps", async () => {
			mount({ mode: "new" });
			expect(stepCount()).toMatch(/1.*3|3/);
			expect(dots()).toHaveLength(3);
		});

		it("walks a clone through four steps", () => {
			mount({ mode: "clone" });
			expect(dots()).toHaveLength(4);
		});

		it("moves to the next step once it can", async () => {
			mount({ mode: "new" });
			await fill(field("new-name") as HTMLInputElement, "Cairn");
			await advance();
			expect(field("new-name")).toBeNull();
			expect(dots()[1]).toBe("active");
		});

		it("goes back to the step before", async () => {
			mount({ mode: "new" });
			await fill(field("new-name") as HTMLInputElement, "Cairn");
			await advance();
			await userEvent.click(backButton());
			await settle();
			expect((field("new-name") as HTMLInputElement).value).toBe("Cairn");
		});

		it("offers no way back from the first step", () => {
			mount({ mode: "new" });
			expect(backButton()).toBeNull();
		});

		/** The heading names the step, not the mode. */
		it("retitles itself at each step", async () => {
			mount({ mode: "new" });
			const first = heading();
			await fill(field("new-name") as HTMLInputElement, "Cairn");
			await advance();
			expect(heading()).not.toBe(first);
		});
	});

	describe("what each step requires", () => {
		it("refuses to go on without a name", () => {
			mount({ mode: "new" });
			expect(primary().disabled).toBe(true);
		});

		it("refuses a name of spaces only", async () => {
			mount({ mode: "new" });
			await fill(field("new-name") as HTMLInputElement, "   ");
			expect(primary().disabled).toBe(true);
		});

		it("goes on once a name is typed", async () => {
			mount({ mode: "new" });
			await fill(field("new-name") as HTMLInputElement, "Cairn");
			expect(primary().disabled).toBe(false);
		});

		it("refuses to open a folder that was not chosen", () => {
			mount({ mode: "open" });
			expect(primary().disabled).toBe(true);
		});

		it("refuses to clone without a repository url", () => {
			mount({ mode: "clone" });
			expect(primary().disabled).toBe(true);
		});

		/** The integrations step is optional, so it never blocks. */
		it("lets the integrations step be skipped", async () => {
			mount({ mode: "new" });
			await fill(field("new-name") as HTMLInputElement, "Cairn");
			await advance();
			expect(primary().disabled).toBe(false);
		});

		it("refuses to finish a new project with no folder", async () => {
			mount({ mode: "new" });
			await fill(field("new-name") as HTMLInputElement, "Cairn");
			await advance();
			await advance();
			expect(primary().disabled).toBe(true);
		});
	});

	describe("filling the name in for the user", () => {
		it("takes the name from the folder that was picked", async () => {
			mount({ mode: "open" });
			await userEvent.click(document.querySelector(".dir-btn") as HTMLElement);
			await settle();
			await advance();
			expect((field("open-name") as HTMLInputElement).value).toBe("folder");
		});

		it("takes the name from an initial path", () => {
			mount({ mode: "open", initialPath: "/some/where/my-repo" });
			expect(pathField().value).toBe("/some/where/my-repo");
		});

		it("takes the name from an initial clone url", async () => {
			mount({ mode: "clone", initialCloneUrl: "git@host:team/my-repo.git" });
			await advance();
			expect((field("clone-name") as HTMLInputElement).value).toBe("my-repo");
		});

		/** A name the user typed is never overwritten by a guess. */
		it("leaves a name the user typed alone", async () => {
			mount({ mode: "open" });
			await userEvent.click(document.querySelector(".dir-btn") as HTMLElement);
			await settle();
			await advance();
			await fill(field("open-name") as HTMLInputElement, "Mine");
			await userEvent.click(backButton());
			await settle();
			await userEvent.click(document.querySelector(".dir-btn") as HTMLElement);
			await settle();
			await advance();
			expect((field("open-name") as HTMLInputElement).value).toBe("Mine");
		});
	});

	describe("registering the project", () => {
		async function completeNew(name = "Cairn") {
			const result = mount({ mode: "new" });
			await fill(field("new-name") as HTMLInputElement, name);
			await advance();
			await advance();
			await fill(pathField(), "/repos/cairn");
			await userEvent.click(primary());
			await settle();
			return result;
		}

		it("registers the project at the folder it validated", async () => {
			await completeNew();
			expect(validateDirectory).toHaveBeenCalledWith("/repos/cairn");
			expect(registerProject).toHaveBeenCalledTimes(1);
			expect(registerProject.mock.calls[0][0]).toMatchObject({
				name: "Cairn",
				path: "/repos/cairn",
			});
		});

		it("registers the name trimmed", async () => {
			await completeNew("  Cairn  ");
			expect(registerProject.mock.calls[0][0]).toMatchObject({
				name: "Cairn",
			});
		});

		it("reports the project it created", async () => {
			const { onCreated } = await completeNew();
			expect(onCreated).toHaveBeenCalledTimes(1);
			expect((onCreated.mock.calls[0][0] as { id: string }).id).toBe(
				(registerProject.mock.calls[0][0] as unknown as { id: string }).id,
			);
		});

		/** The path the validation resolved is what is registered, not the typed one. */
		it("registers the resolved path, not the typed one", async () => {
			validateDirectory.mockResolvedValue("/real/repos/cairn");
			await completeNew();
			expect(registerProject.mock.calls[0][0]).toMatchObject({
				path: "/real/repos/cairn",
			});
		});

		/** A folder already registered is a mistake worth naming. */
		it("refuses a folder another project already uses", async () => {
			projects.set([project("p1", { name: "Existing", path: "/repos/cairn" })]);
			const { onCreated } = await completeNew();
			expect(registerProject).not.toHaveBeenCalled();
			expect(onCreated).not.toHaveBeenCalled();
			expect(errorText()).toContain("Existing");
		});

		it("reports a folder that could not be validated", async () => {
			validateDirectory.mockRejectedValue(new Error("not a directory"));
			const { onCreated } = await completeNew();
			expect(errorText()).toContain("not a directory");
			expect(onCreated).not.toHaveBeenCalled();
		});

		it("stays usable after a failure", async () => {
			validateDirectory.mockRejectedValue(new Error("nope"));
			await completeNew();
			expect(primary().disabled).toBe(false);
		});

		it("saves no integrations when none were bound", async () => {
			await completeNew();
			expect(saveProjectIntegrations).not.toHaveBeenCalled();
		});
	});

	describe("cloning", () => {
		async function completeClone() {
			const result = mount({ mode: "clone" });
			await fill(field("clone-url") as HTMLInputElement, "https://host/r.git");
			await advance();
			await fill(field("clone-name") as HTMLInputElement, "Repo");
			await advance();
			await advance();
			await fill(pathField(), "/repos");
			await userEvent.click(primary());
			await settle();
			return result;
		}

		it("clones into the chosen destination before registering", async () => {
			await completeClone();
			expect(cloneRepository).toHaveBeenCalledWith(
				"https://host/r.git",
				"/repos",
				"Repo",
			);
			expect(registerProject.mock.calls[0][0]).toMatchObject({
				path: "/cloned/repo",
			});
		});

		it("validates nothing when cloning", async () => {
			await completeClone();
			expect(validateDirectory).not.toHaveBeenCalled();
		});

		it("reports a clone that failed", async () => {
			cloneRepository.mockRejectedValue(new Error("auth failed"));
			const { onCreated } = await completeClone();
			expect(errorText()).toContain("auth failed");
			expect(onCreated).not.toHaveBeenCalled();
		});

		it("offers both protocols for the repository url", async () => {
			mount({ mode: "clone" });
			const buttons = Array.from(
				document.querySelectorAll<HTMLElement>(".method-btn"),
			);
			expect(buttons).toHaveLength(2);
			await userEvent.click(buttons[1]);
			expect(buttons[1].classList.contains("active")).toBe(true);
			expect(buttons[0].classList.contains("active")).toBe(false);
		});
	});

	describe("the remote of an opened folder", () => {
		/** The integrations step needs the remote to guess the forge. */
		it("reads the remote of the folder being opened", async () => {
			mount({ mode: "open" });
			await fill(pathField(), "/repos/cairn");
			await advance();
			await settle();
			expect(getRemoteUrl).toHaveBeenCalledWith("/repos/cairn");
		});

		it("reads it once for the same folder", async () => {
			mount({ mode: "open" });
			await fill(pathField(), "/repos/cairn");
			await advance();
			await settle();
			await userEvent.click(backButton());
			await settle();
			await advance();
			await settle();
			expect(getRemoteUrl).toHaveBeenCalledTimes(1);
		});

		it("reads nothing when cloning, where the url is known", async () => {
			mount({ mode: "clone" });
			await fill(field("clone-url") as HTMLInputElement, "https://host/r.git");
			await advance();
			await settle();
			expect(getRemoteUrl).not.toHaveBeenCalled();
		});
	});

	describe("closing", () => {
		it("closes on the close button", async () => {
			const { onClose } = mount({ mode: "new" });
			await userEvent.click(
				document.querySelector(".icon-btn.close") as HTMLElement,
			);
			expect(onClose).toHaveBeenCalled();
		});

		it("closes on a click outside", async () => {
			const { onClose } = mount({ mode: "new" });
			await userEvent.click(backdrop());
			expect(onClose).toHaveBeenCalled();
		});

		it("stays open on a click inside", async () => {
			const { onClose } = mount({ mode: "new" });
			await userEvent.click(document.querySelector(".modal") as HTMLElement);
			expect(onClose).not.toHaveBeenCalled();
		});

		it("closes on Escape", async () => {
			const { onClose } = mount({ mode: "new" });
			backdrop().dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			);
			expect(onClose).toHaveBeenCalled();
		});
	});

	describe("the keyboard", () => {
		it("goes to the next step on Enter", async () => {
			mount({ mode: "new" });
			await fill(field("new-name") as HTMLInputElement, "Cairn");
			backdrop().dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			);
			await settle();
			expect(field("new-name")).toBeNull();
		});

		it("does nothing on Enter while the step is incomplete", async () => {
			mount({ mode: "new" });
			backdrop().dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			);
			await settle();
			expect(field("new-name")).not.toBeNull();
		});

		/** On the last step Enter submits rather than trying to go further. */
		it("registers the project on Enter at the last step", async () => {
			mount({ mode: "new" });
			await fill(field("new-name") as HTMLInputElement, "Cairn");
			await advance();
			await advance();
			await fill(pathField(), "/repos/cairn");
			backdrop().dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			);
			await settle();
			expect(registerProject).toHaveBeenCalledTimes(1);
		});
	});
});
