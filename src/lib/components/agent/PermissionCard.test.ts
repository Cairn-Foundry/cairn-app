import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PendingPermission } from "$lib/utils/agent/permission-response";
import PermissionCard from "./PermissionCard.svelte";

function request(
	overrides: Partial<PendingPermission> = {},
): PendingPermission {
	return {
		runId: "run-1",
		requestId: "req-1",
		toolName: "Bash",
		input: { command: "rm -rf build" },
		...overrides,
	};
}

function mount(props: Record<string, unknown> = {}) {
	const onAnswer = vi.fn();
	const result = render(PermissionCard, {
		request: request(),
		onAnswer,
		renderMarkdown: (source: string) => source,
		...props,
	});
	return { ...result, onAnswer };
}

const buttonNamed = (name: RegExp) => screen.getByRole("button", { name });
const buttons = () =>
	screen.getAllByRole("button").map((b) => b.textContent?.trim() ?? "");
const preview = () =>
	document.querySelector(".permission-preview")?.textContent ?? null;

describe("PermissionCard", () => {
	describe("what it asks about", () => {
		it("names the tool that is asking", () => {
			mount({ request: request({ toolName: "WebFetch" }) });
			expect(document.querySelector(".permission-head")?.textContent).toContain(
				"WebFetch",
			);
		});

		it("prefers the display name where the provider gave one", () => {
			mount({
				request: request({ toolName: "Bash", displayName: "Run command" }),
			});
			const head =
				document.querySelector(".permission-head")?.textContent ?? "";
			expect(head).toContain("Run command");
			expect(head).not.toContain("Bash");
		});

		it("says which agent is asking, when one is named", () => {
			mount({ agentName: "argus" });
			expect(document.querySelector(".permission-who")?.textContent).toBe(
				"argus",
			);
		});

		it("says nothing about an agent when none is named", () => {
			mount();
			expect(document.querySelector(".permission-who")).toBeNull();
		});

		it("shows the description the provider supplied", () => {
			mount({ request: request({ description: "Delete the build folder" }) });
			expect(document.querySelector(".permission-desc")?.textContent).toBe(
				"Delete the build folder",
			);
		});
	});

	describe("the value the decision turns on", () => {
		/**
		 * The preview is the one thing the user reads before allowing: it must be
		 * the value that actually decides, whichever key the tool used for it.
		 */
		it("shows the command, the path, the url or the pattern", () => {
			const cases: [Record<string, unknown>, string][] = [
				[{ command: "rm -rf /" }, "rm -rf /"],
				[{ file_path: "/etc/passwd" }, "/etc/passwd"],
				[{ path: "/srv/data" }, "/srv/data"],
				[{ url: "https://example.com" }, "https://example.com"],
				[{ pattern: "**/*.key" }, "**/*.key"],
			];
			for (const [input, expected] of cases) {
				const { unmount } = mount({ request: request({ input }) });
				expect(preview(), JSON.stringify(input)).toBe(expected);
				unmount();
			}
		});

		it("prefers the command when a tool carries several of them", () => {
			mount({
				request: request({ input: { command: "ls", file_path: "/tmp/x" } }),
			});
			expect(preview()).toBe("ls");
		});

		it("shows nothing rather than a stringified object", () => {
			mount({ request: request({ input: { command: { nested: true } } }) });
			expect(preview()).toBeNull();
		});

		it("shows nothing when the tool has no such value", () => {
			mount({ request: request({ input: { dry_run: true } }) });
			expect(preview()).toBeNull();
		});

		it("shows the value as it is, without interpreting it", () => {
			const raw = "echo '<script>' && rm -rf $HOME";
			mount({ request: request({ input: { command: raw } }) });
			expect(preview()).toBe(raw);
		});
	});

	describe("answering an ordinary tool call", () => {
		it("allows", async () => {
			const { onAnswer } = mount();
			await userEvent.click(buttonNamed(/^allow|autoriser/i));
			expect(onAnswer).toHaveBeenCalledWith("allow");
		});

		it("denies", async () => {
			const { onAnswer } = mount();
			await userEvent.click(buttonNamed(/deny|refuser/i));
			expect(onAnswer).toHaveBeenCalledWith("deny");
		});

		/**
		 * Widening a permission for good is only offered where the provider
		 * proposed the rule to widen it with; nothing is invented here.
		 */
		it("offers to always allow only when the provider suggested a rule", async () => {
			mount({ request: request({ suggestions: [{ rule: "Bash(ls:*)" }] }) });
			expect(buttons().join(" ")).toMatch(/always|toujours/i);
		});

		it("does not offer it without a suggestion", () => {
			mount({ request: request({ suggestions: [] }) });
			expect(buttons().join(" ")).not.toMatch(/always|toujours/i);
		});

		it("does not offer it when suggestions are absent altogether", () => {
			mount({ request: request({ suggestions: undefined }) });
			expect(buttons().join(" ")).not.toMatch(/always|toujours/i);
		});

		it("reports the widened decision distinctly from a one-off allow", async () => {
			const { onAnswer } = mount({
				request: request({ suggestions: [{ rule: "Bash(ls:*)" }] }),
			});
			await userEvent.click(buttonNamed(/always|toujours/i));
			expect(onAnswer).toHaveBeenCalledWith("always");
		});

		it("answers once per click, and only for the button clicked", async () => {
			const { onAnswer } = mount();
			await userEvent.click(buttonNamed(/^allow|autoriser/i));
			expect(onAnswer).toHaveBeenCalledTimes(1);
		});
	});

	describe("a plan waiting for approval", () => {
		const plan = () =>
			request({ toolName: "ExitPlanMode", input: { plan: "# Step one" } });

		it("reads as a plan rather than a tool prompt", () => {
			mount({ request: plan() });
			expect(
				document.querySelector(".permission-card")?.classList.contains("plan"),
			).toBe(true);
			expect(document.querySelector(".permission-plan")).not.toBeNull();
		});

		it("renders the plan through the markdown renderer it was given", () => {
			const renderMarkdown = vi.fn(() => "<p>rendered</p>");
			mount({ request: plan(), renderMarkdown });
			expect(renderMarkdown).toHaveBeenCalledWith("# Step one");
			expect(document.querySelector(".permission-plan")?.textContent).toContain(
				"rendered",
			);
		});

		it("renders an empty plan rather than the word undefined", () => {
			const renderMarkdown = vi.fn((s: string) => s);
			mount({
				request: request({ toolName: "ExitPlanMode", input: {} }),
				renderMarkdown,
			});
			expect(renderMarkdown).toHaveBeenCalledWith("");
		});

		it("approves the plan", async () => {
			const { onAnswer } = mount({ request: plan() });
			await userEvent.click(buttonNamed(/approve|approuver/i));
			expect(onAnswer).toHaveBeenCalledWith("allow");
		});

		/** Refusing a plan sends the agent back to planning, it does not deny a tool. */
		it("sends the agent back to planning", async () => {
			const { onAnswer } = mount({ request: plan() });
			const back = screen
				.getAllByRole("button")
				.find((b) => !/approve|approuver/i.test(b.textContent ?? ""));
			await userEvent.click(back as HTMLElement);
			expect(onAnswer).toHaveBeenCalledWith("deny");
		});

		/** A plan is approved or not; there is nothing to widen for ever. */
		it("never offers to always allow, even with suggestions", () => {
			mount({
				request: request({
					toolName: "ExitPlanMode",
					input: { plan: "x" },
					suggestions: [{ rule: "anything" }],
				}),
			});
			expect(buttons().join(" ")).not.toMatch(/always|toujours/i);
			expect(screen.getAllByRole("button")).toHaveLength(2);
		});

		it("shows no command preview for a plan", () => {
			mount({
				request: request({
					toolName: "ExitPlanMode",
					input: { plan: "x", command: "rm -rf /" },
				}),
			});
			expect(preview()).toBeNull();
		});
	});
});
