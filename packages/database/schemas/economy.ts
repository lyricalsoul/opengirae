import { integer, bigint, pgTable, doublePrecision, timestamp } from "drizzle-orm/pg-core";

// singleton
export const economy = pgTable("economy", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  treasuryBalance: bigint({ mode: 'number' }).notNull().default(0),
  inflationRate: doublePrecision().notNull().default(1),
  incomeInflationRate: doublePrecision().notNull().default(1),
  updatedAt: timestamp().notNull().defaultNow(),
});
