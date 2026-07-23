import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, bootstrapCommandeerWorkers, fakeCtx, TestFixtures } from "@girae/tests";
import { db } from "@girae/database/index";
import { users } from "@girae/database/schemas/users";
import { EconomyDB } from "@girae/database/economy";
import { eq } from "drizzle-orm";
import ReceitaCommand from "../../commands/all/receita.main";

const { sentMessages } = mockTelegram();

describe("/receita shows the treasury total and the caller's contribution", () => {
  const fx = new TestFixtures();
  let userId: number;
  const authorId = 'test-receita-author';

  beforeAll(async () => {
    process.env.PORT = '0';
    await bootstrapCommandeerWorkers();

    userId = (await fx.user({ displayName: "Test Receita", platform: 'telegram', platformId: authorId })).id;
    await db.update(users).set({ treasuryContributed: 4200 }).where(eq(users.id, userId));
  });

  afterAll(() => fx.cleanup());

  test("the reply shows both the treasury balance and the caller's own contribution, formatted", async () => {
    sentMessages.length = 0;
    await ReceitaCommand.execute(fakeCtx({ name: 'receita', authorId, platform: 'telegram' }));
    await new Promise(resolve => setTimeout(resolve, 1500));

    const state = await EconomyDB.getState();
    const last = sentMessages[sentMessages.length - 1]!;
    const text = last.text ?? last.caption ?? '';

    const formatter = new Intl.NumberFormat('pt-BR');
    expect(text).toContain(formatter.format(state.treasuryBalance));
    expect(text).toContain(formatter.format(4200));
    expect(text).toContain('Receita Federal da Giraê');
  });
});
