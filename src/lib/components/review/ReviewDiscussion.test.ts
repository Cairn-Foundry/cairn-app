import { render } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Comment, Discussion } from "$lib/types/integrations";
import ReviewDiscussion from "./ReviewDiscussion.svelte";

function comment(id: string, overrides: Partial<Comment> = {}): Comment {
	return {
		id,
		author: { login: "alice", displayName: "Alice", avatarUrl: null },
		body: `comment ${id}`,
		createdAt: "2026-01-15T10:00:00Z",
		isSystem: false,
		...overrides,
	};
}

function discussion(overrides: Partial<Discussion> = {}): Discussion {
	return {
		id: "d1",
		resolved: false,
		resolvable: true,
		anchor: null,
		comments: [comment("c1")],
		...overrides,
	};
}

function mount(props: Record<string, unknown> = {}) {
	const spies = {
		reply: vi.fn(),
		resolve: vi.fn(),
		jump: vi.fn(),
		select: vi.fn(),
	};
	render(ReviewDiscussion, {
		props: {
			discussion: discussion(),
			renderMarkdown: (source: string) => source,
			...props,
		},
		events: Object.fromEntries(
			Object.entries(spies).map(([name, fn]) => [
				name,
				(e: CustomEvent) => fn(e.detail),
			]),
		),
	});
	return spies;
}

const root = () => document.querySelector(".discussion") as HTMLElement;
const comments = () =>
	Array.from(document.querySelectorAll<HTMLElement>(".comment"));
const buttonNamed = (pattern: RegExp) =>
	Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
		pattern.test((b.textContent ?? "").trim()),
	) as HTMLButtonElement;
const replyBox = () => document.querySelector(".reply-box");
const draft = () => document.querySelector("textarea") as HTMLTextAreaElement;
const sendButton = () =>
	document.querySelector(".reply-actions .btn.primary") as HTMLButtonElement;

describe("ReviewDiscussion", () => {
	describe("the thread", () => {
		it("shows every comment of the thread", () => {
			mount({
				discussion: discussion({
					comments: [comment("c1"), comment("c2")],
				}),
			});
			expect(comments()).toHaveLength(2);
		});

		it("names the author of each comment", () => {
			mount();
			expect(comments()[0].querySelector(".author")?.textContent).toBe("Alice");
		});

		/** A member with no display name is still named, by their login. */
		it("falls back to the login when there is no display name", () => {
			mount({
				discussion: discussion({
					comments: [
						comment("c1", {
							author: { login: "bob", displayName: "", avatarUrl: null },
						}),
					],
				}),
			});
			expect(comments()[0].querySelector(".author")?.textContent).toBe("bob");
		});

		it("renders each comment through the markdown renderer it was given", () => {
			const renderMarkdown = vi.fn(() => "<em>rendered</em>");
			mount({ renderMarkdown });
			expect(renderMarkdown).toHaveBeenCalledWith("comment c1");
			expect(comments()[0].textContent).toContain("rendered");
		});

		it("sets a system comment apart from a written one", () => {
			mount({
				discussion: discussion({
					comments: [comment("c1", { isSystem: true }), comment("c2")],
				}),
			});
			expect(comments()[0].classList.contains("system")).toBe(true);
			expect(comments()[1].classList.contains("system")).toBe(false);
		});

		/** A date the forge sent malformed must not print as "Invalid Date". */
		it("shows nothing rather than an invalid date", () => {
			mount({
				discussion: discussion({
					comments: [comment("c1", { createdAt: "not a date" })],
				}),
			});
			expect(comments()[0].querySelector(".date")?.textContent).toBe("");
		});

		it("reports the thread being selected", async () => {
			const { select } = mount();
			await userEvent.click(root());
			expect(select).toHaveBeenCalled();
		});

		it("marks the thread that is selected", () => {
			const { unmount } = render(ReviewDiscussion, {
				props: {
					discussion: discussion(),
					renderMarkdown: (s: string) => s,
					isSelected: true,
				},
			});
			expect(root().classList.contains("selected")).toBe(true);
			unmount();

			mount({ isSelected: false });
			expect(root().classList.contains("selected")).toBe(false);
		});
	});

	describe("the line it is attached to", () => {
		/** A general comment is attached to no line, so there is nowhere to jump. */
		it("offers no jump for a comment attached to no line", () => {
			mount({ discussion: discussion({ anchor: null }) });
			expect(document.querySelector(".line-jump")).toBeNull();
		});

		it("shows the line a comment is attached to", () => {
			mount({
				discussion: discussion({
					anchor: { path: "src/a.ts", line: 42, side: "new", sha: "abc" },
				}),
			});
			const jump = document.querySelector(".line-jump") as HTMLElement;
			expect(jump.textContent).toMatch(/42/);
			expect(jump.getAttribute("title")).toBe("src/a.ts");
		});

		it("jumps to the line without selecting the thread", async () => {
			const { jump, select } = mount({
				discussion: discussion({
					anchor: { path: "src/a.ts", line: 42, side: "new", sha: "abc" },
				}),
			});
			await userEvent.click(
				document.querySelector(".line-jump") as HTMLElement,
			);
			expect(jump).toHaveBeenCalled();
			expect(select).not.toHaveBeenCalled();
		});
	});

	describe("resolving", () => {
		it("offers to resolve an open thread", async () => {
			const { resolve } = mount({
				discussion: discussion({ resolved: false, resolvable: true }),
			});
			await userEvent.click(buttonNamed(/^resolve|résoudre/i));
			expect(resolve).toHaveBeenCalledWith({ resolved: true });
		});

		it("offers to reopen a resolved one", async () => {
			const { resolve } = mount({
				discussion: discussion({ resolved: true, resolvable: true }),
			});
			await userEvent.click(buttonNamed(/unresolve|rouvrir/i));
			expect(resolve).toHaveBeenCalledWith({ resolved: false });
		});

		/** A forge that cannot resolve a thread must not pretend it can. */
		it("offers nothing for a thread the forge cannot resolve", () => {
			mount({ discussion: discussion({ resolvable: false }) });
			expect(buttonNamed(/resolve|résoudre/i)).toBeUndefined();
		});

		it("marks a resolved thread apart", () => {
			mount({ discussion: discussion({ resolved: true }) });
			expect(root().classList.contains("is-resolved")).toBe(true);
			expect(document.querySelector(".resolved-pill")).not.toBeNull();
		});

		it("refuses a second resolve while one is running", () => {
			mount({ discussion: discussion(), isResolving: true });
			expect(buttonNamed(/resolve|résoudre/i).disabled).toBe(true);
		});

		it("resolves without selecting the thread", async () => {
			const { select } = mount();
			await userEvent.click(buttonNamed(/^resolve|résoudre/i));
			expect(select).not.toHaveBeenCalled();
		});
	});

	describe("replying", () => {
		const openReply = async () => {
			await userEvent.click(buttonNamed(/^reply|répondre/i));
		};

		it("shows no reply box until it is asked for", async () => {
			mount();
			expect(replyBox()).toBeNull();
			await openReply();
			expect(replyBox()).not.toBeNull();
		});

		it("sends the reply that was written", async () => {
			const { reply } = mount();
			await openReply();
			await userEvent.type(draft(), "looks good");
			await userEvent.click(sendButton());
			expect(reply).toHaveBeenCalledWith({ body: "looks good" });
		});

		it("trims what it sends", async () => {
			const { reply } = mount();
			await openReply();
			await userEvent.type(draft(), "  spaced  ");
			await userEvent.click(sendButton());
			expect(reply).toHaveBeenCalledWith({ body: "spaced" });
		});

		it("refuses an empty reply", async () => {
			const { reply } = mount();
			await openReply();
			expect(sendButton().disabled).toBe(true);
			await userEvent.type(draft(), "   ");
			expect(sendButton().disabled).toBe(true);
			expect(reply).not.toHaveBeenCalled();
		});

		/** The disabled button and the guard in the handler are two defences. */
		it("still refuses an empty reply if the button is forced", async () => {
			const { reply } = mount();
			await openReply();
			await userEvent.type(draft(), "   ");
			sendButton().disabled = false;
			await userEvent.click(sendButton());
			expect(reply).not.toHaveBeenCalled();
		});

		it("sends on the platform shortcut without reaching for the button", async () => {
			const { reply } = mount();
			await openReply();
			await userEvent.type(draft(), "quick");
			await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
			expect(reply).toHaveBeenCalledWith({ body: "quick" });
		});

		it("does not send on a plain Enter, which is a new line", async () => {
			const { reply } = mount();
			await openReply();
			await userEvent.type(draft(), "first{Enter}second");
			expect(reply).not.toHaveBeenCalled();
		});

		it("closes the box and clears the draft once sent", async () => {
			mount();
			await openReply();
			await userEvent.type(draft(), "sent");
			await userEvent.click(sendButton());
			expect(replyBox()).toBeNull();
			await openReply();
			expect(draft().value).toBe("");
		});

		it("refuses a second reply while one is in flight", async () => {
			const { reply } = mount({ isReplying: true });
			await openReply();
			await userEvent.type(draft(), "again");
			expect(sendButton().disabled).toBe(true);
			sendButton().disabled = false;
			await userEvent.click(sendButton());
			expect(reply).not.toHaveBeenCalled();
		});

		it("gives up on the reply, clearing what was written", async () => {
			const { reply } = mount();
			await openReply();
			await userEvent.type(draft(), "never mind");
			await userEvent.click(buttonNamed(/cancel|annuler/i));
			expect(replyBox()).toBeNull();
			expect(reply).not.toHaveBeenCalled();
			await openReply();
			expect(draft().value).toBe("");
		});

		/** Typing in the box must not select the thread under it. */
		it("does not select the thread while replying", async () => {
			const { select } = mount();
			await openReply();
			await userEvent.click(draft());
			expect(select).not.toHaveBeenCalled();
		});
	});
});
