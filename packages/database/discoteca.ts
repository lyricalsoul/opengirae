import { maybeTransaction } from "./decorators";
import type { DrizzleClient } from "./decorators";
import {
  discotecaGenres,
  discotecaGenreAliases,
  discotecaSubcategories,
  discotecaEntries,
  discotecaEntrySubcategories,
  discotecaPreviewCache,
  discotecaArtists,
  discotecaArtistAppleIds,
  discotecaAlbumTracks,
  userDiscoteca,
  discotecaWishlist,
} from "./schemas/discoteca";
import { users, userProfiles } from "./schemas/users";
import { cards, categories, subcategories, cardSubcategories, rarities } from "./schemas/cards";
import { eq, and, or, sql, gt, gte, isNull, inArray } from "drizzle-orm";
import { calculateCardDiscardReward } from "./constants";
import { EconomyDB } from "./economy";

export class InsufficientDiscotecaEntryError extends Error {
  constructor(public userId: number, public entryId: number) {
    super(`user ${userId} does not have enough copies of discoteca entry ${entryId}`);
  }
}

export interface CreateDiscotecaEntryData {
  name: string;
  artistId: number;
  appleMusicId: string;
  type: 'single' | 'album';
  rarityId: number;
  artworkUrl?: string;
  animatedArtworkUrl?: string;
  releaseDate?: Date;
  previewUrl?: string;
  appleMusicUrl?: string;
  albumAppleMusicId?: string;
  albumId?: number;
}

export class DiscotecaDB {
  static createGenre = maybeTransaction('createGenre', async (client, name: string) => {
    return await client.insert(discotecaGenres).values({ name }).returning().then(a => a?.[0]);
  })

  static getGenre = maybeTransaction('getGenre', async (client, id: number) => {
    return await client.select().from(discotecaGenres).where(eq(discotecaGenres.id, id)).limit(1).then(a => a?.[0]);
  })

  static getGenreByName = maybeTransaction('getGenreByName', async (client, name: string) => {
    return await client.select().from(discotecaGenres).where(eq(discotecaGenres.name, name)).limit(1).then(a => a?.[0]);
  })

  static getGenres = maybeTransaction('getGenres', async (client) => {
    return await client.select().from(discotecaGenres);
  })

  static setGenreImage = maybeTransaction('setGenreImage', async (client, genreId: number, imageUrl: string) => {
    await client.update(discotecaGenres).set({ imageUrl }).where(eq(discotecaGenres.id, genreId));
  })

  static upsertGenreAlias = maybeTransaction('upsertGenreAlias', async (client, alias: string, genreId: number) => {
    const normalized = alias.trim().toLowerCase();
    return await client
      .insert(discotecaGenreAliases)
      .values({ alias: normalized, genreId })
      .onConflictDoUpdate({ target: discotecaGenreAliases.alias, set: { genreId } })
      .returning()
      .then(a => a?.[0]);
  })

  static createSubcategory = maybeTransaction('createSubcategory', async (client, genreId: number, name: string, emoji: string, isAlbum: boolean) => {
    return await client.insert(discotecaSubcategories).values({ genreId, name, emoji, isAlbum }).returning().then(a => a?.[0]);
  })

  static setSubcategoryImage = maybeTransaction('setSubcategoryImage', async (client, subcategoryId: number, imageUrl: string) => {
    await client.update(discotecaSubcategories).set({ imageUrl }).where(eq(discotecaSubcategories.id, subcategoryId));
  })

  static getSubcategory = maybeTransaction('getSubcategory', async (client, id: number) => {
    return await client.select().from(discotecaSubcategories).where(eq(discotecaSubcategories.id, id)).limit(1).then(a => a?.[0]);
  })

  static getSubcategories = maybeTransaction('getSubcategories', async (client) => {
    return await client.select().from(discotecaSubcategories);
  })

  static getSubcategoryByName = maybeTransaction('getSubcategoryByName', async (client, name: string) => {
    return await client.select().from(discotecaSubcategories).where(eq(discotecaSubcategories.name, name)).limit(1).then(a => a?.[0]);
  })

  // one alias covers both variants - it maps to the genre, then isAlbum picks the subcategory
  static resolveGenresByAliases = maybeTransaction('resolveGenresByAliases', async (client, rawStrings: string[], isAlbum: boolean) => {
    const resolved: { id: number; name: string }[] = [];
    const unmapped: string[] = [];

    for (const raw of rawStrings) {
      const normalized = raw.trim().toLowerCase();
      const viaAlias = await client
        .select({ id: discotecaSubcategories.id, name: discotecaSubcategories.name })
        .from(discotecaGenreAliases)
        .innerJoin(discotecaSubcategories, and(eq(discotecaSubcategories.genreId, discotecaGenreAliases.genreId), eq(discotecaSubcategories.isAlbum, isAlbum)))
        .where(eq(discotecaGenreAliases.alias, normalized))
        .limit(1)
        .then(a => a?.[0]);

      if (viaAlias) { resolved.push(viaAlias); continue; }

      // no alias needed when the raw string already matches the canonical genre name
      const viaGenreName = await client
        .select({ id: discotecaSubcategories.id, name: discotecaSubcategories.name })
        .from(discotecaGenres)
        .innerJoin(discotecaSubcategories, and(eq(discotecaSubcategories.genreId, discotecaGenres.id), eq(discotecaSubcategories.isAlbum, isAlbum)))
        .where(sql`lower(${discotecaGenres.name}) = ${normalized}`)
        .limit(1)
        .then(a => a?.[0]);

      if (viaGenreName) resolved.push(viaGenreName);
      else unmapped.push(raw);
    }

    return { resolved, unmapped };
  })

  static createEntry = maybeTransaction('createEntry', async (client, data: CreateDiscotecaEntryData) => {
    return await client.insert(discotecaEntries).values(data).returning().then(a => a?.[0]);
  })

  static getEntry = maybeTransaction('getEntry', async (client, id: number) => {
    return await client.select().from(discotecaEntries).where(eq(discotecaEntries.id, id)).limit(1).then(a => a?.[0]);
  })

  static getEntryWithDetails = maybeTransaction('getEntryWithDetails', async (client, id: number) => {
    return await client
      .select({
        id: discotecaEntries.id,
        name: discotecaEntries.name,
        type: discotecaEntries.type,
        albumId: discotecaEntries.albumId,
        artworkUrl: discotecaEntries.artworkUrl,
        animatedArtworkUrl: discotecaEntries.animatedArtworkUrl,
        previewUrl: discotecaEntries.previewUrl,
        telegramFileId: discotecaEntries.telegramFileId,
        telegramFileUniqueId: discotecaEntries.telegramFileUniqueId,
        appleMusicUrl: discotecaEntries.appleMusicUrl,
        artistId: discotecaArtists.id,
        artistName: discotecaArtists.name,
        rarityEmoji: rarities.emoji,
      })
      .from(discotecaEntries)
      .innerJoin(discotecaArtists, eq(discotecaArtists.id, discotecaEntries.artistId))
      .innerJoin(rarities, eq(rarities.id, discotecaEntries.rarityId))
      .where(eq(discotecaEntries.id, id))
      .limit(1)
      .then(a => a?.[0]);
  })

  static getGenreNamesForEntry = maybeTransaction('getGenreNamesForEntry', async (client, entryId: number) => {
    return await client
      .select({ name: discotecaSubcategories.name })
      .from(discotecaEntrySubcategories)
      .innerJoin(discotecaSubcategories, eq(discotecaSubcategories.id, discotecaEntrySubcategories.subcategoryId))
      .where(eq(discotecaEntrySubcategories.entryId, entryId))
      .then(rows => rows.map(r => r.name));
  })

  static getGenresForEntry = maybeTransaction('getGenresForEntry', async (client, entryId: number) => {
    return await client
      .select({ id: discotecaGenres.id, name: discotecaGenres.name })
      .from(discotecaEntrySubcategories)
      .innerJoin(discotecaSubcategories, eq(discotecaSubcategories.id, discotecaEntrySubcategories.subcategoryId))
      .innerJoin(discotecaGenres, eq(discotecaGenres.id, discotecaSubcategories.genreId))
      .where(eq(discotecaEntrySubcategories.entryId, entryId))
      .orderBy(discotecaGenres.name);
  })

  // ids here are discoteca_subcategories.id - what setEntryGenres expects, unlike getGenresForEntry's genre id.
  static getSubcategoriesForEntry = maybeTransaction('getSubcategoriesForEntry', async (client, entryId: number) => {
    return await client
      .select({ id: discotecaSubcategories.id, name: discotecaSubcategories.name })
      .from(discotecaEntrySubcategories)
      .innerJoin(discotecaSubcategories, eq(discotecaSubcategories.id, discotecaEntrySubcategories.subcategoryId))
      .where(eq(discotecaEntrySubcategories.entryId, entryId))
      .orderBy(discotecaSubcategories.name);
  })

  static getLinkedSingles = maybeTransaction('getLinkedSingles', async (client, albumId: number, userId: number) => {
    return await client
      .select({
        id: discotecaEntries.id,
        name: discotecaEntries.name,
        artistName: discotecaArtists.name,
        categoryEmoji: categories.emoji,
        rarityEmoji: rarities.emoji,
        ownedCount: sql<number>`coalesce(${userDiscoteca.count}, 0)::int`,
      })
      .from(discotecaEntries)
      .innerJoin(discotecaArtists, eq(discotecaArtists.id, discotecaEntries.artistId))
      .innerJoin(rarities, eq(rarities.id, discotecaEntries.rarityId))
      .leftJoin(userDiscoteca, and(eq(userDiscoteca.entryId, discotecaEntries.id), eq(userDiscoteca.userId, userId)))
      .leftJoin(cards, eq(cards.id, discotecaArtists.cardId))
      .leftJoin(cardSubcategories, and(eq(cardSubcategories.cardId, cards.id), eq(cardSubcategories.isMain, true)))
      .leftJoin(subcategories, eq(subcategories.id, cardSubcategories.subcategoryId))
      .leftJoin(categories, eq(categories.id, subcategories.categoryId))
      .where(and(eq(discotecaEntries.albumId, albumId), eq(discotecaEntries.type, 'single')))
      .orderBy(rarities.weight, discotecaEntries.name);
  })

  static getEntriesForGenre = maybeTransaction('getEntriesForGenre', async (client, subcategoryId: number, userId: number, limit: number, offset: number, filters: { ownedFilter?: 'owned' | 'missing'; rarityNames?: string[] } = {}) => {
    const ownedCondition = filters.ownedFilter === 'owned' ? gt(userDiscoteca.count, 0)
      : filters.ownedFilter === 'missing' ? isNull(userDiscoteca.count)
      : undefined
    const rarityCondition = filters.rarityNames && filters.rarityNames.length > 0 ? inArray(rarities.name, filters.rarityNames) : undefined
    const filteredWhere = and(eq(discotecaEntrySubcategories.subcategoryId, subcategoryId), ownedCondition, rarityCondition)

    const [rows, totalRow, ownedRow, filteredTotalRow] = await Promise.all([
      client
        .select({
          id: discotecaEntries.id,
          name: discotecaEntries.name,
          type: discotecaEntries.type,
          artistName: discotecaArtists.name,
          categoryEmoji: categories.emoji,
          rarityEmoji: rarities.emoji,
          ownedCount: sql<number>`coalesce(${userDiscoteca.count}, 0)::int`,
        })
        .from(discotecaEntrySubcategories)
        .innerJoin(discotecaEntries, eq(discotecaEntries.id, discotecaEntrySubcategories.entryId))
        .innerJoin(discotecaArtists, eq(discotecaArtists.id, discotecaEntries.artistId))
        .innerJoin(rarities, eq(rarities.id, discotecaEntries.rarityId))
        .leftJoin(userDiscoteca, and(eq(userDiscoteca.entryId, discotecaEntries.id), eq(userDiscoteca.userId, userId)))
        .leftJoin(cards, eq(cards.id, discotecaArtists.cardId))
        .leftJoin(cardSubcategories, and(eq(cardSubcategories.cardId, cards.id), eq(cardSubcategories.isMain, true)))
        .leftJoin(subcategories, eq(subcategories.id, cardSubcategories.subcategoryId))
        .leftJoin(categories, eq(categories.id, subcategories.categoryId))
        .where(filteredWhere)
        .orderBy(rarities.weight, discotecaEntries.name)
        .limit(limit)
        .offset(offset),
      client.select({ total: sql<number>`count(*)::int` }).from(discotecaEntrySubcategories).where(eq(discotecaEntrySubcategories.subcategoryId, subcategoryId)).then(a => a?.[0]),
      client
        .select({ owned: sql<number>`count(*)::int` })
        .from(discotecaEntrySubcategories)
        .innerJoin(userDiscoteca, and(eq(userDiscoteca.entryId, discotecaEntrySubcategories.entryId), eq(userDiscoteca.userId, userId), gt(userDiscoteca.count, 0)))
        .where(eq(discotecaEntrySubcategories.subcategoryId, subcategoryId))
        .then(a => a?.[0]),
      client
        .select({ total: sql<number>`count(*)::int` })
        .from(discotecaEntrySubcategories)
        .innerJoin(discotecaEntries, eq(discotecaEntries.id, discotecaEntrySubcategories.entryId))
        .innerJoin(rarities, eq(rarities.id, discotecaEntries.rarityId))
        .leftJoin(userDiscoteca, and(eq(userDiscoteca.entryId, discotecaEntries.id), eq(userDiscoteca.userId, userId)))
        .where(filteredWhere)
        .then(a => a?.[0]),
    ]);
    return { rows, total: totalRow?.total ?? 0, owned: ownedRow?.owned ?? 0, filteredTotal: filteredTotalRow?.total ?? 0 };
  })

  static getEntriesByType = maybeTransaction('getEntriesByType', async (client, type: 'single' | 'album', userId: number, limit: number, offset: number, filters: { ownedFilter?: 'owned' | 'missing'; rarityNames?: string[] } = {}) => {
    const ownedCondition = filters.ownedFilter === 'owned' ? gt(userDiscoteca.count, 0)
      : filters.ownedFilter === 'missing' ? isNull(userDiscoteca.count)
      : undefined
    const rarityCondition = filters.rarityNames && filters.rarityNames.length > 0 ? inArray(rarities.name, filters.rarityNames) : undefined
    const filteredWhere = and(eq(discotecaEntries.type, type), ownedCondition, rarityCondition)

    const [rows, totalRow, ownedRow, filteredTotalRow] = await Promise.all([
      client
        .select({
          id: discotecaEntries.id,
          name: discotecaEntries.name,
          artistName: discotecaArtists.name,
          categoryEmoji: categories.emoji,
          rarityEmoji: rarities.emoji,
          ownedCount: sql<number>`coalesce(${userDiscoteca.count}, 0)::int`,
        })
        .from(discotecaEntries)
        .innerJoin(discotecaArtists, eq(discotecaArtists.id, discotecaEntries.artistId))
        .innerJoin(rarities, eq(rarities.id, discotecaEntries.rarityId))
        .leftJoin(userDiscoteca, and(eq(userDiscoteca.entryId, discotecaEntries.id), eq(userDiscoteca.userId, userId)))
        .leftJoin(cards, eq(cards.id, discotecaArtists.cardId))
        .leftJoin(cardSubcategories, and(eq(cardSubcategories.cardId, cards.id), eq(cardSubcategories.isMain, true)))
        .leftJoin(subcategories, eq(subcategories.id, cardSubcategories.subcategoryId))
        .leftJoin(categories, eq(categories.id, subcategories.categoryId))
        .where(filteredWhere)
        .orderBy(rarities.weight, discotecaEntries.name)
        .limit(limit)
        .offset(offset),
      client.select({ total: sql<number>`count(*)::int` }).from(discotecaEntries).where(eq(discotecaEntries.type, type)).then(a => a?.[0]),
      client
        .select({ owned: sql<number>`count(*)::int` })
        .from(userDiscoteca)
        .innerJoin(discotecaEntries, eq(discotecaEntries.id, userDiscoteca.entryId))
        .where(and(eq(discotecaEntries.type, type), eq(userDiscoteca.userId, userId), gt(userDiscoteca.count, 0)))
        .then(a => a?.[0]),
      client
        .select({ total: sql<number>`count(*)::int` })
        .from(discotecaEntries)
        .innerJoin(rarities, eq(rarities.id, discotecaEntries.rarityId))
        .leftJoin(userDiscoteca, and(eq(userDiscoteca.entryId, discotecaEntries.id), eq(userDiscoteca.userId, userId)))
        .where(filteredWhere)
        .then(a => a?.[0]),
    ]);
    return { rows, total: totalRow?.total ?? 0, owned: ownedRow?.owned ?? 0, filteredTotal: filteredTotalRow?.total ?? 0 };
  })

  static getOverallCounts = maybeTransaction('getOverallCounts', async (client, userId: number) => {
    const [totalRow, ownedRow] = await Promise.all([
      client.select({ total: sql<number>`count(*)::int` }).from(discotecaEntries).then(a => a?.[0]),
      client
        .select({ owned: sql<number>`count(*)::int` })
        .from(userDiscoteca)
        .where(and(eq(userDiscoteca.userId, userId), gt(userDiscoteca.count, 0)))
        .then(a => a?.[0]),
    ]);
    return { total: totalRow?.total ?? 0, owned: ownedRow?.owned ?? 0 };
  })

  static getEntryByAppleMusicId = maybeTransaction('getEntryByAppleMusicId', async (client, appleMusicId: string) => {
    return await client.select().from(discotecaEntries).where(eq(discotecaEntries.appleMusicId, appleMusicId)).limit(1).then(a => a?.[0]);
  })

  static getOrCreateArtist = maybeTransaction('getOrCreateArtist', async (client, appleMusicArtistId: string, name: string) => {
    const existing = await client.select().from(discotecaArtists).where(eq(discotecaArtists.appleMusicArtistId, appleMusicArtistId)).limit(1).then(a => a?.[0]);
    if (existing) return existing;

    // this apple music artist id may have been merged into another artist previously - follow the alias
    const aliased = await client
      .select({ artist: discotecaArtists })
      .from(discotecaArtistAppleIds)
      .innerJoin(discotecaArtists, eq(discotecaArtists.id, discotecaArtistAppleIds.artistId))
      .where(eq(discotecaArtistAppleIds.appleMusicArtistId, appleMusicArtistId))
      .limit(1)
      .then(a => a?.[0]?.artist);
    if (aliased) return aliased;

    // artist cards can be filed under either the general music category or the girasia (idol) one
    const musicCategories = await client.select({ id: categories.id }).from(categories).where(inArray(categories.name, ['Música', 'GIRÁSIA']));

    let cardId: number | undefined;
    if (musicCategories.length > 0) {
      const matches = await client
        .select({ id: cards.id })
        .from(cards)
        .innerJoin(cardSubcategories, eq(cardSubcategories.cardId, cards.id))
        .innerJoin(subcategories, eq(subcategories.id, cardSubcategories.subcategoryId))
        .where(and(inArray(subcategories.categoryId, musicCategories.map(c => c.id)), sql`immutable_unaccent(${cards.name}) = immutable_unaccent(${name})`));
      if (matches.length === 1) cardId = matches[0]!.id;
    }

    const inserted = await client
      .insert(discotecaArtists)
      .values({ appleMusicArtistId, name, cardId })
      .onConflictDoNothing({ target: discotecaArtists.appleMusicArtistId })
      .returning()
      .then(a => a?.[0]);
    if (inserted) return inserted;

    // another concurrent call won the insert race - return the row it created
    return await client.select().from(discotecaArtists).where(eq(discotecaArtists.appleMusicArtistId, appleMusicArtistId)).limit(1).then(a => a?.[0]);
  })

  static setArtistCard = maybeTransaction('setArtistCard', async (client, artistId: number, cardId: number | null, cardName?: string) => {
    return await client.update(discotecaArtists).set(cardName ? { cardId, name: cardName } : { cardId }).where(eq(discotecaArtists.id, artistId)).returning().then(a => a?.[0]);
  })

  static getArtist = maybeTransaction('getArtist', async (client, id: number) => {
    return await client.select().from(discotecaArtists).where(eq(discotecaArtists.id, id)).limit(1).then(a => a?.[0]);
  })

  static getArtistsByIds = maybeTransaction('getArtistsByIds', async (client, ids: number[]) => {
    if (ids.length === 0) return [];
    return await client.select().from(discotecaArtists).where(inArray(discotecaArtists.id, ids));
  })

  static getArtistByCardId = maybeTransaction('getArtistByCardId', async (client, cardId: number) => {
    return await client.select().from(discotecaArtists).where(eq(discotecaArtists.cardId, cardId)).limit(1).then(a => a?.[0]);
  })

  static mergeArtists = maybeTransaction('mergeArtists', async (client, sourceId: number, targetId: number) => {
    const source = await client.select().from(discotecaArtists).where(eq(discotecaArtists.id, sourceId)).limit(1).then(a => a?.[0]);
    if (!source) return;

    await client.update(discotecaEntries).set({ artistId: targetId }).where(eq(discotecaEntries.artistId, sourceId));
    await client.update(discotecaArtistAppleIds).set({ artistId: targetId }).where(eq(discotecaArtistAppleIds.artistId, sourceId));
    await client
      .insert(discotecaArtistAppleIds)
      .values({ appleMusicArtistId: source.appleMusicArtistId, artistId: targetId })
      .onConflictDoUpdate({ target: discotecaArtistAppleIds.appleMusicArtistId, set: { artistId: targetId } });
    await client.delete(discotecaArtists).where(eq(discotecaArtists.id, sourceId));
  })

  static setArtistImage = maybeTransaction('setArtistImage', async (client, artistId: number, imageUrl: string) => {
    await client.update(discotecaArtists).set({ imageUrl }).where(eq(discotecaArtists.id, artistId));
  })

  // WHERE expression must match discoteca_artists_name_trgm_idx's expression exactly for the index to be used
  static searchArtistsByName = maybeTransaction('searchArtistsByName', async (client, query: string, limit: number = 100) => {
    return await client
      .select({ id: discotecaArtists.id, name: discotecaArtists.name, cardId: discotecaArtists.cardId })
      .from(discotecaArtists)
      .where(sql`immutable_unaccent(${discotecaArtists.name}) ilike immutable_unaccent(${'%' + query + '%'})`)
      .limit(limit);
  })

  static getUserDiscoteca = maybeTransaction('getUserDiscoteca', async (client, userId: number, entryId: number) => {
    return await client.select().from(userDiscoteca).where(and(eq(userDiscoteca.userId, userId), eq(userDiscoteca.entryId, entryId))).limit(1).then(a => a?.[0]);
  })

  static hasAnyUserDiscoteca = maybeTransaction('hasAnyUserDiscoteca', async (client, userId: number) => {
    return !!(await client.select({ x: sql`1` }).from(userDiscoteca).where(and(eq(userDiscoteca.userId, userId), gt(userDiscoteca.count, 0))).limit(1).then(a => a?.[0]));
  })

  static getArtistWorkCounts = maybeTransaction('getArtistWorkCounts', async (client, userId: number, artistId: number) => {
    const [totalRow, ownedRow] = await Promise.all([
      client.select({ total: sql<number>`count(*)::int` }).from(discotecaEntries).where(eq(discotecaEntries.artistId, artistId)).then(a => a?.[0]),
      client
        .select({ owned: sql<number>`count(*)::int` })
        .from(userDiscoteca)
        .innerJoin(discotecaEntries, eq(discotecaEntries.id, userDiscoteca.entryId))
        .where(and(eq(discotecaEntries.artistId, artistId), eq(userDiscoteca.userId, userId), gt(userDiscoteca.count, 0)))
        .then(a => a?.[0]),
    ]);
    return { owned: ownedRow?.owned ?? 0, total: totalRow?.total ?? 0 };
  })

  static getEntriesForArtist = maybeTransaction('getEntriesForArtist', async (client, artistId: number, userId: number) => {
    return await client
      .select({
        id: discotecaEntries.id,
        name: discotecaEntries.name,
        type: discotecaEntries.type,
        rarityEmoji: rarities.emoji,
        rarityName: rarities.name,
        ownedCount: sql<number>`coalesce(${userDiscoteca.count}, 0)::int`,
      })
      .from(discotecaEntries)
      .innerJoin(rarities, eq(rarities.id, discotecaEntries.rarityId))
      .leftJoin(userDiscoteca, and(eq(userDiscoteca.entryId, discotecaEntries.id), eq(userDiscoteca.userId, userId)))
      .where(eq(discotecaEntries.artistId, artistId))
      .orderBy(discotecaEntries.type, rarities.weight, discotecaEntries.name);
  })

  static getArtistsPage = maybeTransaction('getArtistsPage', async (client, userId: number, limit: number, offset: number) => {
    const [rows, totalRow] = await Promise.all([
      client
        .select({
          id: discotecaArtists.id,
          name: discotecaArtists.name,
          cardId: discotecaArtists.cardId,
          rarityEmoji: rarities.emoji,
          totalWorks: sql<number>`count(distinct ${discotecaEntries.id})::int`,
          ownedWorks: sql<number>`count(distinct ${userDiscoteca.entryId}) filter (where ${userDiscoteca.count} > 0)::int`,
        })
        .from(discotecaArtists)
        .leftJoin(cards, eq(cards.id, discotecaArtists.cardId))
        .leftJoin(rarities, eq(rarities.id, cards.rarityId))
        .leftJoin(discotecaEntries, eq(discotecaEntries.artistId, discotecaArtists.id))
        .leftJoin(userDiscoteca, and(eq(userDiscoteca.entryId, discotecaEntries.id), eq(userDiscoteca.userId, userId)))
        .groupBy(discotecaArtists.id, rarities.emoji)
        .orderBy(discotecaArtists.id)
        .limit(limit)
        .offset(offset),
      client.select({ total: sql<number>`count(*)::int` }).from(discotecaArtists).then(a => a?.[0]),
    ]);
    return { rows, total: totalRow?.total ?? 0 };
  })

  static searchEntriesByName = maybeTransaction('searchEntriesByName', async (client, query: string, limit: number = 100, type?: 'single' | 'album') => {
    return await client
      .select({
        id: discotecaEntries.id,
        name: discotecaEntries.name,
        artistName: discotecaArtists.name,
        type: discotecaEntries.type,
      })
      .from(discotecaEntries)
      .innerJoin(discotecaArtists, eq(discotecaArtists.id, discotecaEntries.artistId))
      .where(and(
        or(
          sql`immutable_unaccent(${discotecaEntries.name}) ilike immutable_unaccent(${'%' + query + '%'})`,
          sql`immutable_unaccent(${discotecaArtists.name}) ilike immutable_unaccent(${'%' + query + '%'})`,
        ),
        type ? eq(discotecaEntries.type, type) : undefined,
      ))
      .limit(limit);
  })

  static findDuplicateEntry = maybeTransaction('findDuplicateEntry', async (client, name: string, artistId: number, type: 'single' | 'album') => {
    return await client
      .select({ id: discotecaEntries.id, name: discotecaEntries.name })
      .from(discotecaEntries)
      .where(and(
        eq(discotecaEntries.artistId, artistId),
        eq(discotecaEntries.type, type),
        sql`immutable_unaccent(lower(${discotecaEntries.name})) = immutable_unaccent(lower(${name}))`,
      ))
      .limit(1)
      .then(a => a?.[0]);
  })

  static getAlbumsByArtist = maybeTransaction('getAlbumsByArtist', async (client, artistId: number) => {
    return await client
      .select({ id: discotecaEntries.id, appleMusicId: discotecaEntries.appleMusicId })
      .from(discotecaEntries)
      .where(and(eq(discotecaEntries.artistId, artistId), eq(discotecaEntries.type, 'album')));
  })

  static getUnlinkedSinglesByArtist = maybeTransaction('getUnlinkedSinglesByArtist', async (client, artistId: number) => {
    return await client
      .select({ id: discotecaEntries.id, name: discotecaEntries.name })
      .from(discotecaEntries)
      .where(and(eq(discotecaEntries.artistId, artistId), eq(discotecaEntries.type, 'single'), isNull(discotecaEntries.albumId)));
  })

  static linkSingleToAlbum = maybeTransaction('linkSingleToAlbum', async (client, entryId: number, albumId: number) => {
    await client.update(discotecaEntries).set({ albumId }).where(eq(discotecaEntries.id, entryId));
  })

  static updateEntry = maybeTransaction('updateEntry', async (client, id: number, data: { name: string; rarityId: number; albumId?: number | null }) => {
    return await client.update(discotecaEntries).set(data).where(eq(discotecaEntries.id, id)).returning().then(a => a?.[0]);
  })

  static cacheAlbumTracks = maybeTransaction('cacheAlbumTracks', async (client, entryId: number, tracks: { trackAppleMusicId: string; name: string }[]) => {
    if (tracks.length === 0) return;
    await client.insert(discotecaAlbumTracks).values(tracks.map(t => ({ entryId, trackAppleMusicId: t.trackAppleMusicId, name: t.name })));
  })

  static findAlbumTrackMatch = maybeTransaction('findAlbumTrackMatch', async (client, artistId: number, trackName: string) => {
    return await client
      .select({ id: discotecaEntries.id, name: discotecaEntries.name })
      .from(discotecaAlbumTracks)
      .innerJoin(discotecaEntries, eq(discotecaEntries.id, discotecaAlbumTracks.entryId))
      .where(and(
        eq(discotecaEntries.artistId, artistId),
        eq(discotecaEntries.type, 'album'),
        sql`lower(trim(${discotecaAlbumTracks.name})) = lower(trim(${trackName}))`,
      ))
      .limit(1)
      .then(a => a?.[0]);
  })

  static setEntryGenres = maybeTransaction('setEntryGenres', async (client, entryId: number, subcategoryIds: number[]) => {
    await client.delete(discotecaEntrySubcategories).where(eq(discotecaEntrySubcategories.entryId, entryId));
    if (subcategoryIds.length === 0) return;
    await client.insert(discotecaEntrySubcategories).values(subcategoryIds.map(subcategoryId => ({ entryId, subcategoryId })));
  })

  static addUserDiscoteca = maybeTransaction('addUserDiscoteca', async (client, userId: number, entryId: number) => {
    return await client
      .insert(userDiscoteca)
      .values({ userId, entryId })
      .onConflictDoUpdate({
        target: [userDiscoteca.userId, userDiscoteca.entryId],
        set: { count: sql`${userDiscoteca.count} + 1`, updatedAt: sql`now()` },
      })
      .returning({ count: userDiscoteca.count })
      .then(a => a?.[0]?.count);
  })

  // discoteca leg of CardsDB.executeMixedTrade - mirrors executeTrade's decrement, minus cativeiro clearing (no customization columns here).
  static async decrementForTradeWithClient(client: DrizzleClient, userId: number, entryId: number, count: number): Promise<void> {
    // tradable=true is in the WHERE itself - closes the TOCTOU gap vs a trade finalizing after the entry was marked non-tradable.
    const [row] = await client
      .update(userDiscoteca)
      .set({ count: sql`${userDiscoteca.count} - ${count}` })
      .where(and(
        eq(userDiscoteca.userId, userId), eq(userDiscoteca.entryId, entryId),
        gte(userDiscoteca.count, count), eq(userDiscoteca.tradable, true),
      ))
      .returning();
    if (!row) throw new InsufficientDiscotecaEntryError(userId, entryId);
    if (row.count === 0) {
      await client.delete(userDiscoteca).where(and(eq(userDiscoteca.userId, userId), eq(userDiscoteca.entryId, entryId)));
    }
  }

  static async incrementWithClient(client: DrizzleClient, userId: number, entryId: number, count: number): Promise<void> {
    const existing = await client
      .select()
      .from(userDiscoteca)
      .where(and(eq(userDiscoteca.userId, userId), eq(userDiscoteca.entryId, entryId)))
      .limit(1)
      .then(a => a?.[0]);

    if (existing) {
      await client
        .update(userDiscoteca)
        .set({ count: sql`${userDiscoteca.count} + ${count}` })
        .where(and(eq(userDiscoteca.userId, userId), eq(userDiscoteca.entryId, entryId)));
    } else {
      await client.insert(userDiscoteca).values({ userId, entryId, count });
    }
  }

  static getOwnedEntryQuantities = maybeTransaction('getOwnedEntryQuantities', async (client, userId: number, entryIds: number[]) => {
    if (entryIds.length === 0) return [];
    return await client
      .select({ entryId: userDiscoteca.entryId, count: userDiscoteca.count })
      .from(userDiscoteca)
      .where(and(eq(userDiscoteca.userId, userId), inArray(userDiscoteca.entryId, entryIds), gte(userDiscoteca.count, 1)));
  })

  static getEntriesByIds = maybeTransaction('getEntriesByIds', async (client, ids: number[]) => {
    if (ids.length === 0) return [];
    return await client
      .select({ id: discotecaEntries.id, name: discotecaEntries.name, type: discotecaEntries.type, rarityEmoji: rarities.emoji, rarityName: rarities.name })
      .from(discotecaEntries)
      .innerJoin(rarities, eq(rarities.id, discotecaEntries.rarityId))
      .where(inArray(discotecaEntries.id, ids));
  })

  // /doardisco's `*` case - mirrors CardsDB.getAllOwnedCardIds.
  static getAllOwnedEntryIds = maybeTransaction('getAllOwnedEntryIds', async (client, userId: number) => {
    return await client
      .select({ entryId: userDiscoteca.entryId, count: userDiscoteca.count })
      .from(userDiscoteca)
      .where(and(eq(userDiscoteca.userId, userId), gt(userDiscoteca.count, 0)));
  })

  // deliberately NOT gated on tradable, unlike decrementForTradeWithClient - donations bypass the trade-only flag, same as CardsDB.executeTrade's card decrement.
  static async decrementForDonationWithClient(client: DrizzleClient, userId: number, entryId: number, count: number): Promise<void> {
    const [row] = await client
      .update(userDiscoteca)
      .set({ count: sql`${userDiscoteca.count} - ${count}` })
      .where(and(eq(userDiscoteca.userId, userId), eq(userDiscoteca.entryId, entryId), gte(userDiscoteca.count, count)))
      .returning();
    if (!row) throw new InsufficientDiscotecaEntryError(userId, entryId);
    if (row.count === 0) {
      await client.delete(userDiscoteca).where(and(eq(userDiscoteca.userId, userId), eq(userDiscoteca.entryId, entryId)));
    }
  }

  // one-sided transfer (recipient offer empty) - stays here rather than CardsDB.executeMixedTrade, which would wrongly require tradable.
  static executeDonation = maybeTransaction('executeDonation', async (client, donorId: number, offer: { entryId: number; count: number }[], recipientId: number) => {
    if (donorId === recipientId) throw new Error('executeDonation: donorId and recipientId must differ');
    const ids = offer.map(o => o.entryId);
    if (new Set(ids).size !== ids.length) throw new Error('executeDonation: an offer must not list the same discoteca entry twice');
    if (offer.some(o => o.count <= 0)) throw new Error('executeDonation: offer counts must be positive');

    for (const { entryId, count } of offer) await DiscotecaDB.decrementForDonationWithClient(client, donorId, entryId, count);
    for (const { entryId, count } of offer) await DiscotecaDB.incrementWithClient(client, recipientId, entryId, count);
  })

  // mirrors CardsDB.tryDecrementOneWithClient, minus cativeiro clearing - used by AuditDB.revertDiscotecaDonation.
  static async tryDecrementOneWithClient(client: DrizzleClient, userId: number, entryId: number): Promise<boolean> {
    const [row] = await client
      .update(userDiscoteca)
      .set({ count: sql`${userDiscoteca.count} - 1` })
      .where(and(eq(userDiscoteca.userId, userId), eq(userDiscoteca.entryId, entryId), gte(userDiscoteca.count, 1)))
      .returning();
    if (!row) return false;
    if (row.count === 0) {
      await client.delete(userDiscoteca).where(and(eq(userDiscoteca.userId, userId), eq(userDiscoteca.entryId, entryId)));
    }
    return true;
  }

  static async getEntryRarityIdWithClient(client: DrizzleClient, entryId: number): Promise<number | null> {
    const [row] = await client.select({ rarityId: discotecaEntries.rarityId }).from(discotecaEntries).where(eq(discotecaEntries.id, entryId)).limit(1);
    return row?.rarityId ?? null;
  }

  // any discoteca entry of rarityId userId owns - AuditDB.revertDiscotecaDonation's "same tier" fallback step.
  static async findOwnedEntryOfRarityWithClient(client: DrizzleClient, userId: number, rarityId: number): Promise<number | null> {
    const [row] = await client
      .select({ entryId: userDiscoteca.entryId })
      .from(userDiscoteca)
      .innerJoin(discotecaEntries, eq(discotecaEntries.id, userDiscoteca.entryId))
      .where(and(eq(userDiscoteca.userId, userId), eq(discotecaEntries.rarityId, rarityId), gte(userDiscoteca.count, 1)))
      .limit(1);
    return row?.entryId ?? null;
  }

  // mirrors CardsDB.discardUserCards/discardUserCardsTx, reusing the same rarity-keyed reward table - no tradable check since selling only touches the seller's own copy.
  static sellUserDiscoteca = async (userId: number, entryIds: number[]) => {
    const incomeInflationRate = await EconomyDB.getIncomeInflationRate();
    try {
      return await DiscotecaDB.sellUserDiscotecaTx(userId, entryIds, incomeInflationRate);
    } catch (e) {
      if (e instanceof InsufficientDiscotecaEntryError) return { ok: false as const, reason: 'missing_or_not_owned' as const, entryId: e.entryId };
      throw e;
    }
  }

  private static sellUserDiscotecaTx = maybeTransaction('sellUserDiscoteca', async (client, userId: number, entryIds: number[], incomeInflationRate: number) => {
    const requestedQty = new Map<number, number>();
    for (const id of entryIds) requestedQty.set(id, (requestedQty.get(id) ?? 0) + 1);
    const uniqueIds = [...requestedQty.keys()];
    if (uniqueIds.length === 0) return { ok: true as const, results: [], totalCoinsAwarded: 0 };

    const owned = await client
      .select({ entryId: userDiscoteca.entryId, count: userDiscoteca.count, rarityName: rarities.name })
      .from(userDiscoteca)
      .innerJoin(discotecaEntries, eq(discotecaEntries.id, userDiscoteca.entryId))
      .innerJoin(rarities, eq(rarities.id, discotecaEntries.rarityId))
      .where(and(eq(userDiscoteca.userId, userId), inArray(userDiscoteca.entryId, uniqueIds)));

    const ownedById = new Map(owned.map(o => [o.entryId, o]));

    for (const [entryId, qty] of requestedQty) {
      const row = ownedById.get(entryId);
      if (!row || row.count < qty) return { ok: false as const, reason: 'missing_or_not_owned' as const, entryId };
    }

    const results: { entryId: number; remainingCount: number; coinsAwarded: number }[] = [];
    let totalCoinsAwarded = 0;

    for (const [entryId, qty] of requestedQty) {
      const row = ownedById.get(entryId)!;
      const reward = calculateCardDiscardReward(row.rarityName, qty, incomeInflationRate);

      const [updated] = await client
        .update(userDiscoteca)
        .set({ count: sql`${userDiscoteca.count} - ${qty}` })
        .where(and(eq(userDiscoteca.userId, userId), eq(userDiscoteca.entryId, entryId), gte(userDiscoteca.count, qty)))
        .returning();
      if (!updated) throw new InsufficientDiscotecaEntryError(userId, entryId);

      if (updated.count === 0) {
        await client.delete(userDiscoteca).where(and(eq(userDiscoteca.userId, userId), eq(userDiscoteca.entryId, entryId)));
      }

      results.push({ entryId, remainingCount: updated.count, coinsAwarded: reward });
      totalCoinsAwarded += reward;
    }

    if (totalCoinsAwarded > 0) {
      await client.update(users).set({ coins: sql`${users.coins} + ${totalCoinsAwarded}` }).where(eq(users.id, userId));
    }

    return { ok: true as const, results, totalCoinsAwarded };
  })

  static setEntryTradable = maybeTransaction('setEntryTradable', async (client, userId: number, entryId: number, tradable: boolean) => {
    return await client
      .update(userDiscoteca)
      .set({ tradable })
      .where(and(eq(userDiscoteca.userId, userId), eq(userDiscoteca.entryId, entryId)))
      .returning()
      .then(a => a?.[0]);
  })

  static isEntryTradable = maybeTransaction('isEntryTradable', async (client, userId: number, entryId: number) => {
    return await client
      .select({ tradable: userDiscoteca.tradable })
      .from(userDiscoteca)
      .where(and(eq(userDiscoteca.userId, userId), eq(userDiscoteca.entryId, entryId)))
      .limit(1)
      .then(a => a?.[0]?.tradable ?? false);
  })

  static setFavoriteAlbum = maybeTransaction('setFavoriteAlbum', async (client, userId: number, entryId: number) => {
    await client.update(userProfiles).set({ favoriteDiscotecaAlbumId: entryId }).where(eq(userProfiles.userId, userId));
  })

  static setFavoriteSingle = maybeTransaction('setFavoriteSingle', async (client, userId: number, entryId: number) => {
    await client.update(userProfiles).set({ favoriteDiscotecaSingleId: entryId }).where(eq(userProfiles.userId, userId));
  })

  static getPreviewCacheEntry = maybeTransaction('getPreviewCacheEntry', async (client, appleMusicTrackId: string) => {
    return await client
      .select()
      .from(discotecaPreviewCache)
      .where(eq(discotecaPreviewCache.appleMusicTrackId, appleMusicTrackId))
      .limit(1)
      .then(a => a?.[0]);
  })

  static setPreviewCacheEntry = maybeTransaction('setPreviewCacheEntry', async (client, appleMusicTrackId: string, mediaRef: string) => {
    return await client
      .insert(discotecaPreviewCache)
      .values({ appleMusicTrackId, mediaRef })
      .onConflictDoUpdate({ target: discotecaPreviewCache.appleMusicTrackId, set: { mediaRef } })
      .returning()
      .then(a => a?.[0]);
  })

  static setEntryTelegramFileId = maybeTransaction('setEntryTelegramFileId', async (client, entryId: number, fileId: string, fileUniqueId: string) => {
    await client
      .update(discotecaEntries)
      .set({ telegramFileId: fileId, telegramFileUniqueId: fileUniqueId })
      .where(eq(discotecaEntries.id, entryId));
  })

  static addToWishlist = maybeTransaction('addToWishlist', async (client, userId: number, entryId: number) => {
    const nextPosition = await client
      .select({ max: sql<number>`COALESCE(MAX(${discotecaWishlist.position}), -1) + 1` })
      .from(discotecaWishlist)
      .where(eq(discotecaWishlist.userId, userId))
      .then(a => a?.[0]?.max ?? 0);

    await client.insert(discotecaWishlist).values({ userId, entryId, position: nextPosition }).onConflictDoNothing();
  })

  static removeFromWishlist = maybeTransaction('removeFromWishlist', async (client, userId: number, entryId: number) => {
    await client.delete(discotecaWishlist).where(and(eq(discotecaWishlist.userId, userId), eq(discotecaWishlist.entryId, entryId)));
  })

  static isOnWishlist = maybeTransaction('isOnWishlist', async (client, userId: number, entryId: number) => {
    return !!(await client
      .select()
      .from(discotecaWishlist)
      .where(and(eq(discotecaWishlist.userId, userId), eq(discotecaWishlist.entryId, entryId)))
      .limit(1)
      .then(a => a?.[0]));
  })

  static getWishlist = maybeTransaction('getWishlist', async (
    client, userId: number, opts: { limit?: number; offset?: number } = {},
  ) => {
    const { limit = 20, offset = 0 } = opts;

    const [rows, totalRow] = await Promise.all([
      client
        .select({
          id: discotecaEntries.id,
          name: discotecaEntries.name,
          type: discotecaEntries.type,
          artistName: discotecaArtists.name,
          categoryEmoji: categories.emoji,
          rarityEmoji: rarities.emoji,
          ownedCount: sql<number>`coalesce(${userDiscoteca.count}, 0)::int`,
        })
        .from(discotecaWishlist)
        .innerJoin(discotecaEntries, eq(discotecaEntries.id, discotecaWishlist.entryId))
        .innerJoin(discotecaArtists, eq(discotecaArtists.id, discotecaEntries.artistId))
        .innerJoin(rarities, eq(rarities.id, discotecaEntries.rarityId))
        .leftJoin(userDiscoteca, and(eq(userDiscoteca.entryId, discotecaEntries.id), eq(userDiscoteca.userId, userId)))
        .leftJoin(cards, eq(cards.id, discotecaArtists.cardId))
        .leftJoin(cardSubcategories, and(eq(cardSubcategories.cardId, cards.id), eq(cardSubcategories.isMain, true)))
        .leftJoin(subcategories, eq(subcategories.id, cardSubcategories.subcategoryId))
        .leftJoin(categories, eq(categories.id, subcategories.categoryId))
        .where(eq(discotecaWishlist.userId, userId))
        .orderBy(discotecaWishlist.position)
        .limit(limit)
        .offset(offset),
      client.select({ total: sql<number>`count(*)::int` }).from(discotecaWishlist).where(eq(discotecaWishlist.userId, userId)).then(a => a?.[0]),
    ]);

    return { rows, total: totalRow?.total ?? 0 };
  })
}
