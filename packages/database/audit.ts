import { maybeTransaction } from "./decorators";
import { auditLogs } from "./schemas/audit";
import { eq, desc } from "drizzle-orm";

export class AuditDB {
  static log = maybeTransaction('log', async (client, actorUserId: number, action: string, metadata: Record<string, unknown> = {}) => {
    return await client
      .insert(auditLogs)
      .values({ actorUserId, action, metadata })
      .returning()
      .then(a => a?.[0]);
  })

  static getLogsForActor = maybeTransaction('getLogsForActor', async (client, actorUserId: number) => {
    return await client
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.actorUserId, actorUserId))
      .orderBy(desc(auditLogs.createdAt));
  })
}
