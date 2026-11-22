import { db } from "@girae/database/index";
import { storefront } from "@girae/database/schemas/storefront";
import { rarities } from "@girae/database/schemas/cards";
import { HIPOTECA_RARITY_NAME } from "@girae/database/cards";
import { eq } from "drizzle-orm";
import type { TestFixtures } from "./fixtures";

// the migration seeds the storefront from whatever legendary cards exist, which is nothing on a fresh (ci) db - so tests put their own cards in the singleton row and restore it after.
export async function seedStorefront(fx: TestFixtures, count = 3): Promise<{ id: number; cardIds: number[] }> {
  const [legendary] = await db.select({ id: rarities.id }).from(rarities).where(eq(rarities.name, HIPOTECA_RARITY_NAME));
  const cardIds: number[] = [];
  for (let i = 0; i < count; i++) cardIds.push((await fx.card({ name: `Test Storefront Card ${i} ${Bun.randomUUIDv7()}`, rarityId: legendary?.id })).id);

  const [before] = await db.select().from(storefront).limit(1);
  await db.update(storefront).set({ cardIds });
  fx.onCleanup(async () => { await db.update(storefront).set({ cardIds: before!.cardIds, refreshedAt: before!.refreshedAt }); });
  return { id: before!.id, cardIds };
}
