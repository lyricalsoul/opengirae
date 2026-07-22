import { test, expect, describe } from "bun:test";
import { buildReplyTo } from "../replyTo";
import type { MessageChat } from "@girae/common/commands/types";

const chat: MessageChat = { id: "-100123", title: "Test Group", threadId: "42" };

const fakeOriginalMessage = (overrides: Record<string, unknown> = {}) => ({
  id: 42,
  content: "hello",
  author: { id: 999, firstName: "Alice" },
  createdTimestamp: Date.now(),
  ...overrides,
});

describe("buildReplyTo", () => {
  // regression: replying to a message that happens to share the topic's anchor id must still resolve
  test("preserves a deliberate reply to a message whose id equals the topic's threadId", async () => {
    const msg = { threadId: "42", originalMessage: fakeOriginalMessage({ id: 42 }) };
    const replyTo = await buildReplyTo(msg, chat);
    expect(replyTo).toBeDefined();
    expect(replyTo!.author.id).toBe("999");
  });

  test("strips the synthetic reply to the topic's own creation service message", async () => {
    const msg = { threadId: "42", originalMessage: fakeOriginalMessage({ id: 42, forumCreated: { name: "General" } }) };
    const replyTo = await buildReplyTo(msg, chat);
    expect(replyTo).toBeUndefined();
  });

  test("returns undefined when there is no reply at all", async () => {
    const msg = { threadId: "42", originalMessage: undefined };
    const replyTo = await buildReplyTo(msg, chat);
    expect(replyTo).toBeUndefined();
  });
});
