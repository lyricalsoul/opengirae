import { test, expect, describe } from "bun:test";
import { mockTelegram, fakeCtx } from "@girae/tests";
import { isPrivateLinkChat } from "../../commands/main/link";

mockTelegram();

describe("/link chat privacy", () => {
  test("telegram groups are refused, DMs and discord are allowed", () => {
    const ctx = (platform: 'telegram' | 'discord', chatId: string) => fakeCtx({ name: 'link', authorId: 'x', platform, chatId });
    expect(isPrivateLinkChat(ctx('telegram', '-1001234567890'))).toBe(false);
    expect(isPrivateLinkChat(ctx('telegram', '12345'))).toBe(true);
    expect(isPrivateLinkChat(ctx('discord', 'channel-1'))).toBe(true);
  });
});
