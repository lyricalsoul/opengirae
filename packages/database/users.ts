import { users, userProfiles, linkedAccounts } from "./schemas/users";
import { userCards, wishlist, cardDrawHistory, trades } from "./schemas/cards";
import { boughtItems } from "./schemas/vanities";
import { auditLogs } from "./schemas/audit";
import { EconomyDB } from "./economy";
import { economy } from "./schemas/economy";
import { maybeTransaction } from "./decorators";
import type { DrizzleClient } from "./decorators";
import { eq, sql, and, or, gte, ilike, desc, inArray, isNull } from "drizzle-orm";

export type Platform = 'telegram' | 'discord' | 'none';

type UserSortField = 'displayName' | 'coins' | 'usedDraws' | 'isBanned' | 'isAdmin';

// Full pre-merge snapshot of the account /link is about to dissolve - stored as an audit_logs
// row (action 'users.merge') so UsersDB.undoLastMergeForUser can rebuild it later. Everything
// here mirrors a side effect mergeUsers actually performs; if mergeUsers starts touching a new
// table, the snapshot (and the undo logic below) needs the matching new field.
type MergeSnapshot = {
  mainUserId: number
  secondaryUserId: number
  secondaryUser: Omit<typeof users.$inferSelect, 'coins'> & { coins: number }
  secondaryProfile: typeof userProfiles.$inferSelect | null
  dissolvedMarriages: Array<{ side: 'main' | 'secondary'; partnerUserId: number }>
  userCards: Array<{ cardId: number; count: number; tradable: boolean }>
  wishlist: Array<{ cardId: number; position: number }>
  boughtItems: Array<{ itemId: number; boughtAt: Date }>
  cardDrawHistoryIds: number[]
  auditLogIds: number[]
  tradesAsUser1Ids: number[]
  tradesAsUser2Ids: number[]
  linkedAccounts: Array<{ id: number; platform: string; platformId: string }>
}

export type UndoMergeResult =
  | { ok: false; reason: 'no_pending_merge' | 'already_reverted' }
  | {
    ok: true
    newSecondaryUserId: number
    movedLinkedAccounts: Array<{ platform: string; platformId: string }>
    coinsReturned: number
    coinsShortfall: number
    reputationReturned: number
    reputationShortfall: number
    cardShortfalls: Array<{ cardId: number; requested: number; returned: number }>
    restoredMarriages: number
    failedMarriages: number
  }

export const GIRO_PACKAGE_TIERS = [
  { giros: 10, price: 10000 },
  { giros: 15, price: 20000 },
  { giros: 20, price: 30000 },
  { giros: 25, price: 40000 },
  { giros: 30, price: 50000 },
] as const;

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

  static getUsersByIds = maybeTransaction('getUsersByIds', async (client, ids: number[]) => {
    if (ids.length === 0) return [];
    return await client.select().from(users).where(inArray(users.id, ids));
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

  // Batched getPlatformIdForUser, for building mention() links without one query per user.
  static getPlatformIdsForUsers = maybeTransaction('getPlatformIdsForUsers', async (client, userIds: number[], platform: Platform): Promise<Map<number, string>> => {
    if (userIds.length === 0) return new Map();
    const rows = await client
      .select({ userId: linkedAccounts.userId, platformId: linkedAccounts.platformId })
      .from(linkedAccounts)
      .where(and(inArray(linkedAccounts.userId, userIds), eq(linkedAccounts.platform, platform)));
    return new Map(rows.map(r => [r.userId, r.platformId]));
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

  // unlike spendCoins, doesn't touch the treasury or treasuryContributed - this is a confiscation, not a purchase.
  static removeCoins = maybeTransaction('removeCoins', async (client, userId: number, amount: number): Promise<boolean> => {
    const [updated] = await client
      .update(users)
      .set({ coins: sql`${users.coins} - ${amount}` })
      .where(and(eq(users.id, userId), gte(users.coins, amount)))
      .returning();
    return !!updated;
  })

  static spendCoins = maybeTransaction('spendCoins', async (client, userId: number, amount: number): Promise<boolean> => {
    return await EconomyDB.deductCoinsToTreasury(client, userId, amount);
  })

  // player-to-player transfer (e.g. /pix) - unlike spendCoins, doesn't touch the treasury since nothing is being bought
  static transferCoins = maybeTransaction('transferCoins', async (client, fromUserId: number, toUserId: number, amount: number): Promise<boolean> => {
    const [spendRow] = await client
      .update(users)
      .set({ coins: sql`${users.coins} - ${amount}` })
      .where(and(eq(users.id, fromUserId), gte(users.coins, amount)))
      .returning();
    if (!spendRow) return false;

    await client.update(users).set({ coins: sql`${users.coins} + ${amount}` }).where(eq(users.id, toUserId));
    return true;
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
      .set({ hasGottenDaily: false, hasGivenRepToday: false, giroPackagesBoughtToday: 0 });
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

  // single guarded UPDATE claims the tier slot, spends coins, and grants draws atomically -
  // zero rows updated covers insufficient funds, a stale/already-claimed tier, and exhaustion
  // all at once; the caller re-reads the row afterward to report which one it was.
  static buyGiroPackage = maybeTransaction('buyGiroPackage', async (
    client, userId: number, expectedTierIndex: number, price: number, giros: number
  ): Promise<{ ok: true } | { ok: false }> => {
    const [updated] = await client
      .update(users)
      .set({
        coins: sql`${users.coins} - ${price}`,
        giroPackagesBoughtToday: sql`${users.giroPackagesBoughtToday} + 1`,
        usedDraws: sql`${users.usedDraws} - ${giros}`,
        treasuryContributed: sql`${users.treasuryContributed} + ${price}`,
      })
      .where(and(
        eq(users.id, userId),
        gte(users.coins, price),
        eq(users.giroPackagesBoughtToday, expectedTierIndex),
      ))
      .returning();
    if (!updated) return { ok: false };

    await client.update(economy).set({ treasuryBalance: sql`${economy.treasuryBalance} + ${price}` });
    return { ok: true };
  })

  // AuditDB.revertDonation's penalty chain, step 2: take one available draw atomically.
  static async tryConsumeDrawAsPenaltyWithClient(client: DrizzleClient, userId: number): Promise<boolean> {
    const [row] = await client
      .update(users)
      .set({ usedDraws: sql`${users.usedDraws} + 1` })
      .where(and(eq(users.id, userId), sql`${users.usedDraws} < ${users.maxDraws}`))
      .returning();
    return !!row;
  }

  static giveTemporaryDraws = maybeTransaction('giveTemporaryDraws', async (client, userId: number, amount: number) => {
    return await client
      .update(users)
      .set({ usedDraws: sql`${users.usedDraws} - ${amount}` })
      .where(eq(users.id, userId))
      .returning()
      .then(rows => rows[0]);
  })

  // clamped at maxDraws so remaining draws (maxDraws - usedDraws) never goes negative.
  static takeTemporaryDraws = maybeTransaction('takeTemporaryDraws', async (client, userId: number, amount: number) => {
    return await client
      .update(users)
      .set({ usedDraws: sql`LEAST(${users.usedDraws} + ${amount}, ${users.maxDraws})` })
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
    // snapshot everything mergeUsers is about to touch on the secondary side, BEFORE any
    // mutation - this is what UsersDB.undoLastMergeForUser rebuilds the account from later.
    const [secondaryUser] = await client.select().from(users).where(eq(users.id, secondaryUserId));
    const [secondaryProfile] = await client.select().from(userProfiles).where(eq(userProfiles.userId, secondaryUserId));
    const [mainProfile] = await client.select().from(userProfiles).where(eq(userProfiles.userId, mainUserId));
    const secondaryCardsSnapshot = await client.select({ cardId: userCards.cardId, count: userCards.count, tradable: userCards.tradable }).from(userCards).where(eq(userCards.userId, secondaryUserId));
    const secondaryWishlistSnapshot = await client.select({ cardId: wishlist.cardId, position: wishlist.position }).from(wishlist).where(eq(wishlist.userId, secondaryUserId));
    const secondaryBoughtSnapshot = await client.select({ itemId: boughtItems.itemId, boughtAt: boughtItems.boughtAt }).from(boughtItems).where(eq(boughtItems.userId, secondaryUserId));
    const secondaryDrawHistoryIds = (await client.select({ id: cardDrawHistory.id }).from(cardDrawHistory).where(eq(cardDrawHistory.userId, secondaryUserId))).map(r => r.id);
    const secondaryAuditLogIds = (await client.select({ id: auditLogs.id }).from(auditLogs).where(eq(auditLogs.actorUserId, secondaryUserId))).map(r => r.id);
    const tradesAsUser1Ids = (await client.select({ id: trades.id }).from(trades).where(eq(trades.user1Id, secondaryUserId))).map(r => r.id);
    const tradesAsUser2Ids = (await client.select({ id: trades.id }).from(trades).where(eq(trades.user2Id, secondaryUserId))).map(r => r.id);
    const secondaryLinkedAccounts = await client.select({ id: linkedAccounts.id, platform: linkedAccounts.platform, platformId: linkedAccounts.platformId }).from(linkedAccounts).where(eq(linkedAccounts.userId, secondaryUserId));

    // dissolve marriages on both sides to avoid a dangling partnerId once secondary is deleted.
    const dissolvedMarriages: MergeSnapshot['dissolvedMarriages'] = [];
    for (const [side, profile] of [['main', mainProfile], ['secondary', secondaryProfile]] as const) {
      if (profile?.isMarried && profile.partnerId) {
        dissolvedMarriages.push({ side, partnerUserId: profile.partnerId });
        await client.update(userProfiles).set({ isMarried: false, partnerId: null }).where(eq(userProfiles.userId, profile.partnerId));
      }
    }
    await client.update(userProfiles).set({ isMarried: false, partnerId: null }).where(eq(userProfiles.userId, mainUserId));
    await client.update(userProfiles).set({ isMarried: false, partnerId: null }).where(eq(userProfiles.userId, secondaryUserId));

    await client.update(linkedAccounts).set({ userId: mainUserId }).where(eq(linkedAccounts.userId, secondaryUserId));

    await client.update(users).set({ coins: sql`${users.coins} + ${secondaryUser?.coins ?? 0}` }).where(eq(users.id, mainUserId));
    await client.update(userProfiles).set({ reputation: sql`${userProfiles.reputation} + ${secondaryProfile?.reputation ?? 0}` }).where(eq(userProfiles.userId, mainUserId));

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

    const snapshot: MergeSnapshot = {
      mainUserId, secondaryUserId,
      secondaryUser: secondaryUser!,
      secondaryProfile: secondaryProfile ?? null,
      dissolvedMarriages,
      userCards: secondaryCardsSnapshot,
      wishlist: secondaryWishlistSnapshot,
      boughtItems: secondaryBoughtSnapshot,
      cardDrawHistoryIds: secondaryDrawHistoryIds,
      auditLogIds: secondaryAuditLogIds,
      tradesAsUser1Ids, tradesAsUser2Ids,
      linkedAccounts: secondaryLinkedAccounts,
    };
    await client.insert(auditLogs).values({ actorUserId: mainUserId, action: 'users.merge', metadata: snapshot });
  })

  // /unlink: finds the most recent not-yet-undone /link for this (now-merged) account and
  // reverses it. Claim-lock on the audit_logs row (revertedAt IS NULL) makes this safe even if
  // two staff race - see AuditDB.revertDonation for the same pattern. Coins/reputation/card
  // counts are only reversible up to whatever main *currently* has (main may have spent some of
  // what came in from the merge since) - this clamps to what's available and reports the
  // shortfall rather than going negative or refusing outright. See docs/agent/03-commands.md.
  static undoLastMergeForUser = maybeTransaction('undoLastMergeForUser', async (client, mainUserId: number, adminUserId: number): Promise<UndoMergeResult> => {
    const [pending] = await client
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(and(
        eq(auditLogs.action, 'users.merge'),
        sql`(${auditLogs.metadata}->>'mainUserId')::int = ${mainUserId}`,
        isNull(auditLogs.revertedAt),
      ))
      .orderBy(desc(auditLogs.createdAt))
      .limit(1);
    if (!pending) return { ok: false, reason: 'no_pending_merge' };

    const [claimed] = await client
      .update(auditLogs)
      .set({ revertedAt: sql`now()`, revertedByAdminId: adminUserId })
      .where(and(eq(auditLogs.id, pending.id), eq(auditLogs.action, 'users.merge'), isNull(auditLogs.revertedAt)))
      .returning();
    if (!claimed) return { ok: false, reason: 'already_reverted' };

    const snap = claimed.metadata as MergeSnapshot;
    const { mainUserId: snapMainId, secondaryUserId, secondaryUser, secondaryProfile } = snap;

    const { id: _oldId, createdAt, updatedAt: _updatedAt, avatarUpdatedAt, supportChannelCheckedAt, coins: secondaryCoins, ...secondaryUserRest } = secondaryUser;

    const [mainUserRow] = await client.select({ coins: users.coins }).from(users).where(eq(users.id, snapMainId));
    const coinsReturned = Math.min(secondaryCoins, mainUserRow?.coins ?? 0);
    const coinsShortfall = secondaryCoins - coinsReturned;

    const [newSecondary] = await client.insert(users).values({
      ...secondaryUserRest,
      createdAt: new Date(createdAt),
      avatarUpdatedAt: avatarUpdatedAt ? new Date(avatarUpdatedAt) : null,
      supportChannelCheckedAt: supportChannelCheckedAt ? new Date(supportChannelCheckedAt) : null,
      coins: coinsReturned,
    }).returning();
    const newSecondaryId = newSecondary!.id;
    await client.update(users).set({ coins: sql`${users.coins} - ${coinsReturned}` }).where(eq(users.id, snapMainId));

    let reputationReturned = 0;
    let reputationShortfall = 0;
    if (secondaryProfile) {
      const { id: _profId, userId: _profUserId, createdAt: profCreatedAt, updatedAt: _profUpdatedAt, isMarried: _im, partnerId: _pid, reputation: secondaryReputation, ...profileRest } = secondaryProfile;
      const [mainProfileRow] = await client.select({ reputation: userProfiles.reputation }).from(userProfiles).where(eq(userProfiles.userId, snapMainId));
      reputationReturned = Math.min(secondaryReputation, mainProfileRow?.reputation ?? 0);
      reputationShortfall = secondaryReputation - reputationReturned;

      await client.insert(userProfiles).values({
        ...profileRest,
        userId: newSecondaryId,
        createdAt: new Date(profCreatedAt),
        reputation: reputationReturned,
        isMarried: false,
        partnerId: null,
      });
      await client.update(userProfiles).set({ reputation: sql`${userProfiles.reputation} - ${reputationReturned}` }).where(eq(userProfiles.userId, snapMainId));
    } else {
      // every user row is expected to have exactly one profile row (see UsersDB.ensureUser) -
      // the secondary somehow didn't, so give the resurrected account a fresh default one.
      await client.insert(userProfiles).values({ userId: newSecondaryId }).onConflictDoNothing();
    }

    // marriages: dedupe by unordered pair first (a mutual main<->secondary marriage produces two
    // snapshot entries pointing at each other) and resolve against LIVE state, not state this
    // same loop is mutating, or the second entry of a mutual pair would see itself as "already
    // remarried" from the first entry's own update.
    const pairKey = (a: number, b: number) => [a, b].sort((x, y) => x - y).join('-');
    const pairs = new Map<string, { a: number; b: number }>();
    for (const m of snap.dissolvedMarriages) {
      const restoreToUserId = m.side === 'main' ? snapMainId : newSecondaryId;
      const partnerUserId = m.partnerUserId === secondaryUserId ? newSecondaryId : m.partnerUserId;
      pairs.set(pairKey(restoreToUserId, partnerUserId), { a: restoreToUserId, b: partnerUserId });
    }
    let restoredMarriages = 0;
    let failedMarriages = 0;
    for (const { a, b } of pairs.values()) {
      const [profA] = await client.select({ isMarried: userProfiles.isMarried }).from(userProfiles).where(eq(userProfiles.userId, a));
      const [profB] = await client.select({ isMarried: userProfiles.isMarried }).from(userProfiles).where(eq(userProfiles.userId, b));
      if (profA && !profA.isMarried && profB && !profB.isMarried) {
        await client.update(userProfiles).set({ isMarried: true, partnerId: b }).where(eq(userProfiles.userId, a));
        await client.update(userProfiles).set({ isMarried: true, partnerId: a }).where(eq(userProfiles.userId, b));
        restoredMarriages++;
      } else {
        failedMarriages++;
      }
    }

    const cardShortfalls: Array<{ cardId: number; requested: number; returned: number }> = [];
    for (const c of snap.userCards) {
      const [row] = await client.select({ count: userCards.count }).from(userCards).where(and(eq(userCards.userId, snapMainId), eq(userCards.cardId, c.cardId)));
      const available = row?.count ?? 0;
      const returned = Math.min(c.count, available);
      if (returned < c.count) cardShortfalls.push({ cardId: c.cardId, requested: c.count, returned });
      if (returned <= 0) continue;

      await client.insert(userCards).values({ userId: newSecondaryId, cardId: c.cardId, count: returned, tradable: c.tradable });
      const remaining = available - returned;
      if (remaining > 0) await client.update(userCards).set({ count: remaining }).where(and(eq(userCards.userId, snapMainId), eq(userCards.cardId, c.cardId)));
      else await client.delete(userCards).where(and(eq(userCards.userId, snapMainId), eq(userCards.cardId, c.cardId)));
    }

    // wishlist/boughtItems have no fungible amount - only move an entry back if main still has
    // it (if main already removed it, or re-added the same card/item independently since the
    // merge, there's nothing distinguishable left to hand back).
    for (const w of snap.wishlist) {
      const [row] = await client.select().from(wishlist).where(and(eq(wishlist.userId, snapMainId), eq(wishlist.cardId, w.cardId)));
      if (!row) continue;
      await client.delete(wishlist).where(and(eq(wishlist.userId, snapMainId), eq(wishlist.cardId, w.cardId)));
      await client.insert(wishlist).values({ userId: newSecondaryId, cardId: w.cardId, position: w.position }).onConflictDoNothing();
    }
    for (const b of snap.boughtItems) {
      const [row] = await client.select().from(boughtItems).where(and(eq(boughtItems.userId, snapMainId), eq(boughtItems.itemId, b.itemId)));
      if (!row) continue;
      await client.delete(boughtItems).where(and(eq(boughtItems.userId, snapMainId), eq(boughtItems.itemId, b.itemId)));
      await client.insert(boughtItems).values({ userId: newSecondaryId, itemId: b.itemId, boughtAt: new Date(b.boughtAt) }).onConflictDoNothing();
    }

    // history/log/trade rows are row-id based, not amount-based - repoint exactly what was
    // captured, only if still attributed to main (never touch rows main generated on its own).
    if (snap.cardDrawHistoryIds.length) await client.update(cardDrawHistory).set({ userId: newSecondaryId }).where(and(inArray(cardDrawHistory.id, snap.cardDrawHistoryIds), eq(cardDrawHistory.userId, snapMainId)));
    if (snap.auditLogIds.length) await client.update(auditLogs).set({ actorUserId: newSecondaryId }).where(and(inArray(auditLogs.id, snap.auditLogIds), eq(auditLogs.actorUserId, snapMainId)));
    if (snap.tradesAsUser1Ids.length) await client.update(trades).set({ user1Id: newSecondaryId }).where(and(inArray(trades.id, snap.tradesAsUser1Ids), eq(trades.user1Id, snapMainId)));
    if (snap.tradesAsUser2Ids.length) await client.update(trades).set({ user2Id: newSecondaryId }).where(and(inArray(trades.id, snap.tradesAsUser2Ids), eq(trades.user2Id, snapMainId)));

    const linkedAccountIds = snap.linkedAccounts.map(a => a.id);
    let movedLinkedAccounts: MergeSnapshot['linkedAccounts'] = [];
    if (linkedAccountIds.length) {
      movedLinkedAccounts = await client
        .update(linkedAccounts)
        .set({ userId: newSecondaryId })
        .where(and(inArray(linkedAccounts.id, linkedAccountIds), eq(linkedAccounts.userId, snapMainId)))
        .returning({ id: linkedAccounts.id, platform: linkedAccounts.platform, platformId: linkedAccounts.platformId });
    }

    await client.insert(auditLogs).values({
      actorUserId: adminUserId,
      action: 'users.unlink',
      metadata: { mergeLogId: claimed.id, mainUserId: snapMainId, newSecondaryUserId: newSecondaryId },
    });

    return {
      ok: true,
      newSecondaryUserId: newSecondaryId,
      movedLinkedAccounts: movedLinkedAccounts.map(a => ({ platform: a.platform, platformId: a.platformId })),
      coinsReturned, coinsShortfall,
      reputationReturned, reputationShortfall,
      cardShortfalls,
      restoredMarriages, failedMarriages,
    };
  })

}
