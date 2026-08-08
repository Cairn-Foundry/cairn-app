import { describe, expect, it } from "vitest";
import { groupModelFamilies } from "./model-families";

const model = (id: string) => ({ id, label: id });

describe("groupModelFamilies", () => {
	it("puts an alias and its dated releases in the same family", () => {
		const families = groupModelFamilies([
			model("opus"),
			model("claude-opus-4-5-20251101"),
			model("claude-opus-4-1-20250805"),
			model("sonnet"),
		]);
		expect(families.map((f) => f.key)).toEqual(["opus", "sonnet"]);
		expect(families[0].models.map((m) => m.id)).toEqual([
			"opus",
			"claude-opus-4-5-20251101",
			"claude-opus-4-1-20250805",
		]);
	});

	it("keeps the vendor word when it is not shared by every id", () => {
		const families = groupModelFamilies([
			model("mistral-large-latest"),
			model("codestral-latest"),
		]);
		expect(families.map((f) => f.key)).toEqual(["mistral-large", "codestral"]);
	});

	it("groups variants of one family together", () => {
		const families = groupModelFamilies([
			model("gpt-5.1"),
			model("gpt-5"),
			model("gpt-4.1"),
		]);
		expect(families).toHaveLength(1);
		expect(families[0].models.map((m) => m.id)).toEqual([
			"gpt-5.1",
			"gpt-5",
			"gpt-4.1",
		]);
	});

	it("labels a family from its own name", () => {
		const [family] = groupModelFamilies([model("claude-haiku-4-5")]);
		expect(family.label).toBe("Claude Haiku");
	});
});
