import { integer, bigint, pgTable, pgEnum, text, doublePrecision, boolean, timestamp } from "drizzle-orm/pg-core";

// singleton
export const economy = pgTable("economy", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  treasuryBalance: bigint({ mode: 'number' }).notNull().default(0),
  inflationRate: doublePrecision().notNull().default(1),
  incomeInflationRate: doublePrecision().notNull().default(1),
  // watermark: treasuryBalance as of the last allocation sync - see EconomyDB.syncAllocations
  lastSyncedTreasuryBalance: bigint({ mode: 'number' }).notNull().default(0),

  // /leilao sale commission, charged at settlement not at listing time (0.10 = 10%)
  auctionSaleFeeRate: doublePrecision().notNull().default(0.10),
  // emergency kill-switch: createAuction/placeBid refuse immediately when false, no deploy needed
  auctionsEnabled: boolean().notNull().default(true),

  updatedAt: timestamp().notNull().defaultNow(),
});

// extend this array (+ migration) per new allocation feature - 'rifa' is a placeholder for now
export const allocationIds = pgEnum("allocation_ids", ["rifa"])

export enum AllocationId {
  RIFA = "rifa",
}

export const treasuryAllocations = pgTable("treasury_allocations", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  allocationId: allocationIds("allocationId").notNull().unique(),
  name: text().notNull(),
  percentage: doublePrecision().notNull().default(0),
  balance: bigint({ mode: 'number' }).notNull().default(0),
  updatedAt: timestamp().notNull().defaultNow(),
});
