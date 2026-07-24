import { test, expect, describe, afterEach } from "bun:test";
import { rawClient } from "@girae/common/queue";
import { claimGirar, getGirarActive, updateGirarStep, releaseGirar } from "../../services/gacha/girarClaim";

describe("girarClaim (resumable claim key)", () => {
  const authorId = `test-girar-claim-${Date.now()}`;
  const chatId = `test-chat-${Date.now()}`;

  afterEach(async () => {
    await rawClient.del(`girar:active:${authorId}:${chatId}`);
    await rawClient.del(`girar:active:${authorId}:other-${chatId}`);
  });

  test("only one of many concurrent claims on the same author+chat succeeds", async () => {
    const attempts = 20;
    const results = await Promise.all(
      Array.from({ length: attempts }, (_, i) =>
        claimGirar(authorId, chatId, { workflowID: `wf-${i}`, kind: 'batch' }))
    );
    expect(results.filter(Boolean).length).toBe(1);
  });

  test("a released claim can be re-acquired", async () => {
    expect(await claimGirar(authorId, chatId, { workflowID: 'wf-1', kind: 'batch' })).toBe(true);
    expect(await claimGirar(authorId, chatId, { workflowID: 'wf-2', kind: 'batch' })).toBe(false);

    await releaseGirar(authorId, chatId);
    expect(await claimGirar(authorId, chatId, { workflowID: 'wf-3', kind: 'batch' })).toBe(true);
  });

  test("getGirarActive returns null when nothing is claimed", async () => {
    expect(await getGirarActive(authorId, chatId)).toBeNull();
  });

  test("getGirarActive returns exactly what was claimed", async () => {
    await claimGirar(authorId, chatId, { workflowID: 'wf-4', kind: 'batch' });
    expect(await getGirarActive(authorId, chatId)).toEqual({ workflowID: 'wf-4', kind: 'batch' });
  });

  test("updateGirarStep overwrites the step without needing a fresh claim", async () => {
    await claimGirar(authorId, chatId, { workflowID: 'wf-5', kind: 'interactive' });
    const step = { content: 'category step', buttons: [[{ text: 'A', callbackData: 'wf-5.cat.0' }]] };
    await updateGirarStep(authorId, chatId, 'wf-5', step);

    expect(await getGirarActive(authorId, chatId)).toEqual({ workflowID: 'wf-5', kind: 'interactive', step });

    const step2 = { content: 'subcategory step', buttons: [[{ text: 'B', callbackData: 'wf-5.sub.0' }]] };
    await updateGirarStep(authorId, chatId, 'wf-5', step2);
    expect(await getGirarActive(authorId, chatId)).toEqual({ workflowID: 'wf-5', kind: 'interactive', step: step2 });
  });

  // regression: a stale claim in one chat must not leak into a /girar in a different chat
  test("a claim in one chat does not block or leak into a different chat for the same author", async () => {
    const otherChatId = `other-${chatId}`;
    expect(await claimGirar(authorId, chatId, { workflowID: 'wf-6', kind: 'interactive' })).toBe(true);

    expect(await claimGirar(authorId, otherChatId, { workflowID: 'wf-7', kind: 'interactive' })).toBe(true);
    expect(await getGirarActive(authorId, otherChatId)).toEqual({ workflowID: 'wf-7', kind: 'interactive' });
    expect(await getGirarActive(authorId, chatId)).toEqual({ workflowID: 'wf-6', kind: 'interactive' });

    await releaseGirar(authorId, otherChatId);
  });
});
