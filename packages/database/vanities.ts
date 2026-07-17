import { maybeTransaction } from "./decorators";
import { storeItems, boughtItems, type storeItemTypes } from "./schemas/vanities";
import { users } from "./schemas/users";
import { UsersDB } from "./users";
import { and, desc, eq, gte, ilike, inArray, sql } from "drizzle-orm";

type StoreItemType = (typeof storeItemTypes.enumValues)[number]

export class VanitiesDB {
  static listAllStoreItems = maybeTransaction('listAllStoreItems', async (client) => {
    return await client.select().from(storeItems).orderBy(storeItems.id);
  })

  static getStoreItemsByIds = maybeTransaction('getStoreItemsByIds', async (client, ids: number[]) => {
    if (ids.length === 0) return [];
    return await client.select().from(storeItems).where(inArray(storeItems.id, ids));
  })

  static getStoreItemById = maybeTransaction('getStoreItemById', async (client, id: number) => {
    return await client.select().from(storeItems).where(eq(storeItems.id, id)).limit(1).then(a => a?.[0]);
  })

  static searchStoreItemsByType = maybeTransaction('searchStoreItemsByType', async (client, type: StoreItemType, query: string, limit: number = 100) => {
    return await client
      .select()
      .from(storeItems)
      .where(and(eq(storeItems.type, type), ilike(storeItems.title, `%${query}%`)))
      .limit(limit);
  })

  static listStoreItemsByType = maybeTransaction('listStoreItemsByType', async (client, type: StoreItemType) => {
    return await client
      .select()
      .from(storeItems)
      .where(and(eq(storeItems.type, type), eq(storeItems.isAvailable, true)))
      .orderBy(storeItems.id);
  })

  static listStoreItemsByPopularity = maybeTransaction('listStoreItemsByPopularity', async (
    client, type: StoreItemType, opts: { query?: string; limit?: number; offset?: number } = {},
  ) => {
    const { query, limit = 20, offset = 0 } = opts;
    const where = query
      ? and(eq(storeItems.type, type), eq(storeItems.isAvailable, true), ilike(storeItems.title, `%${query}%`))
      : and(eq(storeItems.type, type), eq(storeItems.isAvailable, true));

    const [rows, totalResult] = await Promise.all([
      client
        .select({
          id: storeItems.id, title: storeItems.title, description: storeItems.description,
          price: storeItems.price, itemURL: storeItems.itemURL, type: storeItems.type,
          createdAt: storeItems.createdAt,
          purchaseCount: sql<number>`CAST(COUNT(${boughtItems.id}) AS INTEGER)`,
        })
        .from(storeItems)
        .leftJoin(boughtItems, eq(boughtItems.itemId, storeItems.id))
        .where(where)
        .groupBy(storeItems.id)
        .orderBy(desc(sql`COUNT(${boughtItems.id})`))
        .limit(limit)
        .offset(offset),
      client.select({ total: sql<number>`CAST(COUNT(*) AS INTEGER)` }).from(storeItems).where(where).then(r => r[0]?.total ?? 0),
    ]);

    return { rows, total: totalResult };
  })

  static listStoreItemsByRecency = maybeTransaction('listStoreItemsByRecency', async (
    client, type: StoreItemType, opts: { query?: string; limit?: number; offset?: number } = {},
  ) => {
    const { query, limit = 20, offset = 0 } = opts;
    const where = query
      ? and(eq(storeItems.type, type), eq(storeItems.isAvailable, true), ilike(storeItems.title, `%${query}%`))
      : and(eq(storeItems.type, type), eq(storeItems.isAvailable, true));

    const [rows, totalResult] = await Promise.all([
      client
        .select({
          id: storeItems.id, title: storeItems.title, description: storeItems.description,
          price: storeItems.price, itemURL: storeItems.itemURL, type: storeItems.type,
          createdAt: storeItems.createdAt,
        })
        .from(storeItems)
        .where(where)
        .orderBy(desc(storeItems.createdAt), desc(storeItems.id))
        .limit(limit)
        .offset(offset),
      client.select({ total: sql<number>`CAST(COUNT(*) AS INTEGER)` }).from(storeItems).where(where).then(r => r[0]?.total ?? 0),
    ]);

    return { rows, total: totalResult };
  })

  static listStoreItemsByPrice = maybeTransaction('listStoreItemsByPrice', async (
    client, type: StoreItemType, opts: { query?: string; limit?: number; offset?: number } = {},
  ) => {
    const { query, limit = 20, offset = 0 } = opts;
    const where = query
      ? and(eq(storeItems.type, type), eq(storeItems.isAvailable, true), ilike(storeItems.title, `%${query}%`))
      : and(eq(storeItems.type, type), eq(storeItems.isAvailable, true));

    const rows = await client
      .select({
        id: storeItems.id, title: storeItems.title, description: storeItems.description,
        price: storeItems.price, itemURL: storeItems.itemURL, type: storeItems.type,
        createdAt: storeItems.createdAt,
      })
      .from(storeItems)
      .where(where)
      .orderBy(storeItems.price, storeItems.id)
      .limit(limit)
      .offset(offset);

    const total = await client
      .select({ total: sql<number>`CAST(COUNT(*) AS INTEGER)` })
      .from(storeItems)
      .where(where)
      .then(r => r[0]?.total ?? 0);

    return { rows, total };
  })

  static listOwnedStoreItems = maybeTransaction('listOwnedStoreItems', async (
    client, userId: number, type: StoreItemType,
    opts: { equippedId?: number | null; limit?: number; offset?: number } = {},
  ) => {
    const { equippedId, limit = 50, offset = 0 } = opts;
    const where = and(eq(boughtItems.userId, userId), eq(storeItems.type, type));

    const rows = await client
      .select({
        id: storeItems.id, title: storeItems.title, description: storeItems.description,
        price: storeItems.price, itemURL: storeItems.itemURL, type: storeItems.type,
      })
      .from(boughtItems)
      .innerJoin(storeItems, eq(storeItems.id, boughtItems.itemId))
      .where(where)
      .orderBy(sql`CASE WHEN ${storeItems.id} = ${equippedId ?? -1} THEN 0 ELSE 1 END`, storeItems.id)
      .limit(limit)
      .offset(offset);

    const total = await client
      .select({ total: sql<number>`CAST(COUNT(*) AS INTEGER)` })
      .from(boughtItems)
      .innerJoin(storeItems, eq(storeItems.id, boughtItems.itemId))
      .where(where)
      .then(r => r[0]?.total ?? 0);

    return { rows, total };
  })

  static hasBought = maybeTransaction('hasBought', async (client, userId: number, itemId: number): Promise<boolean> => {
    return !!(await client
      .select()
      .from(boughtItems)
      .where(and(eq(boughtItems.userId, userId), eq(boughtItems.itemId, itemId)))
      .limit(1)
      .then(a => a?.[0]));
  })

  static addBoughtItem = maybeTransaction('addBoughtItem', async (client, userId: number, itemId: number) => {
    return await client.insert(boughtItems).values({ userId, itemId }).returning().then(a => a?.[0]);
  })

  static purchaseItem = maybeTransaction('purchaseItem', async (client, userId: number, itemId: number, price: number) => {
    const [spendRow] = await client
      .update(users)
      .set({ coins: sql`${users.coins} - ${price}` })
      .where(and(eq(users.id, userId), gte(users.coins, price)))
      .returning();
    if (!spendRow) return { ok: false as const, reason: 'insufficient_funds' as const };

    const item = await client.insert(boughtItems).values({ userId, itemId }).returning().then(a => a?.[0]);
    return { ok: true as const, item };
  })

  static buyItem = async (userId: number, itemId: number): Promise<
    { ok: true } | { ok: false; reason: 'not_found' | 'insufficient_funds' | 'already_owned' }
  > => {
    const item = await VanitiesDB.getStoreItemById(itemId);
    if (!item || !item.isAvailable || item.type === 'profile') return { ok: false, reason: 'not_found' };
    if (await VanitiesDB.hasBought(userId, itemId)) return { ok: false, reason: 'already_owned' };

    const result = await VanitiesDB.purchaseItem(userId, itemId, item.price).catch((e: any) => {
      if (e?.code === '23505') return { ok: false as const, reason: 'already_owned' as const };
      throw e;
    });
    if (!result.ok) return result;
    return { ok: true };
  }

  static equipItem = async (userId: number, type: 'background' | 'sticker', itemId: number): Promise<
    { ok: true; title: string } | { ok: false; reason: 'not_owned' | 'not_found' }
  > => {
    if (!(await VanitiesDB.hasBought(userId, itemId))) return { ok: false, reason: 'not_owned' };
    const item = await VanitiesDB.getStoreItemById(itemId);
    if (!item) return { ok: false, reason: 'not_found' };

    const field = type === 'background' ? 'equipedBackgroundId' : 'equipedStickerId';
    await UsersDB.updateUserProfile(userId, { [field]: itemId });
    return { ok: true, title: item.title };
  }

  // bulk ownership lookup - avoids one hasBought() call per item when rendering a browse list
  static getBoughtItemIds = maybeTransaction('getBoughtItemIds', async (client, userId: number): Promise<number[]> => {
    return await client
      .select({ itemId: boughtItems.itemId })
      .from(boughtItems)
      .where(eq(boughtItems.userId, userId))
      .then(rows => rows.map(r => r.itemId));
  })

  static getStoreItemByTitle = maybeTransaction('getStoreItemByTitle', async (client, title: string, type: StoreItemType) => {
    return await client
      .select()
      .from(storeItems)
      .where(and(eq(storeItems.title, title), eq(storeItems.type, type)))
      .limit(1)
      .then(a => a?.[0]);
  })

  static createStoreItem = maybeTransaction('createStoreItem', async (client, data: typeof storeItems.$inferInsert) => {
    return await client.insert(storeItems).values(data).returning().then(a => a?.[0]);
  })

  static updateStoreItem = maybeTransaction('updateStoreItem', async (client, id: number, data: Partial<typeof storeItems.$inferInsert>) => {
    return await client.update(storeItems).set(data).where(eq(storeItems.id, id)).returning().then(a => a?.[0]);
  })

  static deleteStoreItem = maybeTransaction('deleteStoreItem', async (client, id: number) => {
    return await client.delete(storeItems).where(eq(storeItems.id, id)).returning().then(a => a?.[0]);
  })
}
