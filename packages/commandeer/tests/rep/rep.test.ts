import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, bootstrapCommandeerWorkers, fakeCtx, TestFixtures } from "@girae/tests";
import { db } from "@girae/database/index";
import { userProfiles } from "@girae/database/schemas/users";
import { UsersDB } from "@girae/database/users";
import { eq } from "drizzle-orm";
import RepCommand from "../../commands/all/rep.users";

mockTelegram();

describe("/rep gives reputation once per day, never to yourself", () => {
  const fx = new TestFixtures();
  let giverId: number;
  let targetId: number;
  const giverPlatformId = 'test-rep-giver';
  const targetPlatformId = 'test-rep-target';

  beforeAll(async () => {
    process.env.PORT = '0';
    await bootstrapCommandeerWorkers();

    giverId = (await fx.user({ displayName: "Test Rep Giver", platformId: giverPlatformId })).id;
    targetId = (await fx.user({ displayName: "Test Rep Target", platformId: targetPlatformId })).id;
  });

  afterAll(() => fx.cleanup());

  function ctx(authorId: string, target: string) {
    return fakeCtx({ name: 'rep', authorId });
  }

  test("giving rep to yourself is blocked and never mutates anything", async () => {
    await expect(
      RepCommand.execute(ctx(giverPlatformId, giverPlatformId), { target: giverPlatformId })
    ).resolves.toBeUndefined();

    expect((await UsersDB.getUserById(giverId))!.hasGivenRepToday).toBe(false);
  });

  test("giving rep increments the target's reputation and flips the giver's daily flag", async () => {
    await RepCommand.execute(ctx(giverPlatformId, targetPlatformId), { target: targetPlatformId });

    const target = await db.select().from(userProfiles).where(eq(userProfiles.userId, targetId)).then(r => r[0]);
    expect(target!.reputation).toBe(1);
    expect((await UsersDB.getUserById(giverId))!.hasGivenRepToday).toBe(true);
  });

  test("a second rep the same day is blocked and does not double-count", async () => {
    await RepCommand.execute(ctx(giverPlatformId, targetPlatformId), { target: targetPlatformId });

    const target = await db.select().from(userProfiles).where(eq(userProfiles.userId, targetId)).then(r => r[0]);
    expect(target!.reputation).toBe(1);
  });
});
