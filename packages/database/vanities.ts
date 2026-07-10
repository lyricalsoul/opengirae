import { maybeTransaction } from "./decorators";
import { storeItems, boughtItems, type storeItemTypes } from "./schemas/vanities";
import { and, eq, ilike, inArray } from "drizzle-orm";

type StoreItemType = (typeof storeItemTypes.enumValues)[number]

export class VanitiesDB {
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
}
