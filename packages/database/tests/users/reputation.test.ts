import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { db } from "../../index";
import { users, userProfiles } from "../../schemas/users";
import { eq } from "drizzle-orm";
import { UsersDB } from "../../users";

describe("UsersDB.addReputation / setRepGiven", () => {
  let userId: number;

  beforeAll(async () => {
    const [user] = await db.insert(users).values({ displayName: "Test Rep", avatarUrl: "" }).returning();
    userId = user!.id;
    await db.insert(userProfiles).values({ userId });
  });

  afterAll(async () => {
    await db.delete(userProfiles).where(eq(userProfiles.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
  });

  test("addReputation atomically increments the profile's reputation", async () => {
    await UsersDB.addReputation(userId, 1);
    await UsersDB.addReputation(userId, 1);

    const profile = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).then(r => r[0]);
    expect(profile!.reputation).toBe(2);
  });

  test("setRepGiven flips the giver's daily flag", async () => {
    expect((await UsersDB.getUserById(userId))!.hasGivenRepToday).toBe(false);
    await UsersDB.setRepGiven(userId);
    expect((await UsersDB.getUserById(userId))!.hasGivenRepToday).toBe(true);
  });
});

// resetMidnightStats itself is deliberately not exercised here - it updates every
// row in `users` with no WHERE scoping (see packages/database/users.ts), so calling
// it from a test would reset every other user's daily-streak state in a shared dev DB.
