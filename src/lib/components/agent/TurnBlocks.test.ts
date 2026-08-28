import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AgentBlock } from "$lib/services/conversation-service";
import TurnBlocks from "./TurnBlocks.svelte";

function block(overrides: Partial<AgentBlock> = {}): AgentBlock {
	return { kind: "text", text: "", ...overrides } as AgentBlock;
}

function mount(props: Record<string, unknown> = {}) {
	const onOpenAgent = vi.fn();
	const result = render(TurnBlocks, {
		blocks: [],
		renderMarkdown: (source: string) => source,
		onOpenAgent,
		...props,
	});
	return { ...result, onOpenAgent };
}

const tools = () => Array.from(document.querySelectorAll<HTMLElement>(".tool"));
const toolName = (i: number) =>
	tools()[i].querySelector(".tool-name")?.textContent;
const toolArg = (i: number) =>
	tools()[i].querySelector(".tool-arg") as HTMLElement | null;
const answers = () =>
	Array.from(document.querySelectorAll(".answer")).map((a) => a.textContent);
const thinking = () => document.querySelector(".thinking-block");
const agentBlocks = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".agent-block"));

describe("TurnBlocks", () => {
	describe("tool calls", () => {
		/** "Bash: cd /tmp" reads as a tool and its argument, not one long line. */
		it("splits a tool line into its name and its argument", () => {
			mount({ blocks: [block({ kind: "tool", text: "Bash: cd /tmp" })] });
			expect(toolName(0)).toBe("Bash");
			expect(toolArg(0)?.textContent).toBe("cd /tmp");
		});

		it("shows a tool with no argument as a name alone", () => {
			mount({ blocks: [block({ kind: "tool", text: "Read" })] });
			expect(toolName(0)).toBe("Read");
			expect(toolArg(0)).toBeNull();
		});

		/** The shortened path is for reading; the whole one stays copyable. */
		it("shortens a known root but keeps the full path in the tooltip", () => {
			mount({
				blocks: [block({ kind: "tool", text: "Read: /repos/app/src/main.ts" })],
				roots: ["/repos/app"],
			});
			expect(toolArg(0)?.getAttribute("title")).toBe("/repos/app/src/main.ts");
			expect(toolArg(0)?.textContent).not.toBe("/repos/app/src/main.ts");
		});

		it("spins while a tool call is still running", () => {
			mount({ blocks: [block({ kind: "tool", text: "Bash: ls" })] });
			expect(tools()[0].querySelector(".spinner")).not.toBeNull();
		});

		it("shows the tool icon once it finished", () => {
			mount({
				blocks: [
					block({
						kind: "tool",
						text: "Bash: ls",
						done: true,
						icon: "terminal",
					}),
				],
			});
			expect(tools()[0].querySelector(".spinner")).toBeNull();
			expect(tools()[0].classList.contains("done")).toBe(true);
		});

		it("marks a tool call that failed", () => {
			mount({
				blocks: [
					block({ kind: "tool", text: "Bash: ls", done: true, failed: true }),
				],
			});
			expect(tools()[0].classList.contains("failed")).toBe(true);
			expect(tools()[0].querySelector(".ic-alert")).not.toBeNull();
		});
	});

	describe("the answer", () => {
		it("renders the text through the markdown renderer it was given", () => {
			const renderMarkdown = vi.fn(() => "<em>rendered</em>");
			mount({ blocks: [block({ text: "# hello" })], renderMarkdown });
			expect(renderMarkdown).toHaveBeenCalledWith(
				"# hello",
				expect.any(String),
			);
			expect(answers()).toEqual(["rendered"]);
		});

		/** The blocks are one stream: their order is the order they were written. */
		it("keeps the blocks in the order they arrived", () => {
			mount({
				blocks: [
					block({ text: "before" }),
					block({ kind: "tool", text: "Bash: ls" }),
					block({ text: "after" }),
				],
			});
			const rendered = Array.from(
				document.querySelectorAll(".answer, .tool"),
			).map((e) => e.className.split(" ")[0]);
			expect(rendered).toEqual(["answer", "tool", "answer"]);
			expect(answers()).toEqual(["before", "after"]);
		});
	});

	describe("reasoning", () => {
		it("shows the reasoning folded away", () => {
			mount({ blocks: [block({ kind: "thinking", text: "let me think" })] });
			expect(thinking()).not.toBeNull();
			expect(thinking()?.textContent).toContain("let me think");
		});

		it("hides it entirely when the setting is off", () => {
			mount({
				blocks: [block({ kind: "thinking", text: "let me think" })],
				showThinking: false,
			});
			expect(thinking()).toBeNull();
		});

		/** Reasoning is shown as written, never run through the markdown renderer. */
		it("does not render the reasoning as markdown", () => {
			const renderMarkdown = vi.fn(() => "rendered");
			mount({
				blocks: [block({ kind: "thinking", text: "<b>raw</b>" })],
				renderMarkdown,
			});
			expect(renderMarkdown).not.toHaveBeenCalled();
			expect(thinking()?.textContent).toContain("<b>raw</b>");
		});
	});

	describe("delegations to a subagent", () => {
		const started = block({
			kind: "agent",
			text: "argus",
			phase: "start",
			agentRunId: "run-1",
		} as Partial<AgentBlock>);
		const finished = block({
			kind: "agent",
			text: "argus",
			phase: "end",
			agentRunId: "run-1",
			result: "all green",
		} as Partial<AgentBlock>);

		it("shows a delegation that is still running", () => {
			mount({ blocks: [started] });
			expect(document.querySelector(".agent-running")).not.toBeNull();
			expect(document.querySelector(".spinner")).not.toBeNull();
		});

		it("shows the answer of a delegation that finished", () => {
			mount({ blocks: [finished] });
			expect(document.querySelector(".agent-result")?.textContent).toContain(
				"all green",
			);
		});

		it("says so when a delegation came back with nothing", () => {
			mount({ blocks: [{ ...finished, result: "" }] });
			expect(document.querySelector(".agent-result.empty")).not.toBeNull();
		});

		/**
		 * The two ends of one delegation share a run id. Keyed on that alone they
		 * would collide, and the answer would be taken for the line that started
		 * the work - so the phase is part of the key.
		 */
		it("draws both ends of one delegation, not one of them twice", () => {
			mount({ blocks: [started, block({ text: "meanwhile" }), finished] });
			expect(agentBlocks()).toHaveLength(2);
			expect(document.querySelector(".agent-running")).not.toBeNull();
			expect(document.querySelector(".agent-done")).not.toBeNull();
		});

		it("opens the thread of a finished delegation", async () => {
			const { onOpenAgent } = mount({ blocks: [finished] });
			await userEvent.click(
				document.querySelector(".agent-open") as HTMLElement,
			);
			expect(onOpenAgent).toHaveBeenCalledWith("run-1");
		});

		it("offers no thread where the caller cannot open one", () => {
			mount({ blocks: [finished], onOpenAgent: undefined });
			expect(document.querySelector(".agent-open")).toBeNull();
		});

		it("marks a delegation that failed", () => {
			mount({ blocks: [{ ...finished, failed: true }] });
			expect(agentBlocks()[0].classList.contains("failed")).toBe(true);
		});

		it("colours a delegation with the agent's own colour", () => {
			mount({ blocks: [{ ...started, color: "#8ab" }] });
			expect(agentBlocks()[0].getAttribute("style")).toContain("#8ab");
		});

		/** Two different delegations are two blocks, not one reused. */
		it("keeps two delegations apart", () => {
			mount({
				blocks: [started, { ...started, agentRunId: "run-2", text: "hermes" }],
			});
			expect(agentBlocks()).toHaveLength(2);
		});
	});

	describe("edge cases", () => {
		it("renders nothing for an empty turn", () => {
			mount({ blocks: [] });
			expect(document.body.querySelectorAll(".tool, .answer")).toHaveLength(0);
		});

		/** Blocks without an id fall back to their position, which must not collide. */
		it("draws every block even when none carries an id", () => {
			mount({
				blocks: [
					block({ kind: "tool", text: "Bash: a" }),
					block({ kind: "tool", text: "Bash: a" }),
					block({ kind: "tool", text: "Bash: a" }),
				],
			});
			expect(tools()).toHaveLength(3);
		});

		/**
		 * Identity matters across updates, not on the first render: a tool call
		 * keyed by its own id keeps its DOM node when a block is inserted before
		 * it, where a positional key would rebuild it. Checked by holding on to
		 * the node and seeing whether it survives the insertion.
		 */
		it("keeps a tool call's element when a block is inserted before it", async () => {
			const tool = block({ kind: "tool", text: "Bash: a", toolId: "t1" });
			const { rerender } = mount({ blocks: [tool] });
			const before = tools()[0];

			await rerender({
				blocks: [block({ text: "inserted" }), tool],
				renderMarkdown: (source: string) => source,
			});
			expect(tools()).toHaveLength(1);
			expect(tools()[0]).toBe(before);
		});
	});
});
