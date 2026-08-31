import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, bootstrapCommandeerWorkers, fakeCtx, TestFixtures } from "@girae/tests";
import { SettingsDB } from "@girae/database/settings";
import CategoryCommand from "../../commands/cards/cat";

const { sentMessages } = mockTelegram();

async function waitForSentMessage(minLength: number, timeoutMs = 5000): Promise<void> {
  const startTime = Date.now();
  while (sentMessages.length < minLength) {
    if (Date.now() - startTime > timeoutMs) throw new Error(`Timeout waiting for sentMessages.length >= ${minLength}`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

describe("/cat with no args (the /ctg alias)", () => {
  const fx = new TestFixtures();
  const authorId = `test-cat-author-${Date.now()}`;
  let originalEnableDiscoteca: boolean;

  beforeAll(async () => {
    await bootstrapCommandeerWorkers();
    const state = await SettingsDB.getState();
    originalEnableDiscoteca = state.enableDiscoteca;
  });

  afterAll(async () => {
    await SettingsDB.setDiscotecaEnabled(originalEnableDiscoteca);
    await fx.cleanup();
  });

  function ctx() {
    return fakeCtx({ name: 'cat', authorId, platform: 'telegram' as const });
  }

  test("lists Discoteca alongside categories when it's enabled", async () => {
    await SettingsDB.setDiscotecaEnabled(true);

    const startIndex = sentMessages.length;
    await CategoryCommand.execute(ctx(), {});
    await waitForSentMessage(startIndex + 1);

    const msg = sentMessages[sentMessages.length - 1]!;
    const content = msg.text ?? msg.content ?? "";
    expect(content).toContain("Discoteca");
  });

  test("omits Discoteca when it's disabled", async () => {
    await SettingsDB.setDiscotecaEnabled(false);

    const startIndex = sentMessages.length;
    await CategoryCommand.execute(ctx(), {});
    await waitForSentMessage(startIndex + 1);

    const msg = sentMessages[sentMessages.length - 1]!;
    const content = msg.text ?? msg.content ?? "";
    expect(content).not.toContain("Discoteca");
  });
});
