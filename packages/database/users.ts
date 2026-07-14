import { users, userProfiles } from "./schemas/users";
import { maybeTransaction } from "./decorators";
import { eq, sql, and, gte, ilike, desc } from "drizzle-orm";

export class UsersDB {
  static listUsers = maybeTransaction('listUsers', async (client, opts: { limit?: number; offset?: number; query?: string } = {}) => {
    const { limit = 50, offset = 0, query } = opts;
    return await client
      .select()
      .from(users)
      .where(query ? ilike(users.displayName, `%${query}%`) : undefined)
      .orderBy(desc(users.id))
      .limit(limit)
      .offset(offset);
  })

  static setBanned = maybeTransaction('setBanned', async (client, userId: number, isBanned: boolean, banMessage?: string) => {
    return await client
      .update(users)
      .set({ isBanned, banMessage: isBanned ? (banMessage ?? null) : null })
      .where(eq(users.id, userId))
      .returning()
      .then(rows => rows[0]);
  })

  static setIsAdmin = maybeTransaction('setIsAdmin', async (client, userId: number, isAdmin: boolean) => {
    return await client
      .update(users)
      .set({ isAdmin })
      .where(eq(users.id, userId))
      .returning()
      .then(rows => rows[0]);
  })

  static getUserById = maybeTransaction('getUserById', async (client, id: number) => {
    return await client.select().from(users).where(eq(users.id, id)).limit(1).then(a => a?.[0]);
  })

  static getUserByTelegramId = maybeTransaction('getUserByTelegramId', async (client, telegramId: string) => {
    return await client
      .select()
      .from(users)
      .where(eq(users.telegramId, telegramId))
      .limit(1)
      .then(rows => rows[0]);
  })

  static addCoins = maybeTransaction('addCoins', async (client, userId: number, amount: number) => {
    return await client
      .update(users)
      .set({ coins: sql`${users.coins} + ${amount}` })
      .where(eq(users.id, userId))
      .returning()
      .then(rows => rows[0]);
  })

  static spendCoins = maybeTransaction('spendCoins', async (client, userId: number, amount: number): Promise<boolean> => {
    const [row] = await client
      .update(users)
      .set({ coins: sql`${users.coins} - ${amount}` })
      .where(and(eq(users.id, userId), gte(users.coins, amount)))
      .returning();
    return !!row;
  })

  static setFavoriteCard = maybeTransaction('setFavoriteCard', async (client, userId: number, cardId: number) => {
    return await client
      .update(users)
      .set({ favoriteCardId: cardId })
      .where(eq(users.id, userId))
      .returning()
      .then(rows => rows[0]);
  })

  static updateUserMaxDraws = maybeTransaction('updateUserMaxDraws', async (client, userId: number, amount: number) => {
    return await client
      .update(users)
      .set({ maxDraws: sql`${users.maxDraws} + ${amount}` })
      .where(eq(users.id, userId))
      .returning()
      .then(rows => rows[0]);
  })

  static setDailyGotten = maybeTransaction('setDailyGotten', async (client, userId: number, newStreak: number) => {
    return await client
      .update(users)
      .set({ hasGottenDaily: true, dailyStreak: newStreak })
      .where(eq(users.id, userId))
      .returning()
      .then(rows => rows[0]);
  })

  static resetMidnightStats = maybeTransaction('resetMidnightStats', async (client) => {
    await client
      .update(users)
      .set({ dailyStreak: 0 })
      .where(eq(users.hasGottenDaily, false));

    await client
      .update(users)
      .set({ hasGottenDaily: false });
  })

  static getUserProfileByTelegramId = maybeTransaction('getUserProfileByTelegramId', async (client, telegramId: string) => {
    return await client
      .select()
      .from(userProfiles)
      .leftJoin(users, eq(userProfiles.userId, users.id))
      .where(eq(users.telegramId, telegramId))
      .limit(1)
      .then(a => a?.[0])
  })

  static createUser = maybeTransaction('createUser', async (client, data: Omit<typeof users.$inferInsert, "id">) => {
    return await client.insert(users).values(data).returning().then(rows => rows[0]);
  })

  static createUserProfile = maybeTransaction('createUserProfile', async (client, userId: number) => {
    return await client.insert(userProfiles).values({ userId }).returning().then(rows => rows[0]);
  })

  static ensureUser = maybeTransaction('ensureUser', async (client, data: { telegramId: string; displayName: string; avatarUrl: string }) => {
    const [user] = await client
      .insert(users)
      .values(data)
      .onConflictDoNothing()
      .returning()

    const existing = user ?? await client
      .select()
      .from(users)
      .where(eq(users.telegramId, data.telegramId))
      .limit(1)
      .then(rows => rows[0])

    if (!existing) return null

    await client
      .insert(userProfiles)
      .values({ userId: existing.id })
      .onConflictDoNothing()

    return existing
  })

  static updateAvatar = maybeTransaction('updateAvatar', async (client, userId: number, avatarUrl: string) => {
    return await client
      .update(users)
      .set({ avatarUrl, avatarUpdatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning()
      .then(rows => rows[0]);
  })

  static updateUserProfile = maybeTransaction('updateUserProfile', async (client, userId: number, data: Partial<typeof userProfiles.$inferInsert>) => {
    return await client
      .update(userProfiles)
      .set(data)
      .where(eq(userProfiles.userId, userId))
      .returning()
      .then(rows => rows[0]);
  })

  static incrementUsedDraws = maybeTransaction('incrementUsedDraws', async (client, userId: number) => {
    return await client
      .update(users)
      .set({ usedDraws: sql`${users.usedDraws} + 1` })
      .where(eq(users.id, userId))
      .returning()
      .then(rows => rows[0]);
  })

  static decrementUsedDraws = maybeTransaction('decrementUsedDraws', async (client, amount: number) => {
    await client
      .update(users)
      .set({ usedDraws: sql`GREATEST(${users.usedDraws} - ${amount}, 0)` });
  })
}
