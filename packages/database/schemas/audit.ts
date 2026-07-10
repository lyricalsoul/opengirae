import {
  integer,
  pgTable,
  text,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { users } from "./users";

export const auditLogs = pgTable("audit_logs", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  actorUserId: integer()
    .notNull()
    .references(() => users.id),
  action: text().notNull(),
  metadata: jsonb().notNull().default({}),
  createdAt: timestamp().notNull().defaultNow(),
});
