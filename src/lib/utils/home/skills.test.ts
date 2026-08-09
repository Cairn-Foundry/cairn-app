import { describe, expect, it } from "vitest";
import { slugifySkill } from "./skills";

describe("slugifySkill", () => {
	it("turns a written name into the directory that answers to it", () => {
		expect(slugifySkill("My Great Skill")).toBe("my-great-skill");
	});

	it("collapses anything that could not be typed after a slash", () => {
		expect(slugifySkill("  Réview! (v2)  ")).toBe("r-view-v2");
	});

	it("never ends on a separator, whatever the name ends with", () => {
		expect(slugifySkill("commit --amend")).toBe("commit-amend");
		expect(slugifySkill("---")).toBe("");
	});
});
