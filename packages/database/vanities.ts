import { dataSource } from "./index";
import { storeItems } from "./schemas/vanities";
import { inArray } from "drizzle-orm";

export class VanitiesDB {
  @dataSource.transaction()
  static async getStoreItemsByIds(ids: number[]) {
    if (ids.length === 0) return [];
    return await dataSource.client.select().from(storeItems).where(inArray(storeItems.id, ids));
  }
}
