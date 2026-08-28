import {
  integer,
  pgTable,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users";

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    actorUserId: integer()
      .notNull()
      .references(() => users.id),
    action: text().notNull(),
    metadata: jsonb().notNull().default({}),
    createdAt: timestamp().notNull().defaultNow(),
    // claim-lock for AuditDB.revertDonation - set atomically so a donation can't be reverted twice.
    revertedAt: timestamp(),
    revertedByAdminId: integer().references(() => users.id),
  },
  (table) => [
    // covers getDonationHistory/getDiscotecaDonationHistory, the heaviest audit_logs read paths.
    index("audit_logs_action_actor_created_idx").on(table.action, table.actorUserId, table.createdAt),
  ],
);
