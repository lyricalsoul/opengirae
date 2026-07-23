import { users, userProfiles, linkedAccounts } from "./schemas/users";
import { userCards, wishlist, cardDrawHistory, trades } from "./schemas/cards";
import { boughtItems } from "./schemas/vanities";
import { auditLogs } from "./schemas/audit";
import { maybeTransaction } from "./decorators";
import { eq, sql, and, or, gte, ilike, desc } from "drizzle-orm";

export type Platform = 'telegram' | 'discord' | 'none';

type UserSortField = 'displayName' | 'coins' | 'usedDraws' | 'isBanned' | 'isAdmin';

export class UsersDB {
  static listUsers = maybeTransaction('listUsers', async (client, opts: {
    limit?: number; offset?: number; query?: string; sortField?: UserSortField; sortDir?: 'asc' | 'desc';
  } = {}) => {
    const { limit = 50, offset = 0, query, sortField, sortDir } = opts;
    const where = query ? ilike(users.displayName, `%${query}%`) : undefined;

    const sortColumns = {
      displayName: users.displayName,
      coins: users.coins,
      usedDraws: users.usedDraws,
      isBanned: users.isBanned,
      isAdmin: users.isAdmin,
    };
    // no explicit sort: keep the original newest-first default
    const column = sortField ? sortColumns[sortField] : users.id;
    const direction = sortField ? (sortDir ?? 'asc') : 'desc';
    const orderBy = direction === 'desc' ? desc(column) : column;

    const [rows, total] = await Promise.all([
      client.select().from(users).where(where).orderBy(orderBy).limit(limit).offset(offset),
      client.select({ total: sql<number>`CAST(COUNT(*) AS INTEGER)` }).from(users).where(where).then(r => r[0]?.total ?? 0),
    ]);

    return { rows, total };
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

  static setPrivacyMode = maybeTransaction('setPrivacyMode', async (client, userId: number, privacyMode: boolean) => {
    return await client
      .update(users)
      .set({ privacyMode })
      .where(eq(users.id, userId))
      .returning()
      .then(rows => rows[0]);
  })

  static getUserById = maybeTransaction('getUserById', async (client, id: number) => {
    return await client.select().from(users).where(eq(users.id, id)).limit(1).then(a => a?.[0]);
  })

  static isViewable(viewerId: number, target: { id: number; privacyMode: boolean }): boolean {
    return target.id === viewerId || !target.privacyMode
  }

  static getUserByPlatformAccount = maybeTransaction('getUserByPlatformAccount', async (client, platform: Platform, platformId: string) => {
    return await client
      .select({ users: users })
      .from(linkedAccounts)
      .innerJoin(users, eq(linkedAccounts.userId, users.id))
      .where(and(eq(linkedAccounts.platform, platform), eq(linkedAccounts.platformId, platformId)))
      .limit(1)
      .then(rows => rows[0]?.users);
  })

  // Resolves a user's id on a specific platform - the inverse of getUserByPlatformAccount.
  static getPlatformIdForUser = maybeTransaction('getPlatformIdForUser', async (client, userId: number, platform: Platform): Promise<string | undefined> => {
    return await client
      .select({ platformId: linkedAccounts.platformId })
      .from(linkedAccounts)
      .where(and(eq(linkedAccounts.userId, userId), eq(linkedAccounts.platform, platform)))
      .limit(1)
      .then(rows => rows[0]?.platformId);
  })

  static getUserByUsername = maybeTransaction('getUserByUsername', async (client, username: string) => {
    return await client
      .select()
      .from(users)
      .where(ilike(users.username, username))
      .limit(1)
      .then(rows => rows[0]);
  })

  static touchUsername = maybeTransaction('touchUsername', async (client, platform: Platform, platformId: string, username: string | undefined, displayName?: string, avatarUrl?: string) => {
    const set: Partial<typeof users.$inferInsert> = {};
    const changed = [];
    if (username) { set.username = username; changed.push(sql`${users.username} IS DISTINCT FROM ${username}`); }
    if (displayName) { set.displayName = displayName; changed.push(sql`${users.displayName} IS DISTINCT FROM ${displayName}`); }
    if (avatarUrl) { set.avatarUrl = avatarUrl; changed.push(sql`${users.avatarUrl} IS DISTINCT FROM ${avatarUrl}`); }
    if (changed.length === 0) return;

    const [link] = await client
      .select({ userId: linkedAccounts.userId })
      .from(linkedAccounts)
      .where(and(eq(linkedAccounts.platform, platform), eq(linkedAccounts.platformId, platformId)))
      .limit(1);
    if (!link) return;

    await client
      .update(users)
      .set(set)
      .where(and(eq(users.id, link.userId), or(...changed)));
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

  static setSupportChannelJoined = maybeTransaction('setSupportChannelJoined', async (client, userId: number, joined: boolean) => {
    await client
      .update(users)
      .set({ hasJoinedSupportChannel: joined, supportChannelCheckedAt: new Date() })
      .where(eq(users.id, userId));
  })

  static resetMidnightStats = maybeTransaction('resetMidnightStats', async (client) => {
    await client
      .update(users)
      .set({ dailyStreak: 0 })
      .where(eq(users.hasGottenDaily, false));

    await client
      .update(users)
      .set({ hasGottenDaily: false, hasGivenRepToday: false });
  })

  static setRepGiven = maybeTransaction('setRepGiven', async (client, userId: number) => {
    return await client
      .update(users)
      .set({ hasGivenRepToday: true })
      .where(eq(users.id, userId))
      .returning()
      .then(rows => rows[0]);
  })

  static addReputation = maybeTransaction('addReputation', async (client, userId: number, amount: number) => {
    return await client
      .update(userProfiles)
      .set({ reputation: sql`${userProfiles.reputation} + ${amount}` })
      .where(eq(userProfiles.userId, userId))
      .returning()
      .then(rows => rows[0]);
  })

  static getUserProfileByPlatformAccount = maybeTransaction('getUserProfileByPlatformAccount', async (client, platform: Platform, platformId: string) => {
    return await client
      .select()
      .from(userProfiles)
      .innerJoin(users, eq(userProfiles.userId, users.id))
      .innerJoin(linkedAccounts, eq(linkedAccounts.userId, users.id))
      .where(and(eq(linkedAccounts.platform, platform), eq(linkedAccounts.platformId, platformId)))
      .limit(1)
      .then(a => a?.[0])
  })

  static getEquippedItemIds(profile?: { equipedBackgroundId: number | null; equipedStickerId: number | null }): { background: number | null; sticker: number | null } {
    return {
      background: profile?.equipedBackgroundId ?? null,
      sticker: profile?.equipedStickerId ?? null,
    };
  }

  static createUser = maybeTransaction('createUser', async (client, data: Omit<typeof users.$inferInsert, "id">) => {
    return await client.insert(users).values(data).returning().then(rows => rows[0]);
  })

  static createUserProfile = maybeTransaction('createUserProfile', async (client, userId: number) => {
    return await client.insert(userProfiles).values({ userId }).returning().then(rows => rows[0]);
  })

  static ensureUser = maybeTransaction('ensureUser', async (client, data: { platform: Platform; platformId: string; displayName: string; avatarUrl: string }) => {
    const existingLink = await client
      .select({ userId: linkedAccounts.userId })
      .from(linkedAccounts)
      .where(and(eq(linkedAccounts.platform, data.platform), eq(linkedAccounts.platformId, data.platformId)))
      .limit(1)
      .then(rows => rows[0]);

    if (existingLink) {
      return await client.select().from(users).where(eq(users.id, existingLink.userId)).limit(1).then(rows => rows[0] ?? null);
    }

    const [user] = await client
      .insert(users)
      .values({ displayName: data.displayName, avatarUrl: data.avatarUrl })
      .returning();
    if (!user) return null;

    await client.insert(userProfiles).values({ userId: user.id }).onConflictDoNothing();

    const [link] = await client
      .insert(linkedAccounts)
      .values({ userId: user.id, platform: data.platform, platformId: data.platformId })
      .onConflictDoNothing()
      .returning();

    if (link) return user;

    // lost a race to another concurrent insert - clean up our orphan and return the winner.
    await client.delete(userProfiles).where(eq(userProfiles.userId, user.id));
    await client.delete(users).where(eq(users.id, user.id));

    return await client
      .select({ users: users })
      .from(linkedAccounts)
      .innerJoin(users, eq(linkedAccounts.userId, users.id))
      .where(and(eq(linkedAccounts.platform, data.platform), eq(linkedAccounts.platformId, data.platformId)))
      .limit(1)
      .then(rows => rows[0]?.users ?? null);
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
      .set({ 
        usedDraws: sql`CASE WHEN ${users.usedDraws} < 0 THEN ${users.usedDraws} ELSE GREATEST(${users.usedDraws} - ${amount}, 0) END` 
      });
  })

  static giveTemporaryDraws = maybeTransaction('giveTemporaryDraws', async (client, userId: number, amount: number) => {
    return await client
      .update(users)
      .set({ usedDraws: sql`${users.usedDraws} - ${amount}` })
      .where(eq(users.id, userId))
      .returning()
      .then(rows => rows[0]);
  })

  static setMakeCardsTradeableByDefault = maybeTransaction('setMakeCardsTradeableByDefault', async (client, userId: number, value: boolean) => {
    return await client
      .update(users)
      .set({ makeCardsTradeableByDefault: value })
      .where(eq(users.id, userId))
      .returning()
      .then(rows => rows[0]);
  })

  static mergeUsers = maybeTransaction('mergeUsers', async (client, mainUserId: number, secondaryUserId: number) => {
    // dissolve marriages on both sides to avoid a dangling partnerId once secondary is deleted.
    const [mainProfile] = await client.select().from(userProfiles).where(eq(userProfiles.userId, mainUserId));
    const [secondaryProfile] = await client.select().from(userProfiles).where(eq(userProfiles.userId, secondaryUserId));

    for (const profile of [mainProfile, secondaryProfile]) {
      if (profile?.isMarried && profile.partnerId) {
        await client.update(userProfiles).set({ isMarried: false, partnerId: null }).where(eq(userProfiles.userId, profile.partnerId));
      }
    }
    await client.update(userProfiles).set({ isMarried: false, partnerId: null }).where(eq(userProfiles.userId, mainUserId));
    await client.update(userProfiles).set({ isMarried: false, partnerId: null }).where(eq(userProfiles.userId, secondaryUserId));

    await client.update(linkedAccounts).set({ userId: mainUserId }).where(eq(linkedAccounts.userId, secondaryUserId));

    const [secondaryUser] = await client.select({ coins: users.coins }).from(users).where(eq(users.id, secondaryUserId));
    const [secondaryProfileForRep] = await client.select({ reputation: userProfiles.reputation }).from(userProfiles).where(eq(userProfiles.userId, secondaryUserId));
    await client.update(users).set({ coins: sql`${users.coins} + ${secondaryUser?.coins ?? 0}` }).where(eq(users.id, mainUserId));
    await client.update(userProfiles).set({ reputation: sql`${userProfiles.reputation} + ${secondaryProfileForRep?.reputation ?? 0}` }).where(eq(userProfiles.userId, mainUserId));

    // sql.identifier() avoids hand-typed column names, which INSERT/ON CONFLICT require unqualified.
    await client.execute(sql`
      INSERT INTO ${userCards} (${sql.identifier(userCards.userId.name)}, ${sql.identifier(userCards.cardId.name)}, ${sql.identifier(userCards.count.name)}, ${sql.identifier(userCards.tradable.name)}, ${sql.identifier(userCards.updatedAt.name)})
      SELECT ${mainUserId}, ${userCards.cardId}, ${userCards.count}, ${userCards.tradable}, now() FROM ${userCards} WHERE ${userCards.userId} = ${secondaryUserId}
      ON CONFLICT (${sql.identifier(userCards.userId.name)}, ${sql.identifier(userCards.cardId.name)}) DO UPDATE SET ${sql.identifier(userCards.count.name)} = ${userCards}.${sql.identifier(userCards.count.name)} + excluded.${sql.identifier(userCards.count.name)}
    `);
    await client.delete(userCards).where(eq(userCards.userId, secondaryUserId));

    await client.execute(sql`
      INSERT INTO ${wishlist} (${sql.identifier(wishlist.userId.name)}, ${sql.identifier(wishlist.cardId.name)}, ${sql.identifier(wishlist.position.name)}, ${sql.identifier(wishlist.createdAt.name)})
      SELECT ${mainUserId}, ${wishlist.cardId}, ${wishlist.position}, ${wishlist.createdAt} FROM ${wishlist} WHERE ${wishlist.userId} = ${secondaryUserId}
      ON CONFLICT (${sql.identifier(wishlist.userId.name)}, ${sql.identifier(wishlist.cardId.name)}) DO NOTHING
    `);
    await client.delete(wishlist).where(eq(wishlist.userId, secondaryUserId));

    await client.execute(sql`
      INSERT INTO ${boughtItems} (${sql.identifier(boughtItems.userId.name)}, ${sql.identifier(boughtItems.itemId.name)}, ${sql.identifier(boughtItems.boughtAt.name)})
      SELECT ${mainUserId}, ${boughtItems.itemId}, ${boughtItems.boughtAt} FROM ${boughtItems} WHERE ${boughtItems.userId} = ${secondaryUserId}
      ON CONFLICT (${sql.identifier(boughtItems.userId.name)}, ${sql.identifier(boughtItems.itemId.name)}) DO NOTHING
    `);
    await client.delete(boughtItems).where(eq(boughtItems.userId, secondaryUserId));

    await client.update(cardDrawHistory).set({ userId: mainUserId }).where(eq(cardDrawHistory.userId, secondaryUserId));
    await client.update(auditLogs).set({ actorUserId: mainUserId }).where(eq(auditLogs.actorUserId, secondaryUserId));
    await client.update(trades).set({ user1Id: mainUserId }).where(eq(trades.user1Id, secondaryUserId));
    await client.update(trades).set({ user2Id: mainUserId }).where(eq(trades.user2Id, secondaryUserId));

    // main's singular fields already win by construction - just delete what's left of secondary.
    await client.delete(userProfiles).where(eq(userProfiles.userId, secondaryUserId));
    await client.delete(users).where(eq(users.id, secondaryUserId));
  })

}
