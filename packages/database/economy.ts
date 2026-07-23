import { db } from "./index";
import { economy } from "./schemas/economy";
import { users } from "./schemas/users";
import { maybeTransaction, type DrizzleClient } from "./decorators";
import { eq, and, gte, sql } from "drizzle-orm";

export class EconomyDB {
  static getState = async () => {
    return await db.select().from(economy).limit(1).then(rows => rows[0]!);
  }

  static getInflationRate = async (): Promise<number> => {
    return (await EconomyDB.getState()).inflationRate;
  }

  static getIncomeInflationRate = async (): Promise<number> => {
    return (await EconomyDB.getState()).incomeInflationRate;
  }

  static applyInflation = async (basePrice: number): Promise<number> => {
    return Math.round(basePrice * await EconomyDB.getInflationRate());
  }

  static applyIncomeInflation = async (baseAmount: number): Promise<number> => {
    return Math.round(baseAmount * await EconomyDB.getIncomeInflationRate());
  }

  static setInflationRate = maybeTransaction('setInflationRate', async (client, rate: number) => {
    return await client.update(economy).set({ inflationRate: rate, updatedAt: new Date() }).returning().then(rows => rows[0]);
  })

  static setIncomeInflationRate = maybeTransaction('setIncomeInflationRate', async (client, rate: number) => {
    return await client.update(economy).set({ incomeInflationRate: rate, updatedAt: new Date() }).returning().then(rows => rows[0]);
  })

  // direct override, not a delta - for admin ledger corrections
  static setTreasuryBalance = maybeTransaction('setTreasuryBalance', async (client, balance: number) => {
    return await client.update(economy).set({ treasuryBalance: balance, updatedAt: new Date() }).returning().then(rows => rows[0]);
  })

  // takes the caller's own open transaction client so this commits atomically with their own writes
  static deductCoinsToTreasury = async (client: DrizzleClient, userId: number, amount: number): Promise<boolean> => {
    const [spendRow] = await client
      .update(users)
      .set({ coins: sql`${users.coins} - ${amount}` })
      .where(and(eq(users.id, userId), gte(users.coins, amount)))
      .returning();
    if (!spendRow) return false;

    await client.update(economy).set({ treasuryBalance: sql`${economy.treasuryBalance} + ${amount}` });
    await client.update(users).set({ treasuryContributed: sql`${users.treasuryContributed} + ${amount}` }).where(eq(users.id, userId));
    return true;
  }
}
