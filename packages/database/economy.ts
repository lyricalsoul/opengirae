import { db } from "./index";
import { economy } from "./schemas/economy";
import { users } from "./schemas/users";
import { maybeTransaction, type DrizzleClient } from "./decorators";
import { eq, and, gte, ne, sql } from "drizzle-orm";
import { treasuryAllocations, AllocationId } from "./schemas/economy";

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

  static getAllocatedPortion = async (id: AllocationId): Promise<number> => {
    const [row] = await db.select().from(treasuryAllocations).where(eq(treasuryAllocations.allocationId, id)).limit(1);
    return row?.balance ?? 0;
  }

  static listAllocations = async () => {
    return await db.select().from(treasuryAllocations);
  }

  static setAllocationConfig = maybeTransaction('setAllocationConfig', async (client, id: AllocationId, config: { name: string; percentage: number }) => {
    const others = await client.select({ percentage: treasuryAllocations.percentage }).from(treasuryAllocations).where(ne(treasuryAllocations.allocationId, id));
    const othersTotal = others.reduce((sum, o) => sum + o.percentage, 0);
    if (othersTotal + config.percentage > 100) return { ok: false as const, reason: 'exceeds_100' as const };

    await client.update(treasuryAllocations).set({ name: config.name, percentage: config.percentage, updatedAt: new Date() }).where(eq(treasuryAllocations.allocationId, id));
    return { ok: true as const };
  })

  // same shape as deductCoinsToTreasury - takes the caller's own open transaction client
  static spendFromAllocation = async (client: DrizzleClient, id: AllocationId, amount: number): Promise<boolean> => {
    const [spendRow] = await client
      .update(treasuryAllocations)
      .set({ balance: sql`${treasuryAllocations.balance} - ${amount}` })
      .where(and(eq(treasuryAllocations.allocationId, id), gte(treasuryAllocations.balance, amount)))
      .returning();
    if (!spendRow) return false;

    await client.update(economy).set({ treasuryBalance: sql`${economy.treasuryBalance} - ${amount}` });
    return true;
  }

  static syncAllocations = maybeTransaction('syncAllocations', async (client) => {
    const state = await client.select().from(economy).limit(1).then(rows => rows[0]!);
    const delta = state.treasuryBalance - state.lastSyncedTreasuryBalance;
    if (delta <= 0) return;

    const allocations = await client.select().from(treasuryAllocations);
    for (const allocation of allocations) {
      const credit = Math.round(delta * allocation.percentage / 100);
      if (credit <= 0) continue;
      await client.update(treasuryAllocations).set({ balance: sql`${treasuryAllocations.balance} + ${credit}` }).where(eq(treasuryAllocations.id, allocation.id));
    }

    await client.update(economy).set({ lastSyncedTreasuryBalance: state.treasuryBalance });
  })
}
