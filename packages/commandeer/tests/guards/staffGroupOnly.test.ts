import { test, expect, describe } from "bun:test";
import { fakeCtx } from "@girae/tests";
import { guards } from "../../services/guards";

const STAFF_GROUP_CHAT_ID = '-1004377125716';

describe("guards.staffGroupOnly", () => {
  function ctx(chatId: string) {
    return fakeCtx({ name: 'dar', authorId: `test-staffGroupOnly-${Bun.randomUUIDv7()}`, platform: 'telegram', chatId });
  }

  test("passes from inside the staff group chat", async () => {
    expect(await guards.staffGroupOnly!(ctx(STAFF_GROUP_CHAT_ID))).toBe(true);
  });

  test("fails from any other chat, even for a real admin - unlike isAdmin, this guard doesn't check the user flag at all", async () => {
    expect(await guards.staffGroupOnly!(ctx('some-other-chat-id'))).toBe(false);
  });
});
