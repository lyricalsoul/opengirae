import { users, userProfiles } from "./schemas/users";
import { dataSource } from "./index";
import { eq, sql } from "drizzle-orm";

export class UsersDB {
  @dataSource.transaction()
  static async getUserById(id: number) {
    return await dataSource.client.select().from(users).where(eq(users.id, id)).limit(1).then(a => a?.[0]);
  }

  @dataSource.transaction()
  static async getUserByTelegramId(telegramId: string) {
    return await dataSource.client
      .select()
      .from(users)
      .where(eq(users.telegramId, telegramId))
      .limit(1)
      .then(a => a?.[0])
  }

  @dataSource.transaction()
  static async getUserProfileByTelegramId(telegramId: string) {
    return await dataSource.client
      .select()
      .from(userProfiles)
      .leftJoin(users, eq(userProfiles.userId, users.id))
      .where(eq(users.telegramId, telegramId))
      .limit(1)
      .then(a => a?.[0])
  }

  @dataSource.transaction()
  static async createUser(data: Omit<typeof users.$inferInsert, "id">) {
    return await dataSource.client.insert(users).values(data).returning().then(rows => rows[0]);
  }

  @dataSource.transaction()
  static async createUserProfile(userId: number) {
    return await dataSource.client.insert(userProfiles).values({ userId }).returning().then(rows => rows[0]);
  }

  @dataSource.transaction()
  static async incrementUsedDraws(userId: number) {
    return await dataSource.client
      .update(users)
      .set({ usedDraws: sql`${users.usedDraws} + 1` })
      .where(eq(users.id, userId))
      .returning()
      .then(rows => rows[0]);
  }
}
