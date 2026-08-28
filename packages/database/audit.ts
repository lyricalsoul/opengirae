import { maybeTransaction } from "./decorators";
import type { DrizzleClient } from "./decorators";
import { auditLogs } from "./schemas/audit";
import { eq, desc, and, or, inArray, sql, isNull } from "drizzle-orm";
import { UsersDB } from "./users";
import { CardsDB, DONATION_REVERT_PENALTY_COINS } from "./cards";
import type { DonationRevertPenalty } from "./cards";
import { DiscotecaDB } from "./discoteca";
import { EconomyDB } from "./economy";

const DONATION_ACTIONS = ['card.doar', 'card.doarclc'];
const DISCOTECA_DONATION_ACTIONS = ['discoteca.doar', 'discoteca.doarclc'];

type DonationCardOffer = { cardId: number; count: number };
// legacy rows only have distinct cardIds (quantity collapsed) - see 06-prod-operations.md.
type DoarMeta = { recipientUserId: number; cards?: DonationCardOffer[]; cardIds?: number[]; subcategoryId?: number };

function normalizeDonationCards(meta: DoarMeta): DonationCardOffer[] {
  return meta.cards ?? (meta.cardIds ?? []).map(cardId => ({ cardId, count: 1 }));
}

type DonationRevertUnitOutcome = Extract<DonationRevertPenalty, { ok: true }> & { donatedCardId: number };

export class DonationRevertImpossibleError extends Error {
  constructor(public cardId: number) {
    super(`cannot revert: recipient has nothing left to take for card ${cardId} (no copy, no draw, no coins, no same-tier card)`);
  }
}

type DonationEntryOffer = { entryId: number; count: number };
type DiscoDoarMeta = { recipientUserId: number; entries: DonationEntryOffer[]; artistId?: number };

// mirrors DonationRevertPenalty (cards.ts) one-for-one, entry-flavored instead of card-flavored.
type DiscotecaDonationRevertPenalty =
  | { ok: true; penalty: 'entry_returned' }
  | { ok: true; penalty: 'draw_taken' }
  | { ok: true; penalty: 'coins_taken'; amount: number }
  | { ok: true; penalty: 'same_tier_entry_taken'; takenEntryId: number }
  | { ok: false };

type DiscotecaDonationRevertUnitOutcome = Extract<DiscotecaDonationRevertPenalty, { ok: true }> & { donatedEntryId: number };

export class DiscotecaDonationRevertImpossibleError extends Error {
  constructor(public entryId: number) {
    super(`cannot revert: recipient has nothing left to take for discoteca entry ${entryId} (no copy, no draw, no coins, no same-tier entry)`);
  }
}

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

  // recipientUserId lives in jsonb metadata (no FK), hence the casts below. opts.direction
  // narrows to one side; opts.withUserId narrows to just this pair; opts.platform additionally
  // resolves each party's platform id (for mention() links, /doacoes only).
  static getDonationHistory = maybeTransaction('getDonationHistory', async (client, userId: number, opts: {
    limit?: number; offset?: number; direction?: 'sent' | 'received'; withUserId?: number; platform?: 'telegram' | 'discord';
  } = {}) => {
    const limit = opts.limit ?? 20;
    const offset = opts.offset ?? 0;
    const sentCond = eq(auditLogs.actorUserId, userId);
    const receivedCond = sql`(${auditLogs.metadata}->>'recipientUserId')::int = ${userId}`;

    const membershipCond = opts.withUserId !== undefined
      ? or(
        and(sentCond, sql`(${auditLogs.metadata}->>'recipientUserId')::int = ${opts.withUserId}`),
        and(eq(auditLogs.actorUserId, opts.withUserId), receivedCond),
      )
      : opts.direction === 'sent' ? sentCond
      : opts.direction === 'received' ? receivedCond
      : or(sentCond, receivedCond);

    const where = and(inArray(auditLogs.action, DONATION_ACTIONS), membershipCond);

    const [rows, total] = await Promise.all([
      client.select().from(auditLogs).where(where).orderBy(desc(auditLogs.createdAt)).limit(limit).offset(offset),
      client.select({ total: sql<number>`count(*)::int` }).from(auditLogs).where(where).then(r => r[0]?.total ?? 0),
    ]);

    const metas = rows.map(r => r.metadata as DoarMeta);
    const offers = metas.map(normalizeDonationCards);

    const otherUserIds = new Set<number>();
    for (const row of rows) otherUserIds.add(row.actorUserId);
    for (const meta of metas) otherUserIds.add(meta.recipientUserId);
    for (const row of rows) if (row.revertedByAdminId !== null) otherUserIds.add(row.revertedByAdminId);

    const cardIds = [...new Set(offers.flatMap(o => o.map(c => c.cardId)))];
    const subcategoryIds = [...new Set(metas.map(m => m.subcategoryId).filter((id): id is number => id !== undefined))];

    const [users, platformIdById, cardDetails, subcats] = await Promise.all([
      UsersDB.getUsersByIds([...otherUserIds]),
      opts.platform ? UsersDB.getPlatformIdsForUsers([...otherUserIds], opts.platform) : Promise.resolve(new Map<number, string>()),
      CardsDB.getCardsWithDetailsByIds(cardIds),
      CardsDB.getSubcategoriesByIds(subcategoryIds),
    ]);

    const nameById = new Map(users.map(u => [u.id, u.displayName]));
    const cardById = new Map(cardDetails.map(c => [c.id, c]));
    const subcategoryNameById = new Map(subcats.map(s => [s.id, s.name]));

    const enriched = rows.map((row, i) => {
      const meta = metas[i]!;
      const offer = offers[i]!;
      return {
        id: row.id,
        action: row.action,
        createdAt: row.createdAt,
        direction: (row.actorUserId === userId ? 'sent' : 'received') as 'sent' | 'received',
        donorUserId: row.actorUserId,
        donorName: nameById.get(row.actorUserId) ?? null,
        donorPlatformId: platformIdById.get(row.actorUserId) ?? null,
        recipientUserId: meta.recipientUserId,
        recipientName: nameById.get(meta.recipientUserId) ?? null,
        recipientPlatformId: platformIdById.get(meta.recipientUserId) ?? null,
        subcategoryName: meta.subcategoryId !== undefined ? (subcategoryNameById.get(meta.subcategoryId) ?? null) : undefined,
        cards: offer
          .map(o => {
            const c = cardById.get(o.cardId);
            return c ? { id: c.id, name: c.name, rarityEmoji: c.rarityEmoji, count: o.count } : undefined;
          })
          .filter(c => c !== undefined),
        revertedAt: row.revertedAt,
        revertedByAdminName: row.revertedByAdminId !== null ? (nameById.get(row.revertedByAdminId) ?? null) : null,
        revertedByAdminPlatformId: row.revertedByAdminId !== null ? (platformIdById.get(row.revertedByAdminId) ?? null) : null,
      };
    });

    return { rows: enriched, total };
  })

  // Reverts a donation card-by-card, falling back to a penalty (draw/coins/same-tier card) when
  // the recipient no longer has a given card - see docs/agent/06-prod-operations.md. Rolls back
  // entirely (DonationRevertImpossibleError) if even one unit has no fallback left.
  static async revertDonation(auditLogId: number, adminUserId: number) {
    try {
      return await AuditDB.revertDonationTx(auditLogId, adminUserId);
    } catch (e) {
      if (e instanceof DonationRevertImpossibleError) return { ok: false as const, reason: 'nothing_to_penalize' as const, cardId: e.cardId };
      throw e;
    }
  }

  // claim-lock: WHERE revertedAt IS NULL makes double-reverting impossible even if two admins race.
  private static revertDonationTx = maybeTransaction('revertDonation', async (client, auditLogId: number, adminUserId: number) => {
    const [claimed] = await client
      .update(auditLogs)
      .set({ revertedAt: sql`now()`, revertedByAdminId: adminUserId })
      .where(and(eq(auditLogs.id, auditLogId), inArray(auditLogs.action, DONATION_ACTIONS), isNull(auditLogs.revertedAt)))
      .returning();
    if (!claimed) return { ok: false as const, reason: 'not_found_or_already_reverted' as const };

    const meta = claimed.metadata as DoarMeta;
    const donorId = claimed.actorUserId;
    const recipientId = meta.recipientUserId;
    const offer = normalizeDonationCards(meta);

    const incomeInflationRate = await EconomyDB.getIncomeInflationRate();
    const unitOutcomes: DonationRevertUnitOutcome[] = [];

    for (const { cardId, count } of offer) {
      for (let i = 0; i < count; i++) {
        const outcome = await AuditDB.applyDonationRevertPenaltyWithClient(client, recipientId, cardId, incomeInflationRate);
        if (!outcome.ok) throw new DonationRevertImpossibleError(cardId);
        unitOutcomes.push({ ...outcome, donatedCardId: cardId });
        await CardsDB.addUserCardWithClient(client, donorId, cardId, incomeInflationRate);
      }
    }

    await client.insert(auditLogs).values({
      actorUserId: donorId,
      action: 'card.doar.revert',
      metadata: { originalLogId: auditLogId, recipientUserId: recipientId, revertedByAdminId: adminUserId, unitOutcomes },
    });

    return { ok: true as const, donorId, recipientId, unitOutcomes };
  })

  // one card unit's penalty chain: draw, then coins (to the treasury), then a same-rarity card.
  private static async applyDonationRevertPenaltyWithClient(
    client: DrizzleClient, recipientId: number, cardId: number, incomeInflationRate: number,
  ): Promise<DonationRevertPenalty> {
    if (await CardsDB.tryDecrementOneWithClient(client, recipientId, cardId)) {
      return { ok: true, penalty: 'card_returned' };
    }
    if (await UsersDB.tryConsumeDrawAsPenaltyWithClient(client, recipientId)) {
      return { ok: true, penalty: 'draw_taken' };
    }
    if (await EconomyDB.deductCoinsToTreasury(client, recipientId, DONATION_REVERT_PENALTY_COINS)) {
      return { ok: true, penalty: 'coins_taken', amount: DONATION_REVERT_PENALTY_COINS };
    }
    const rarityId = await CardsDB.getCardRarityIdWithClient(client, cardId);
    if (rarityId !== null) {
      // retry a few times in case a concurrent write claims the candidate card first.
      for (let attempt = 0; attempt < 3; attempt++) {
        const candidateId = await CardsDB.findOwnedCardOfRarityWithClient(client, recipientId, rarityId);
        if (candidateId === null) break;
        if (await CardsDB.tryDecrementOneWithClient(client, recipientId, candidateId)) {
          return { ok: true, penalty: 'same_tier_card_taken', takenCardId: candidateId };
        }
      }
    }
    return { ok: false };
  }

  // same jsonb-metadata shape as getDonationHistory - entries/artist instead of cards/subcategory.
  static getDiscotecaDonationHistory = maybeTransaction('getDiscotecaDonationHistory', async (client, userId: number, opts: {
    limit?: number; offset?: number; direction?: 'sent' | 'received'; withUserId?: number; platform?: 'telegram' | 'discord';
  } = {}) => {
    const limit = opts.limit ?? 20;
    const offset = opts.offset ?? 0;
    const sentCond = eq(auditLogs.actorUserId, userId);
    const receivedCond = sql`(${auditLogs.metadata}->>'recipientUserId')::int = ${userId}`;

    const membershipCond = opts.withUserId !== undefined
      ? or(
        and(sentCond, sql`(${auditLogs.metadata}->>'recipientUserId')::int = ${opts.withUserId}`),
        and(eq(auditLogs.actorUserId, opts.withUserId), receivedCond),
      )
      : opts.direction === 'sent' ? sentCond
      : opts.direction === 'received' ? receivedCond
      : or(sentCond, receivedCond);

    const where = and(inArray(auditLogs.action, DISCOTECA_DONATION_ACTIONS), membershipCond);

    const [rows, total] = await Promise.all([
      client.select().from(auditLogs).where(where).orderBy(desc(auditLogs.createdAt)).limit(limit).offset(offset),
      client.select({ total: sql<number>`count(*)::int` }).from(auditLogs).where(where).then(r => r[0]?.total ?? 0),
    ]);

    const metas = rows.map(r => r.metadata as DiscoDoarMeta);

    const otherUserIds = new Set<number>();
    for (const row of rows) otherUserIds.add(row.actorUserId);
    for (const meta of metas) otherUserIds.add(meta.recipientUserId);
    for (const row of rows) if (row.revertedByAdminId !== null) otherUserIds.add(row.revertedByAdminId);

    const entryIds = [...new Set(metas.flatMap(m => m.entries.map(e => e.entryId)))];
    const artistIds = [...new Set(metas.map(m => m.artistId).filter((id): id is number => id !== undefined))];

    const [users, platformIdById, entryDetails, artists] = await Promise.all([
      UsersDB.getUsersByIds([...otherUserIds]),
      opts.platform ? UsersDB.getPlatformIdsForUsers([...otherUserIds], opts.platform) : Promise.resolve(new Map<number, string>()),
      DiscotecaDB.getEntriesByIds(entryIds),
      DiscotecaDB.getArtistsByIds(artistIds),
    ]);

    const nameById = new Map(users.map(u => [u.id, u.displayName]));
    const entryById = new Map(entryDetails.map(e => [e.id, e]));
    const artistNameById = new Map(artists.map(a => [a.id, a.name]));

    const enriched = rows.map((row, i) => {
      const meta = metas[i]!;
      return {
        id: row.id,
        action: row.action,
        createdAt: row.createdAt,
        direction: (row.actorUserId === userId ? 'sent' : 'received') as 'sent' | 'received',
        donorUserId: row.actorUserId,
        donorName: nameById.get(row.actorUserId) ?? null,
        donorPlatformId: platformIdById.get(row.actorUserId) ?? null,
        recipientUserId: meta.recipientUserId,
        recipientName: nameById.get(meta.recipientUserId) ?? null,
        recipientPlatformId: platformIdById.get(meta.recipientUserId) ?? null,
        artistName: meta.artistId !== undefined ? (artistNameById.get(meta.artistId) ?? null) : undefined,
        entries: meta.entries
          .map(o => {
            const e = entryById.get(o.entryId);
            return e ? { id: e.id, name: e.name, type: e.type, rarityEmoji: e.rarityEmoji, count: o.count } : undefined;
          })
          .filter(e => e !== undefined),
        revertedAt: row.revertedAt,
        revertedByAdminName: row.revertedByAdminId !== null ? (nameById.get(row.revertedByAdminId) ?? null) : null,
        revertedByAdminPlatformId: row.revertedByAdminId !== null ? (platformIdById.get(row.revertedByAdminId) ?? null) : null,
      };
    });

    return { rows: enriched, total };
  })

  // reverts a Discoteca donation entry-by-entry, falling back to a penalty when the recipient no longer has a given entry - same shape as revertDonation.
  static async revertDiscotecaDonation(auditLogId: number, adminUserId: number) {
    try {
      return await AuditDB.revertDiscotecaDonationTx(auditLogId, adminUserId);
    } catch (e) {
      if (e instanceof DiscotecaDonationRevertImpossibleError) return { ok: false as const, reason: 'nothing_to_penalize' as const, entryId: e.entryId };
      throw e;
    }
  }

  private static revertDiscotecaDonationTx = maybeTransaction('revertDiscotecaDonation', async (client, auditLogId: number, adminUserId: number) => {
    const [claimed] = await client
      .update(auditLogs)
      .set({ revertedAt: sql`now()`, revertedByAdminId: adminUserId })
      .where(and(eq(auditLogs.id, auditLogId), inArray(auditLogs.action, DISCOTECA_DONATION_ACTIONS), isNull(auditLogs.revertedAt)))
      .returning();
    if (!claimed) return { ok: false as const, reason: 'not_found_or_already_reverted' as const };

    const meta = claimed.metadata as DiscoDoarMeta;
    const donorId = claimed.actorUserId;
    const recipientId = meta.recipientUserId;

    const unitOutcomes: DiscotecaDonationRevertUnitOutcome[] = [];

    for (const { entryId, count } of meta.entries) {
      for (let i = 0; i < count; i++) {
        const outcome = await AuditDB.applyDiscotecaDonationRevertPenaltyWithClient(client, recipientId, entryId);
        if (!outcome.ok) throw new DiscotecaDonationRevertImpossibleError(entryId);
        unitOutcomes.push({ ...outcome, donatedEntryId: entryId });
        await DiscotecaDB.incrementWithClient(client, donorId, entryId, 1);
      }
    }

    await client.insert(auditLogs).values({
      actorUserId: donorId,
      action: 'discoteca.doar.revert',
      metadata: { originalLogId: auditLogId, recipientUserId: recipientId, revertedByAdminId: adminUserId, unitOutcomes },
    });

    return { ok: true as const, donorId, recipientId, unitOutcomes };
  })

  // one entry unit's penalty chain: draw, then coins (to the treasury), then a same-rarity entry.
  private static async applyDiscotecaDonationRevertPenaltyWithClient(
    client: DrizzleClient, recipientId: number, entryId: number,
  ): Promise<DiscotecaDonationRevertPenalty> {
    if (await DiscotecaDB.tryDecrementOneWithClient(client, recipientId, entryId)) {
      return { ok: true, penalty: 'entry_returned' };
    }
    if (await UsersDB.tryConsumeDrawAsPenaltyWithClient(client, recipientId)) {
      return { ok: true, penalty: 'draw_taken' };
    }
    if (await EconomyDB.deductCoinsToTreasury(client, recipientId, DONATION_REVERT_PENALTY_COINS)) {
      return { ok: true, penalty: 'coins_taken', amount: DONATION_REVERT_PENALTY_COINS };
    }
    const rarityId = await DiscotecaDB.getEntryRarityIdWithClient(client, entryId);
    if (rarityId !== null) {
      // retry a few times in case a concurrent write claims the candidate entry first.
      for (let attempt = 0; attempt < 3; attempt++) {
        const candidateId = await DiscotecaDB.findOwnedEntryOfRarityWithClient(client, recipientId, rarityId);
        if (candidateId === null) break;
        if (await DiscotecaDB.tryDecrementOneWithClient(client, recipientId, candidateId)) {
          return { ok: true, penalty: 'same_tier_entry_taken', takenEntryId: candidateId };
        }
      }
    }
    return { ok: false };
  }
}
