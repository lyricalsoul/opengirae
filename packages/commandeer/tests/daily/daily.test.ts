import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, bootstrapCommandeerWorkers, fakeCtx, TestFixtures } from "@girae/tests";
import { db } from "@girae/database/index";
import { users } from "@girae/database/schemas/users";
import { UsersDB } from "@girae/database/users";
import { EconomyDB } from "@girae/database/economy";
import { eq } from "drizzle-orm";
import DailyCommand from "../../commands/all/daily.main";

mockTelegram();

describe("/daily scales its reward by incomeInflationRate", () => {
  const fx = new TestFixtures();
  let userId: number;
  let originalIncomeInflationRate: number;
  const authorId = 'test-daily-author';

  beforeAll(async () => {
    process.env.PORT = '0';
    await bootstrapCommandeerWorkers();

    originalIncomeInflationRate = await EconomyDB.getIncomeInflationRate();
    await EconomyDB.setIncomeInflationRate(2);

    userId = (await fx.user({ displayName: "Test Daily", platformId: authorId })).id;
    await db.update(users).set({ coins: 0, hasGottenDaily: false, dailyStreak: 0 }).where(eq(users.id, userId));
  });

  afterAll(async () => {
    await EconomyDB.setIncomeInflationRate(originalIncomeInflationRate);
    await fx.cleanup();
  });

  test("the credited amount is double the un-scaled base reward", async () => {
    await DailyCommand.execute(fakeCtx({ name: 'daily', authorId }));

    const user = await UsersDB.getUserById(userId);
    // base is 200 at incomeInflationRate=1 (see daily.main.ts) - doubled again here to 400
    expect(user!.coins).toBe(400);
  });
});
