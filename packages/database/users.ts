import { users, userProfiles } from "./schemas/users";
import { db } from "./index";
import { eq } from "drizzle-orm";

export async function getUserById(id: number) {
  return await db.select().from(users).where(eq(users.id, id)).limit(1);
}

export async function getUserByTelegramId(telegramId: string) {
  return await db
    .select()
    .from(users)
    .where(eq(users.telegramId, telegramId))
    .limit(1)
    .then(a => a?.[0])
}

export const getUserProfileByTelegramId = async (telegramId: string) => {
  return await db
    .select()
    .from(userProfiles)
    .leftJoin(users, eq(userProfiles.userId, users.id))
    .where(eq(users.telegramId, telegramId))
    .limit(1)
    .then(a => a?.[0])
};

export const createUser = async (data: Omit<typeof users.$inferInsert, "id">) => {
  return await db.insert(users).values(data).returning().then(rows => rows[0]);
};

export const createUserProfile = async (userId: number) => {
  return await db.insert(userProfiles).values({ userId }).returning().then(rows => rows[0]);
};

export type UserWithProfile = Awaited<ReturnType<typeof getUserProfileByTelegramId>>;
