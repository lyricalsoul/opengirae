import { maybeTransaction } from "./decorators";
import { sql } from "drizzle-orm";

export type RankEntry = {
  userId: number;
  displayName: string;
  privacyMode: boolean;
  platformId: string | null;
  value: number;
  total: number;
}

export type CativeiroRankEntry = {
  userId: number;
  displayName: string;
  privacyMode: boolean;
  platformId: string | null;
  cardId: number;
  cardName: string;
  rarityEmoji: string;
  customEmoji: string | null;
  count: number;
  total: number;
}

export type RankPosition = {
  rank: number;
  value: number;
  total: number;
}

const primaryLinkCte = (platform: string) => sql`
  primary_link AS (
    SELECT DISTINCT ON ("userId") "userId", "platformId"
    FROM linked_accounts
    WHERE platform = ${platform}
    ORDER BY "userId", "createdAt" ASC
  )
`

export class RankDB {
  static getTopByReputation = maybeTransaction('getTopByReputation', async (client, platform: string, limit: number, offset: number): Promise<RankEntry[]> => {
    const result = await client.execute<RankEntry>(sql`
      WITH ${primaryLinkCte(platform)}
      SELECT u.id AS "userId", u."displayName", u."privacyMode", pl."platformId", up.reputation AS value,
             CAST(COUNT(*) OVER () AS INTEGER) AS total
      FROM users u
      JOIN user_profiles up ON up."userId" = u.id
      LEFT JOIN primary_link pl ON pl."userId" = u.id
      ORDER BY up.reputation DESC, u.id ASC
      LIMIT ${limit} OFFSET ${offset}
    `)
    return result.rows
  })

  static getTopByCoins = maybeTransaction('getTopByCoins', async (client, platform: string, limit: number, offset: number): Promise<RankEntry[]> => {
    const result = await client.execute<RankEntry>(sql`
      WITH ${primaryLinkCte(platform)}
      SELECT u.id AS "userId", u."displayName", u."privacyMode", pl."platformId", u.coins AS value,
             CAST(COUNT(*) OVER () AS INTEGER) AS total
      FROM users u
      LEFT JOIN primary_link pl ON pl."userId" = u.id
      ORDER BY u.coins DESC, u.id ASC
      LIMIT ${limit} OFFSET ${offset}
    `)
    return result.rows
  })

  static getTopByCardCount = maybeTransaction('getTopByCardCount', async (client, platform: string, limit: number, offset: number): Promise<RankEntry[]> => {
    const result = await client.execute<RankEntry>(sql`
      WITH ${primaryLinkCte(platform)},
      card_totals AS (
        SELECT "userId", CAST(SUM(count) AS INTEGER) AS total FROM user_cards GROUP BY "userId"
      )
      SELECT u.id AS "userId", u."displayName", u."privacyMode", pl."platformId", ct.total AS value,
             CAST(COUNT(*) OVER () AS INTEGER) AS total
      FROM card_totals ct
      JOIN users u ON u.id = ct."userId"
      LEFT JOIN primary_link pl ON pl."userId" = u.id
      ORDER BY ct.total DESC, u.id ASC
      LIMIT ${limit} OFFSET ${offset}
    `)
    return result.rows
  })

  static getTopByCativeiro = maybeTransaction('getTopByCativeiro', async (client, platform: string, limit: number, offset: number): Promise<CativeiroRankEntry[]> => {
    const result = await client.execute<CativeiroRankEntry>(sql`
      WITH ${primaryLinkCte(platform)}
      SELECT u.id AS "userId", u."displayName", u."privacyMode", pl."platformId",
             c.id AS "cardId", c.name AS "cardName", r.emoji AS "rarityEmoji", uc."customEmoji", uc.count,
             CAST(COUNT(*) OVER () AS INTEGER) AS total
      FROM user_cards uc
      JOIN users u ON u.id = uc."userId"
      JOIN cards c ON c.id = uc."cardId"
      JOIN rarities r ON r.id = c."rarityId"
      LEFT JOIN primary_link pl ON pl."userId" = u.id
      ORDER BY uc.count DESC, u.id ASC, c.id ASC
      LIMIT ${limit} OFFSET ${offset}
    `)
    return result.rows
  })

  // "/rank maiscat" - how many distinct cards each user has past rarities.cativeiroThreshold, not the single-card-pile ranking above.
  static getTopByCativeiroCount = maybeTransaction('getTopByCativeiroCount', async (client, platform: string, limit: number, offset: number): Promise<RankEntry[]> => {
    const result = await client.execute<RankEntry>(sql`
      WITH ${primaryLinkCte(platform)},
      cativeiro_totals AS (
        SELECT uc."userId", CAST(COUNT(*) AS INTEGER) AS total
        FROM user_cards uc
        JOIN cards c ON c.id = uc."cardId"
        JOIN rarities r ON r.id = c."rarityId"
        WHERE uc.count >= r."cativeiroThreshold"
        GROUP BY uc."userId"
      )
      SELECT u.id AS "userId", u."displayName", u."privacyMode", pl."platformId", ct.total AS value,
             CAST(COUNT(*) OVER () AS INTEGER) AS total
      FROM cativeiro_totals ct
      JOIN users u ON u.id = ct."userId"
      LEFT JOIN primary_link pl ON pl."userId" = u.id
      ORDER BY ct.total DESC, u.id ASC
      LIMIT ${limit} OFFSET ${offset}
    `)
    return result.rows
  })

  static getReputationPosition = maybeTransaction('getReputationPosition', async (client, userId: number): Promise<RankPosition | undefined> => {
    const result = await client.execute<RankPosition>(sql`
      WITH ranked AS (
        SELECT u.id AS "userId", up.reputation AS value,
               CAST(RANK() OVER (ORDER BY up.reputation DESC) AS INTEGER) AS rank,
               CAST(COUNT(*) OVER () AS INTEGER) AS total
        FROM users u JOIN user_profiles up ON up."userId" = u.id
      )
      SELECT rank, value, total FROM ranked WHERE "userId" = ${userId}
    `)
    return result.rows[0]
  })

  static getCoinsPosition = maybeTransaction('getCoinsPosition', async (client, userId: number): Promise<RankPosition | undefined> => {
    const result = await client.execute<RankPosition>(sql`
      WITH ranked AS (
        SELECT id AS "userId", coins AS value,
               CAST(RANK() OVER (ORDER BY coins DESC) AS INTEGER) AS rank,
               CAST(COUNT(*) OVER () AS INTEGER) AS total
        FROM users
      )
      SELECT rank, value, total FROM ranked WHERE "userId" = ${userId}
    `)
    return result.rows[0]
  })

  static getCardCountPosition = maybeTransaction('getCardCountPosition', async (client, userId: number): Promise<RankPosition | undefined> => {
    const result = await client.execute<RankPosition>(sql`
      WITH card_totals AS (
        SELECT u.id AS "userId", CAST(COALESCE(SUM(uc.count), 0) AS INTEGER) AS total
        FROM users u LEFT JOIN user_cards uc ON uc."userId" = u.id
        GROUP BY u.id
      ),
      ranked AS (
        SELECT "userId", total AS value,
               CAST(RANK() OVER (ORDER BY total DESC) AS INTEGER) AS rank,
               CAST(COUNT(*) OVER () AS INTEGER) AS total_users
        FROM card_totals
      )
      SELECT rank, value, total_users AS total FROM ranked WHERE "userId" = ${userId}
    `)
    return result.rows[0]
  })

  static getCativeiroPosition = maybeTransaction('getCativeiroPosition', async (client, userId: number): Promise<RankPosition | undefined> => {
    const result = await client.execute<RankPosition>(sql`
      WITH ranked AS (
        SELECT "userId", count AS value, CAST(RANK() OVER (ORDER BY count DESC) AS INTEGER) AS rank
        FROM user_cards
      )
      SELECT MIN(rank) AS rank, MAX(value) AS value, CAST((SELECT COUNT(*) FROM user_cards) AS INTEGER) AS total
      FROM ranked WHERE "userId" = ${userId}
      GROUP BY "userId"
    `)
    return result.rows[0]
  })

  // undefined for a user with zero eligible cativeiros, same as getCativeiroPosition above.
  static getCativeiroCountPosition = maybeTransaction('getCativeiroCountPosition', async (client, userId: number): Promise<RankPosition | undefined> => {
    const result = await client.execute<RankPosition>(sql`
      WITH cativeiro_totals AS (
        SELECT uc."userId", CAST(COUNT(*) AS INTEGER) AS total
        FROM user_cards uc
        JOIN cards c ON c.id = uc."cardId"
        JOIN rarities r ON r.id = c."rarityId"
        WHERE uc.count >= r."cativeiroThreshold"
        GROUP BY uc."userId"
      ),
      ranked AS (
        SELECT "userId", total AS value,
               CAST(RANK() OVER (ORDER BY total DESC) AS INTEGER) AS rank,
               CAST(COUNT(*) OVER () AS INTEGER) AS total_users
        FROM cativeiro_totals
      )
      SELECT rank, value, total_users AS total FROM ranked WHERE "userId" = ${userId}
    `)
    return result.rows[0]
  })
}
