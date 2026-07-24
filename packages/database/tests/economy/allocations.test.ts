import { test, expect, describe, beforeAll, afterAll, beforeEach } from "bun:test";
import { db } from "../../index";
import { economy } from "../../schemas/economy";
import { treasuryAllocations, AllocationId } from "../../schemas/economy";
import { EconomyDB } from "../../economy";
import { eq } from "drizzle-orm";

describe("EconomyDB allocations", () => {
  let originalTreasuryBalance: number;
  let originalLastSynced: number;
  let originalPercentage: number;
  let originalBalance: number;

  beforeAll(async () => {
    const state = await EconomyDB.getState();
    originalTreasuryBalance = state.treasuryBalance;
    originalLastSynced = state.lastSyncedTreasuryBalance;

    const [row] = await db.select().from(treasuryAllocations).where(eq(treasuryAllocations.allocationId, AllocationId.RIFA));
    originalPercentage = row!.percentage;
    originalBalance = row!.balance;
  });

  afterAll(async () => {
    await db.update(economy).set({ treasuryBalance: originalTreasuryBalance, lastSyncedTreasuryBalance: originalLastSynced });
    await db.update(treasuryAllocations).set({ percentage: originalPercentage, balance: originalBalance }).where(eq(treasuryAllocations.allocationId, AllocationId.RIFA));
  });

  beforeEach(async () => {
    await db.update(treasuryAllocations).set({ percentage: 10, balance: 0 }).where(eq(treasuryAllocations.allocationId, AllocationId.RIFA));
    await db.update(economy).set({ treasuryBalance: 0, lastSyncedTreasuryBalance: 0 });
  });

  test("getAllocatedPortion returns the allocation's current balance", async () => {
    await db.update(treasuryAllocations).set({ balance: 500 }).where(eq(treasuryAllocations.allocationId, AllocationId.RIFA));
    expect(await EconomyDB.getAllocatedPortion(AllocationId.RIFA)).toBe(500);
  });

  test("listAllocations returns every allocation row", async () => {
    const rows = await EconomyDB.listAllocations();
    expect(rows.some(r => r.allocationId === AllocationId.RIFA)).toBe(true);
  });

  test("setAllocationConfig updates name and percentage under the 100% cap", async () => {
    const result = await EconomyDB.setAllocationConfig(AllocationId.RIFA, { name: "Rifa Semanal", percentage: 50 });
    expect(result).toEqual({ ok: true });

    const [row] = await db.select().from(treasuryAllocations).where(eq(treasuryAllocations.allocationId, AllocationId.RIFA));
    expect(row!.name).toBe("Rifa Semanal");
    expect(row!.percentage).toBe(50);
  });

  test("setAllocationConfig rejects a percentage that would push the total over 100%, without writing", async () => {
    const result = await EconomyDB.setAllocationConfig(AllocationId.RIFA, { name: "Rifa", percentage: 101 });
    expect(result).toEqual({ ok: false, reason: 'exceeds_100' });

    const [row] = await db.select().from(treasuryAllocations).where(eq(treasuryAllocations.allocationId, AllocationId.RIFA));
    expect(row!.percentage).toBe(10);
  });

  test("setAllocationConfig setting the same allocation's percentage to 100% doesn't double-count its own previous value", async () => {
    const result = await EconomyDB.setAllocationConfig(AllocationId.RIFA, { name: "Rifa", percentage: 100 });
    expect(result).toEqual({ ok: true });
  });

  test("spendFromAllocation moves coins from the allocation into nowhere, decrementing treasuryBalance in lockstep", async () => {
    await db.update(treasuryAllocations).set({ balance: 200 }).where(eq(treasuryAllocations.allocationId, AllocationId.RIFA));
    await db.update(economy).set({ treasuryBalance: 1000 });

    const ok = await db.transaction(client => EconomyDB.spendFromAllocation(client, AllocationId.RIFA, 150));
    expect(ok).toBe(true);

    const [row] = await db.select().from(treasuryAllocations).where(eq(treasuryAllocations.allocationId, AllocationId.RIFA));
    expect(row!.balance).toBe(50);

    const state = await EconomyDB.getState();
    expect(state.treasuryBalance).toBe(850);
  });

  test("spendFromAllocation returns false and touches nothing on insufficient balance", async () => {
    await db.update(treasuryAllocations).set({ balance: 50 }).where(eq(treasuryAllocations.allocationId, AllocationId.RIFA));
    await db.update(economy).set({ treasuryBalance: 1000 });

    const ok = await db.transaction(client => EconomyDB.spendFromAllocation(client, AllocationId.RIFA, 100));
    expect(ok).toBe(false);

    const [row] = await db.select().from(treasuryAllocations).where(eq(treasuryAllocations.allocationId, AllocationId.RIFA));
    expect(row!.balance).toBe(50);

    const state = await EconomyDB.getState();
    expect(state.treasuryBalance).toBe(1000);
  });

  test("syncAllocations distributes only the growth since the last sync, proportional to percentage", async () => {
    await db.update(treasuryAllocations).set({ percentage: 20, balance: 0 }).where(eq(treasuryAllocations.allocationId, AllocationId.RIFA));
    await db.update(economy).set({ treasuryBalance: 1000, lastSyncedTreasuryBalance: 0 });

    await EconomyDB.syncAllocations();

    const [row] = await db.select().from(treasuryAllocations).where(eq(treasuryAllocations.allocationId, AllocationId.RIFA));
    expect(row!.balance).toBe(200);

    const state = await EconomyDB.getState();
    expect(state.lastSyncedTreasuryBalance).toBe(1000);
  });

  test("syncAllocations run twice with no new growth is a true no-op the second time", async () => {
    await db.update(treasuryAllocations).set({ percentage: 20, balance: 0 }).where(eq(treasuryAllocations.allocationId, AllocationId.RIFA));
    await db.update(economy).set({ treasuryBalance: 1000, lastSyncedTreasuryBalance: 0 });

    await EconomyDB.syncAllocations();
    await EconomyDB.syncAllocations();

    const [row] = await db.select().from(treasuryAllocations).where(eq(treasuryAllocations.allocationId, AllocationId.RIFA));
    expect(row!.balance).toBe(200);
  });

  test("syncAllocations never claws back a balance a command already spent", async () => {
    await db.update(treasuryAllocations).set({ percentage: 20, balance: 0 }).where(eq(treasuryAllocations.allocationId, AllocationId.RIFA));
    await db.update(economy).set({ treasuryBalance: 1000, lastSyncedTreasuryBalance: 0 });

    await EconomyDB.syncAllocations();

    const ok = await db.transaction(client => EconomyDB.spendFromAllocation(client, AllocationId.RIFA, 150));
    expect(ok).toBe(true);

    await EconomyDB.syncAllocations();

    const [row] = await db.select().from(treasuryAllocations).where(eq(treasuryAllocations.allocationId, AllocationId.RIFA));
    expect(row!.balance).toBe(50);
  });
});
