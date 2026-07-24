import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TestFixtures, fakeCtx } from "@girae/tests";
import { CommandArgumentType, type CommandArgumentSpec } from "@girae/common/commands";
import { parseCommandArguments } from "../../services/commandArguments";
import { cativeiroEligibilityGuard } from "../../services/cativeiro";

describe("cativeiroEligibilityGuard (via the CARD @CommandArgument spec)", () => {
  const fx = new TestFixtures();
  let authorId: string;
  let userId: number;
  let rarityId: number;
  let belowCardId: number;
  let atCardId: number;

  const specs: CommandArgumentSpec[] = [{ name: 'card', type: CommandArgumentType.CARD, guard: cativeiroEligibilityGuard }];

  beforeAll(async () => {
    authorId = `test-eligibility-${Bun.randomUUIDv7()}`;
    userId = (await fx.user({ displayName: "Test Eligibility Guard", platform: 'none', platformId: authorId })).id;
    rarityId = (await fx.rarity({ name: "Test Eligibility Rarity", cativeiroThreshold: 5 })).id;

    belowCardId = (await fx.card({ name: "Test Eligibility Below", rarityId })).id;
    atCardId = (await fx.card({ name: "Test Eligibility At", rarityId })).id;

    await fx.ownCard(userId, belowCardId, 4);
    await fx.ownCard(userId, atCardId, 5);
  });

  afterAll(() => fx.cleanup());

  test("rejects a card the user owns fewer copies of than the threshold, with a friendly message", async () => {
    const ctx = fakeCtx({ name: 'test', authorId, args: [String(belowCardId)] });
    const result = await parseCommandArguments(specs, ctx.args, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('/cativeiros');
  });

  test("accepts a card owned at exactly the threshold", async () => {
    const ctx = fakeCtx({ name: 'test', authorId, args: [String(atCardId)] });
    const result = await parseCommandArguments(specs, ctx.args, ctx);
    expect(result.ok).toBe(true);
  });

  test("rejects when the caller has never used the bot at all (no linked account)", async () => {
    const ctx = fakeCtx({ name: 'test', authorId: 'nonexistent-author', args: [String(atCardId)] });
    const result = await parseCommandArguments(specs, ctx.args, ctx);
    expect(result.ok).toBe(false);
  });
});
