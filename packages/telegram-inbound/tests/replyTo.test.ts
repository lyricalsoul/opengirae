import { test, expect, describe } from "bun:test";
import { buildReplyTo, resolveMedia } from "../replyTo";
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

// Regression: Telegram's own getFile can refuse a file that's simply too large,
// independent of any limit this bot enforces - .fetch() throwing must never crash
// inbound processing (this used to propagate uncaught and kill the whole update).
describe("resolveMedia", () => {
  test("a video whose .fetch() throws (file too large for Telegram itself) doesn't throw, and still reports its size", async () => {
    const msg = { video: { size: 90 * 1024 * 1024, fetch: () => { throw new Error("file is too big") } } };
    const result = await resolveMedia(msg);
    expect(result).toEqual({ photoUrl: undefined, isVideo: true, fileSizeBytes: 90 * 1024 * 1024 });
  });

  test("a video that fetches fine reports both the URL and the size", async () => {
    const msg = { video: { size: 5 * 1024 * 1024, fetch: async () => ({ url: "https://example.com/v.mp4" }) } };
    const result = await resolveMedia(msg);
    expect(result).toEqual({ photoUrl: "https://example.com/v.mp4", isVideo: true, fileSizeBytes: 5 * 1024 * 1024 });
  });

  test("a photo's size is captured too, not just a video's", async () => {
    const msg = { photo: [{ size: 2 * 1024 * 1024, fetch: async () => ({ url: "https://example.com/p.jpg" }) }] };
    const result = await resolveMedia(msg);
    expect(result).toEqual({ photoUrl: "https://example.com/p.jpg", fileSizeBytes: 2 * 1024 * 1024 });
  });

  test("an animation's size is captured, and a failed fetch doesn't throw", async () => {
    const msg = { animation: { size: 40 * 1024 * 1024, fetch: () => { throw new Error("nope") } } };
    const result = await resolveMedia(msg);
    expect(result).toEqual({ photoUrl: undefined, isAnimatedPhoto: true, fileSizeBytes: 40 * 1024 * 1024 });
  });

  test("no media at all resolves to an empty object", async () => {
    expect(await resolveMedia({})).toEqual({});
  });
});
