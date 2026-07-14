import { maybeTransaction } from "./decorators";
import { users } from "./schemas/users";
import { cards, rarities, cardDrawHistory } from "./schemas/cards";
import { storeItems, boughtItems } from "./schemas/vanities";
import { auditLogs } from "./schemas/audit";
import { sql, eq, desc, gte } from "drizzle-orm";

export class StatsDB {
  static getOverview = maybeTransaction('getOverview', async (client) => {
    const [
      userCounts,
      coinsInCirculation,
      cardCount,
      drawCount,
      purchaseCount,
      itemsByType,
      cardsByRarity,
      drawsByDay,
      recentActivity,
    ] = await Promise.all([
      client
        .select({
          total: sql<string>`count(*)`,
          banned: sql<string>`count(*) filter (where ${users.isBanned})`,
          admins: sql<string>`count(*) filter (where ${users.isAdmin})`,
        })
        .from(users)
        .then((r) => r[0]),

      client
        .select({ total: sql<string>`coalesce(sum(${users.coins}), 0)` })
        .from(users)
        .then((r) => r?.[0]?.total),

      client.select({ total: sql<string>`count(*)` }).from(cards).then((r) => r?.[0]?.total),
      client.select({ total: sql<string>`count(*)` }).from(cardDrawHistory).then((r) => r?.[0]?.total),
      client.select({ total: sql<string>`count(*)` }).from(boughtItems).then((r) => r?.[0]?.total),

      client
        .select({ type: storeItems.type, total: sql<string>`count(*)` })
        .from(storeItems)
        .groupBy(storeItems.type),

      client
        .select({ rarity: rarities.name, total: sql<string>`count(${cards.id})` })
        .from(rarities)
        .leftJoin(cards, eq(cards.rarityId, rarities.id))
        .groupBy(rarities.id, rarities.name)
        .orderBy(desc(sql`count(${cards.id})`)),

      client
        .select({
          day: sql<string>`to_char(date_trunc('day', ${cardDrawHistory.drawnAt}), 'DD/MM')`,
          total: sql<string>`count(*)`,
        })
        .from(cardDrawHistory)
        .where(gte(cardDrawHistory.drawnAt, sql`now() - interval '14 days'`))
        .groupBy(sql`1`)
        .orderBy(sql`min(${cardDrawHistory.drawnAt})`),

      client
        .select({
          id: auditLogs.id,
          action: auditLogs.action,
          createdAt: auditLogs.createdAt,
          actorName: users.displayName,
        })
        .from(auditLogs)
        .leftJoin(users, eq(users.id, auditLogs.actorUserId))
        .orderBy(desc(auditLogs.createdAt))
        .limit(8),
    ]);

    return {
      users: {
        total: Number(userCounts!.total),
        banned: Number(userCounts!.banned),
        admins: Number(userCounts!.admins),
      },
      coinsInCirculation: Number(coinsInCirculation),
      cardCount: Number(cardCount),
      drawCount: Number(drawCount),
      purchaseCount: Number(purchaseCount),
      itemsByType: itemsByType.map((r) => ({ type: r.type, total: Number(r.total) })),
      cardsByRarity: cardsByRarity.map((r) => ({ rarity: r.rarity, total: Number(r.total) })),
      drawsByDay: drawsByDay.map((r) => ({ day: r.day, total: Number(r.total) })),
      recentActivity,
    };
  })
}
