// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Skill } from "$lib/services/skill-service";

const saveSkill = vi.fn<(...a: unknown[]) => unknown>();
const deleteSkill = vi.fn<(...a: unknown[]) => unknown>();
const duplicateSkill = vi.fn<(...a: unknown[]) => unknown>();
const addSkillResources = vi.fn<(...a: unknown[]) => unknown>();
const deleteSkillResource = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/services/skill-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	saveSkill: (...a: unknown[]) => saveSkill(...a),
	deleteSkill: (...a: unknown[]) => deleteSkill(...a),
	duplicateSkill: (...a: unknown[]) => duplicateSkill(...a),
	addSkillResources: (...a: unknown[]) => addSkillResources(...a),
	deleteSkillResource: (...a: unknown[]) => deleteSkillResource(...a),
}));

const revealInFileManager = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/services/file-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	revealInFileManager: (...a: unknown[]) => revealInFileManager(...a),
}));

const reachedProviders = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/services/cli-provider-service", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	reachedProviders: (...a: unknown[]) => reachedProviders(...a),
}));

const skillsStore = writable<Skill[]>([]);
const skillsError = writable("");
const skillsLoading = writable(false);
const loadSkills = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/stores/skills", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	skills: { subscribe: skillsStore.subscribe },
	skillsError: { subscribe: skillsError.subscribe },
	skillsLoading: { subscribe: skillsLoading.subscribe },
	loadSkills: (...a: unknown[]) => loadSkills(...a),
}));

const cliProviders = writable<{ id: string; label: string }[]>([]);
const loadCliProviders = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/stores/cli-providers", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	cliProviders: { subscribe: cliProviders.subscribe },
	loadCliProviders: (...a: unknown[]) => loadCliProviders(...a),
}));

const loadProjects = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("$lib/stores/project", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	loadProjects: (...a: unknown[]) => loadProjects(...a),
}));

const openDialog = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("@tauri-apps/plugin-dialog", () => ({
	open: (...a: unknown[]) => openDialog(...a),
}));

const { projects } = await import("$lib/stores/project");
const { project } = await import("./fixtures");
const { default: SkillsSection } = await import(
	"$lib/components/home/skills/SkillsSection.svelte"
);

function skill(overrides: Partial<Skill> = {}): Skill {
	return {
		id: "review",
		name: "review",
		description: "Reviews code",
		whenToUse: "",
		allowedTools: [],
		paths: "",
		model: "",
		license: "",
		disableModelInvocation: false,
		extraFrontmatter: "",
		body: "# Review\n",
		scope: "global",
		projectId: "",
		projectName: "",
		plugin: "",
		path: "/skills/review/SKILL.md",
		locations: [{ path: "/skills/review/SKILL.md" }],
		providers: ["claude-code"],
		divergent: false,
		readOnly: false,
		resources: [],
		...overrides,
	} as Skill;
}

function mount() {
	render(SkillsSection, { props: {} });
}

const items = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".ag-item"));
const itemNames = () =>
	items().map((i) => i.querySelector(".ag-item-name")?.textContent?.trim());
const itemFor = (name: string) =>
	items().find((i) =>
		i.querySelector(".ag-item-name")?.textContent?.includes(name),
	) as HTMLElement;
const nameField = () =>
	document.querySelector(".name-input") as HTMLInputElement;
const descriptionField = () =>
	document.getElementById("sk-desc") as HTMLTextAreaElement;
const saveButton = () =>
	document.querySelector(".save-bar .btn.primary") as HTMLButtonElement;
const revertButton = () =>
	document.querySelector(".save-bar .btn.ghost") as HTMLButtonElement;
const searchField = () =>
	document.querySelector(".ag-master input") as HTMLInputElement;
const chips = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".filters .chip"));
const chipBy = (re: RegExp) =>
	chips().find((c) => re.test(c.textContent ?? "")) as HTMLElement;
const toolChips = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".tool-chip code")).map(
		(c) => c.textContent,
	);
const banners = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".banner")).map(
		(b) => b.textContent ?? "",
	);
const resources = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".resource"));
const savedPayload = () =>
	saveSkill.mock.calls[0]?.[0] as Record<string, unknown>;

async function settle() {
	for (let i = 0; i < 10; i++) await tick();
}

beforeEach(() => {
	saveSkill.mockReset().mockResolvedValue(["/skills/review/SKILL.md"]);
	deleteSkill.mockReset().mockResolvedValue(undefined);
	duplicateSkill.mockReset().mockResolvedValue("/skills/review-copy/SKILL.md");
	addSkillResources.mockReset().mockResolvedValue(undefined);
	deleteSkillResource.mockReset().mockResolvedValue(undefined);
	revealInFileManager.mockReset().mockResolvedValue(undefined);
	reachedProviders.mockReset().mockResolvedValue(["claude-code"]);
	loadSkills.mockReset().mockResolvedValue(undefined);
	loadCliProviders.mockReset().mockResolvedValue(undefined);
	loadProjects.mockReset().mockResolvedValue(undefined);
	openDialog.mockReset().mockResolvedValue(["/tmp/notes.md"]);
	skillsError.set("");
	skillsLoading.set(false);
	cliProviders.set([{ id: "claude-code", label: "Claude Code" }]);
	projects.set([project("p1")]);
	skillsStore.set([skill()]);
});

describe("SkillsSection", () => {
	describe("the list", () => {
		it("loads the skills on open", async () => {
			mount();
			await settle();
			expect(loadSkills).toHaveBeenCalled();
		});

		it("lists every skill it found", async () => {
			skillsStore.set([
				skill({ path: "/a", name: "review" }),
				skill({ path: "/b", name: "deploy" }),
			]);
			mount();
			await settle();
			expect(itemNames()).toHaveLength(2);
		});

		/** The first editable skill opens on its own, not a read-only one. */
		it("opens an editable skill rather than a read-only one", async () => {
			skillsStore.set([
				skill({ path: "/a", name: "locked", readOnly: true }),
				skill({ path: "/b", name: "mine" }),
			]);
			mount();
			await settle();
			expect(nameField().value).toBe("mine");
		});

		it("opens a read-only skill when it is the only one", async () => {
			skillsStore.set([skill({ path: "/a", name: "locked", readOnly: true })]);
			mount();
			await settle();
			expect(nameField().value).toBe("locked");
		});

		it("opens the skill that was clicked", async () => {
			skillsStore.set([
				skill({ path: "/a", name: "review" }),
				skill({ path: "/b", name: "deploy" }),
			]);
			mount();
			await settle();
			await userEvent.click(itemFor("deploy"));
			await settle();
			expect(nameField().value).toBe("deploy");
		});

		it("keeps only the skills the search matched", async () => {
			skillsStore.set([
				skill({ path: "/a", name: "review" }),
				skill({ path: "/b", name: "deploy" }),
			]);
			mount();
			await settle();
			await userEvent.type(searchField(), "depl");
			await settle();
			expect(itemNames()).toHaveLength(1);
		});

		/** The description is searchable too, not only the name. */
		it("matches on the description", async () => {
			skillsStore.set([
				skill({ path: "/a", name: "review", description: "checks code" }),
				skill({ path: "/b", name: "deploy", description: "ships it" }),
			]);
			mount();
			await settle();
			await userEvent.type(searchField(), "ships");
			await settle();
			expect(itemNames()).toEqual(["deploy"]);
		});

		it("keeps only the skills of the chosen scope", async () => {
			skillsStore.set([
				skill({ path: "/a", name: "global-one", scope: "global" }),
				skill({
					path: "/b",
					name: "project-one",
					scope: "project",
					projectId: "p1",
				}),
			]);
			mount();
			await settle();
			await userEvent.click(chipBy(/project/i));
			await settle();
			expect(itemNames()).toEqual(["project-one"]);
		});

		it("counts the skills of each scope", async () => {
			skillsStore.set([
				skill({ path: "/a", scope: "global" }),
				skill({ path: "/b", scope: "global" }),
				skill({ path: "/c", scope: "project", projectId: "p1" }),
			]);
			mount();
			await settle();
			expect(chipBy(/all/i).textContent).toContain("3");
		});

		it("keeps only the skills of the chosen agent", async () => {
			cliProviders.set([
				{ id: "claude-code", label: "Claude Code" },
				{ id: "codex", label: "Codex" },
			]);
			skillsStore.set([
				skill({ path: "/a", name: "for-claude", providers: ["claude-code"] }),
				skill({ path: "/b", name: "for-codex", providers: ["codex"] }),
			]);
			mount();
			await settle();
			await userEvent.click(
				document.querySelector(
					'.filters.agents .chip[title="Codex"]',
				) as HTMLElement,
			);
			await settle();
			expect(itemNames()).toEqual(["for-codex"]);
		});

		it("says when nothing matched", async () => {
			mount();
			await settle();
			await userEvent.type(searchField(), "zzzz");
			await settle();
			expect(document.querySelector(".ag-master-empty")).not.toBeNull();
		});
	});

	describe("editing a draft", () => {
		/** The editor holds its own copy: nothing is written before Save. */
		it("writes nothing while the draft is edited", async () => {
			mount();
			await settle();
			await userEvent.type(nameField(), "-extra");
			await settle();
			expect(saveSkill).not.toHaveBeenCalled();
		});

		it("saves the edited draft", async () => {
			mount();
			await settle();
			await userEvent.clear(descriptionField());
			await userEvent.type(descriptionField(), "New description");
			await userEvent.click(saveButton());
			await settle();
			expect(savedPayload()).toMatchObject({
				name: "review",
				description: "New description",
			});
		});

		/** Reverting drops the edits and restores what is on disk. */
		it("drops the edits on revert", async () => {
			mount();
			await settle();
			await userEvent.clear(nameField());
			await userEvent.type(nameField(), "renamed");
			await userEvent.click(revertButton());
			await settle();
			expect(nameField().value).toBe("review");
			expect(saveSkill).not.toHaveBeenCalled();
		});

		it("refuses to save a skill with no name", async () => {
			mount();
			await settle();
			await userEvent.clear(nameField());
			await settle();
			expect(saveButton().disabled).toBe(true);
		});

		it("saves nothing unnamed even when the button is forced", async () => {
			mount();
			await settle();
			await userEvent.clear(nameField());
			await settle();
			saveButton().disabled = false;
			await userEvent.click(saveButton());
			await settle();
			expect(saveSkill).not.toHaveBeenCalled();
		});

		/** Two skills of the same scope cannot share a name. */
		it("refuses a name another skill of the same scope has", async () => {
			skillsStore.set([
				skill({ path: "/a", name: "review" }),
				skill({ path: "/b", name: "deploy" }),
			]);
			mount();
			await settle();
			await userEvent.click(itemFor("deploy"));
			await settle();
			await userEvent.clear(nameField());
			await userEvent.type(nameField(), "review");
			await settle();
			expect(saveButton().disabled).toBe(true);
			expect(document.querySelector(".ag-hint.bad")).not.toBeNull();
		});

		/** The same name in another scope is a different skill. */
		it("allows a name another scope already uses", async () => {
			skillsStore.set([
				skill({ path: "/a", name: "review", scope: "global" }),
				skill({
					path: "/b",
					name: "deploy",
					scope: "project",
					projectId: "p1",
				}),
			]);
			mount();
			await settle();
			await userEvent.click(itemFor("deploy"));
			await settle();
			await userEvent.clear(nameField());
			await userEvent.type(nameField(), "review");
			await settle();
			expect(saveButton().disabled).toBe(false);
		});

		it("says the description is too long", async () => {
			mount();
			await settle();
			await userEvent.clear(descriptionField());
			descriptionField().value = "x".repeat(2000);
			descriptionField().dispatchEvent(new Event("input", { bubbles: true }));
			await settle();
			expect(document.querySelector(".counter.bad")).not.toBeNull();
		});

		it("reports a save that failed", async () => {
			saveSkill.mockRejectedValue(new Error("read only volume"));
			mount();
			await settle();
			await userEvent.click(saveButton());
			await settle();
			expect(banners().join(" ")).toContain("read only volume");
		});

		/** A skill Cairn cannot write is shown as such and never saved. */
		it("says a read-only skill cannot be edited", async () => {
			skillsStore.set([skill({ readOnly: true })]);
			mount();
			await settle();
			expect(banners().join(" ")).not.toBe("");
			expect(nameField().disabled).toBe(true);
		});

		it("warns when the copies on disk have diverged", async () => {
			skillsStore.set([skill({ divergent: true })]);
			mount();
			await settle();
			expect(document.querySelector(".banner.warn")).not.toBeNull();
		});
	});

	describe("creating a skill", () => {
		it("starts a blank draft", async () => {
			mount();
			await settle();
			await userEvent.click(
				document.querySelector(
					'.master-actions .icon-btn[title="New skill"]',
				) as HTMLElement,
			);
			await settle();
			expect(nameField().value).toBe("");
		});

		/** A new skill defaults to the scope the list is filtered on. */
		it("defaults to the scope the list is filtered on", async () => {
			skillsStore.set([
				skill({ path: "/a", scope: "global" }),
				skill({
					path: "/b",
					name: "project-one",
					scope: "project",
					projectId: "p1",
				}),
			]);
			mount();
			await settle();
			await userEvent.click(chipBy(/project/i));
			await settle();
			await userEvent.click(
				document.querySelector(
					'.master-actions .icon-btn[title="New skill"]',
				) as HTMLElement,
			);
			await settle();
			await userEvent.type(nameField(), "fresh");
			await userEvent.click(saveButton());
			await settle();
			expect(savedPayload()).toMatchObject({ scope: "project" });
		});

		it("creates it at no previous location", async () => {
			mount();
			await settle();
			await userEvent.click(
				document.querySelector(
					'.master-actions .icon-btn[title="New skill"]',
				) as HTMLElement,
			);
			await settle();
			await userEvent.type(nameField(), "fresh");
			await userEvent.click(saveButton());
			await settle();
			expect(savedPayload()).toMatchObject({ originalPaths: [] });
		});

		/** Saving an existing skill tells the service where its copies were. */
		it("saves an existing skill over its own locations", async () => {
			mount();
			await settle();
			await userEvent.click(saveButton());
			await settle();
			expect(savedPayload()).toMatchObject({
				originalPaths: ["/skills/review/SKILL.md"],
			});
		});
	});

	describe("the allowed tools", () => {
		it("adds the tool that was typed", async () => {
			mount();
			await settle();
			const input = document.querySelector(
				'input[list="skill-tools"]',
			) as HTMLInputElement;
			await userEvent.type(input, "Bash{Enter}");
			await settle();
			expect(toolChips()).toEqual(["Bash"]);
		});

		/** A tool already listed is not added a second time. */
		it("adds a tool once", async () => {
			skillsStore.set([skill({ allowedTools: ["Bash", "Read"] })]);
			mount();
			await settle();
			const input = document.querySelector(
				'input[list="skill-tools"]',
			) as HTMLInputElement;
			await userEvent.type(input, "Bash{Enter}");
			await settle();
			expect(toolChips()).toEqual(["Bash", "Read"]);
			await userEvent.click(saveButton());
			await settle();
			expect(savedPayload()).toMatchObject({
				allowedTools: ["Bash", "Read"],
			});
		});

		it("adds no blank tool", async () => {
			mount();
			await settle();
			const input = document.querySelector(
				'input[list="skill-tools"]',
			) as HTMLInputElement;
			await userEvent.type(input, "   {Enter}");
			await settle();
			expect(toolChips()).toEqual([]);
		});

		it("removes the tool that was asked for", async () => {
			skillsStore.set([skill({ allowedTools: ["Bash", "Read"] })]);
			mount();
			await settle();
			await userEvent.click(
				document.querySelector(".tool-chip button") as HTMLElement,
			);
			await settle();
			expect(toolChips()).toEqual(["Read"]);
		});

		it("saves the tools it was given", async () => {
			skillsStore.set([skill({ allowedTools: ["Bash"] })]);
			mount();
			await settle();
			await userEvent.click(saveButton());
			await settle();
			expect(savedPayload()).toMatchObject({ allowedTools: ["Bash"] });
		});
	});

	describe("the bundled files", () => {
		it("lists the files a skill carries", async () => {
			skillsStore.set([
				skill({
					resources: [
						{ name: "notes.md", path: "/skills/review/notes.md", size: 2048 },
					] as Skill["resources"],
				}),
			]);
			mount();
			await settle();
			expect(resources()).toHaveLength(1);
			expect(resources()[0].textContent).toContain("2 KB");
		});

		it("says when a skill carries none", async () => {
			mount();
			await settle();
			expect(resources()).toHaveLength(0);
		});

		it("copies the files that were picked into the skill", async () => {
			mount();
			await settle();
			const add = Array.from(
				document.querySelectorAll<HTMLButtonElement>(".ag-card-head .btn"),
			).at(-1) as HTMLButtonElement;
			await userEvent.click(add);
			await settle();
			expect(addSkillResources).toHaveBeenCalledWith(
				"/skills/review/SKILL.md",
				["/tmp/notes.md"],
			);
		});

		it("removes the file that was asked for", async () => {
			skillsStore.set([
				skill({
					resources: [
						{ name: "notes.md", path: "/skills/review/notes.md", size: 10 },
					] as Skill["resources"],
				}),
			]);
			mount();
			await settle();
			await userEvent.click(
				resources()[0].querySelector(".icon-btn.delete") as HTMLElement,
			);
			await settle();
			expect(deleteSkillResource).toHaveBeenCalledWith(
				"/skills/review/SKILL.md",
				"/skills/review/notes.md",
			);
		});
	});

	describe("duplicating and deleting", () => {
		it("duplicates the open skill", async () => {
			mount();
			await settle();
			const duplicate = Array.from(
				document.querySelectorAll<HTMLElement>(".head-actions .btn.ghost"),
			)[0];
			await userEvent.click(duplicate);
			await settle();
			expect(duplicateSkill).toHaveBeenCalledWith(
				"/skills/review/SKILL.md",
				expect.stringContaining("review"),
			);
		});

		it("asks before deleting", async () => {
			mount();
			await settle();
			await userEvent.click(
				document.querySelector(".skill-row .icon-btn.delete") as HTMLElement,
			);
			await settle();
			expect(deleteSkill).not.toHaveBeenCalled();
			expect(document.querySelector(".modal-backdrop")).not.toBeNull();
		});

		/** Every copy on disk goes, not only the one that was opened. */
		it("deletes every copy of the skill", async () => {
			skillsStore.set([
				skill({
					locations: [
						{ path: "/skills/review/SKILL.md" },
						{ path: "/other/review/SKILL.md" },
					] as Skill["locations"],
				}),
			]);
			mount();
			await settle();
			await userEvent.click(
				document.querySelector(".skill-row .icon-btn.delete") as HTMLElement,
			);
			await settle();
			await userEvent.click(
				document.querySelector(".modal .btn.danger") as HTMLElement,
			);
			await settle();
			expect(deleteSkill).toHaveBeenCalledWith([
				"/skills/review/SKILL.md",
				"/other/review/SKILL.md",
			]);
		});

		it("offers no delete on a read-only skill", async () => {
			skillsStore.set([skill({ readOnly: true })]);
			mount();
			await settle();
			expect(document.querySelector(".skill-row .icon-btn.delete")).toBeNull();
		});
	});
});
