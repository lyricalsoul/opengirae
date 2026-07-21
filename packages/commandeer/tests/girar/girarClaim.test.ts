import { test, expect, describe, afterEach } from "bun:test";
import { rawClient } from "@girae/common/queue";
import { claimGirar, getGirarActive, updateGirarStep, releaseGirar } from "../../services/girarClaim";

describe("girarClaim (resumable claim key)", () => {
  const authorId = `test-girar-claim-${Date.now()}`;

  afterEach(async () => {
    await rawClient.del(`girar:active:${authorId}`);
  });

  test("only one of many concurrent claims on the same author succeeds", async () => {
    const attempts = 20;
    const results = await Promise.all(
      Array.from({ length: attempts }, (_, i) =>
        claimGirar(authorId, { workflowID: `wf-${i}`, kind: 'batch' }))
    );
    expect(results.filter(Boolean).length).toBe(1);
  });

  test("a released claim can be re-acquired", async () => {
    expect(await claimGirar(authorId, { workflowID: 'wf-1', kind: 'batch' })).toBe(true);
    expect(await claimGirar(authorId, { workflowID: 'wf-2', kind: 'batch' })).toBe(false);

    await releaseGirar(authorId);
    expect(await claimGirar(authorId, { workflowID: 'wf-3', kind: 'batch' })).toBe(true);
  });

  test("getGirarActive returns null when nothing is claimed", async () => {
    expect(await getGirarActive(authorId)).toBeNull();
  });

  test("getGirarActive returns exactly what was claimed", async () => {
    await claimGirar(authorId, { workflowID: 'wf-4', kind: 'batch' });
    expect(await getGirarActive(authorId)).toEqual({ workflowID: 'wf-4', kind: 'batch' });
  });

  test("updateGirarStep overwrites the step without needing a fresh claim", async () => {
    await claimGirar(authorId, { workflowID: 'wf-5', kind: 'interactive' });
    const step = { content: 'category step', buttons: [[{ text: 'A', callbackData: 'wf-5.cat.0' }]] };
    await updateGirarStep(authorId, 'wf-5', step);

    expect(await getGirarActive(authorId)).toEqual({ workflowID: 'wf-5', kind: 'interactive', step });

    const step2 = { content: 'subcategory step', buttons: [[{ text: 'B', callbackData: 'wf-5.sub.0' }]] };
    await updateGirarStep(authorId, 'wf-5', step2);
    expect(await getGirarActive(authorId)).toEqual({ workflowID: 'wf-5', kind: 'interactive', step: step2 });
  });
});
