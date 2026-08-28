// Shared test-data builder: cuts the "insert a user/category/card, then remember to
// delete everything in reverse FK order in afterAll" boilerplate that used to be
// hand-duplicated in nearly every *.test.ts file in this repo.
//
// Deliberately calls the same `UsersDB`/`CardsDB` methods production code paths use
// (`UsersDB.ensureUser`, `CardsDB.createCategory`/`createSubcategory`/`createCard`)
// rather than reimplementing the inserts here - a test suite that recreates its own
// version of "how to create a user" drifts from prod behavior over time and stops
// actually proving anything. Cleanup itself has no prod equivalent to call (nothing
// deletes a user in normal operation), so that part is real raw deletes - but object
// *creation* always goes through the real `*DB` method when one exists.
import { db } from "@girae/database/index";
import { users, linkedAccounts, userProfiles } from "@girae/database/schemas/users";
import { cards, categories, subcategories, cardSubcategories, rarities, userCards } from "@girae/database/schemas/cards";
import { storeItems } from "@girae/database/schemas/vanities";
import { discotecaGenres, discotecaSubcategories, discotecaEntries, discotecaArtists } from "@girae/database/schemas/discoteca";
import { eq, and } from "drizzle-orm";
import { UsersDB } from "@girae/database/users";
import { CardsDB } from "@girae/database/cards";
import { EconomyDB } from "@girae/database/economy";
import { VanitiesDB } from "@girae/database/vanities";
import { DiscotecaDB } from "@girae/database/discoteca";
import type { Platform } from "@girae/common/commands/types";

let cachedRarityId: number | undefined;

/** Any existing rarity id - rarities are a small, static catalog, safe to reuse across tests. */
export async function anyRarityId(): Promise<number> {
  if (cachedRarityId !== undefined) return cachedRarityId;
  const id = await db.select({ id: rarities.id }).from(rarities).limit(1).then(r => r[0]!.id);
  cachedRarityId = id;
  return id;
}

export interface TestUser {
  id: number;
  platform: Platform;
  platformId: string;
}

export class TestFixtures {
  private cleanups: Array<() => Promise<void>> = [];

  /** Register a teardown to run (LIFO) from `cleanup()`. Escape hatch for anything the helpers below don't cover. */
  onCleanup(fn: () => Promise<void>): void {
    this.cleanups.push(fn);
  }

  /** Goes through UsersDB.ensureUser - the exact function real inbound messages call - so a
   * test user is indistinguishable from a real one (linked account + profile included). */
  async user(opts: {
    displayName: string;
    platform?: Platform;
    platformId?: string;
  }): Promise<TestUser> {
    const platform = opts.platform ?? 'none';
    const platformId = opts.platformId ?? `test-${Bun.randomUUIDv7()}`;

    const row = await UsersDB.ensureUser({ platform, platformId, displayName: opts.displayName, avatarUrl: '' });
    const id = row!.id;

    this.onCleanup(async () => {
      await db.delete(userProfiles).where(eq(userProfiles.userId, id));
      await db.delete(linkedAccounts).where(eq(linkedAccounts.userId, id));
      await db.delete(users).where(eq(users.id, id));
    });

    return { id, platform, platformId };
  }

  async rarity(opts: { name: string; emoji?: string; weight?: number; cativeiroThreshold?: number; auctionBaseValue?: number }): Promise<{ id: number }> {
    const row = await CardsDB.createRarity(opts.name, opts.emoji ?? '🏷️', opts.weight ?? 100);
    const id = row!.id;
    if (opts.cativeiroThreshold !== undefined) await CardsDB.updateRarity(id, { cativeiroThreshold: opts.cativeiroThreshold });
    if (opts.auctionBaseValue !== undefined) await CardsDB.updateRarity(id, { auctionBaseValue: opts.auctionBaseValue });
    this.onCleanup(async () => { await db.delete(rarities).where(eq(rarities.id, id)); });
    return { id };
  }

  async category(opts: { name: string; emoji?: string } = { name: `Test Category ${Bun.randomUUIDv7()}` }): Promise<{ id: number }> {
    const row = await CardsDB.createCategory(opts.name, opts.emoji);
    const id = row!.id;
    this.onCleanup(async () => { await db.delete(categories).where(eq(categories.id, id)); });
    return { id };
  }

  /** The canonical genre concept (e.g. "Pop") that aliases point at - shared by both its subcategories. */
  async discotecaGenre(opts: { name?: string } = {}): Promise<{ id: number }> {
    const name = opts.name ?? `Test Genre ${Bun.randomUUIDv7()}`;
    const row = await DiscotecaDB.createGenre(name);
    const id = row!.id;
    this.onCleanup(async () => { await db.delete(discotecaGenres).where(eq(discotecaGenres.id, id)); });
    return { id };
  }

  /** The browsable album/single variant of a genre (e.g. "Álbuns de Pop") - what entries actually link to. */
  async discotecaSubcategory(opts: { name?: string; emoji?: string; genreId?: number; isAlbum?: boolean } = {}): Promise<{ id: number }> {
    const name = opts.name ?? `Test Subcategory ${Bun.randomUUIDv7()}`;
    const genreId = opts.genreId ?? (await this.discotecaGenre()).id;
    const row = await DiscotecaDB.createSubcategory(genreId, name, opts.emoji ?? '🎵', opts.isAlbum ?? true);
    const id = row!.id;
    this.onCleanup(async () => { await db.delete(discotecaSubcategories).where(eq(discotecaSubcategories.id, id)); });
    return { id };
  }

  async discotecaArtist(opts: { name?: string; appleMusicArtistId?: string } = {}): Promise<{ id: number }> {
    const row = await DiscotecaDB.getOrCreateArtist(
      opts.appleMusicArtistId ?? `test-apple-music-artist-${Bun.randomUUIDv7()}`,
      opts.name ?? `Test Artist ${Bun.randomUUIDv7()}`,
    );
    const id = row!.id;
    this.onCleanup(async () => { await db.delete(discotecaArtists).where(eq(discotecaArtists.id, id)); });
    return { id };
  }

  async discotecaEntry(opts: {
    name?: string;
    artistId?: number;
    appleMusicId?: string;
    type?: 'single' | 'album';
    rarityId?: number;
  } = {}): Promise<{ id: number }> {
    const rarityId = opts.rarityId ?? await anyRarityId();
    const artistId = opts.artistId ?? (await this.discotecaArtist()).id;
    const row = await DiscotecaDB.createEntry({
      name: opts.name ?? `Test Entry ${Bun.randomUUIDv7()}`,
      artistId,
      appleMusicId: opts.appleMusicId ?? `test-apple-music-${Bun.randomUUIDv7()}`,
      type: opts.type ?? 'single',
      rarityId,
    });
    const id = row!.id;
    this.onCleanup(async () => { await db.delete(discotecaEntries).where(eq(discotecaEntries.id, id)); });
    return { id };
  }

  async subcategory(opts: { categoryId: number; name: string }): Promise<{ id: number; categoryId: number; name: string }> {
    const row = await CardsDB.createSubcategory(opts.name, opts.categoryId);
    const id = row!.id;
    this.onCleanup(async () => { await db.delete(subcategories).where(eq(subcategories.id, id)); });
    return { id, categoryId: opts.categoryId, name: opts.name };
  }

  /**
   * Creates a card, defaulting to an existing rarity. Pass `subcategoryId` to also
   * attach it as the main subcategory (via `CardsDB.createCard`, the real creation
   * path - not a bare `cards` insert plus a hand-rolled `cardSubcategories` insert).
   */
  async card(opts: { name: string; rarityId?: number; subcategoryId?: number }): Promise<{ id: number }> {
    const rarityId = opts.rarityId ?? await anyRarityId();

    if (opts.subcategoryId !== undefined) {
      const row = await CardsDB.createCard(opts.name, rarityId, null, opts.subcategoryId);
      const id = row!.id;
      this.onCleanup(async () => {
        await db.delete(cardSubcategories).where(eq(cardSubcategories.cardId, id));
        await db.delete(cards).where(eq(cards.id, id));
      });
      return { id };
    }

    // no subcategory relevant to this test - createCard requires one, so this is the
    // one place fixtures does a bare insert rather than calling a *DB method.
    const [row] = await db.insert(cards).values({ name: opts.name, rarityId }).returning();
    const id = row!.id;
    this.onCleanup(async () => { await db.delete(cards).where(eq(cards.id, id)); });
    return { id };
  }

  /** Grants a user N copies of a card via the real CardsDB.addUserCard, looped N times. */
  async ownCard(userId: number, cardId: number, count: number): Promise<void> {
    const incomeInflationRate = await EconomyDB.getIncomeInflationRate();
    for (let i = 0; i < count; i++) await CardsDB.addUserCard(userId, cardId, incomeInflationRate);
    this.onCleanup(async () => { await db.delete(userCards).where(and(eq(userCards.userId, userId), eq(userCards.cardId, cardId))); });
  }

  async storeItem(opts: {
    title: string;
    type: 'background' | 'sticker' | 'profile';
    price?: number;
    itemURL?: string;
    description?: string;
  }): Promise<{ id: number }> {
    const row = await VanitiesDB.createStoreItem({
      title: opts.title,
      type: opts.type,
      price: opts.price ?? 0,
      itemURL: opts.itemURL ?? 'https://example.com/x.png',
      description: opts.description ?? 'test',
    });
    const id = row!.id;
    this.onCleanup(async () => { await db.delete(storeItems).where(eq(storeItems.id, id)); });
    return { id };
  }

  /**
   * Runs every registered cleanup, most-recently-created first. Call once, from
   * `afterAll`. A step that throws (e.g. a missing safety-net delete leaving an FK
   * reference behind) is logged and skipped rather than aborting the rest of the
   * queue - one bad step orphaning everything *after* it is exactly how stray test
   * rows accumulate across runs and start colliding with later ones.
   */
  async cleanup(): Promise<void> {
    const errors: unknown[] = [];
    for (const fn of this.cleanups.reverse()) {
      try {
        await fn();
      } catch (e) {
        errors.push(e);
      }
    }
    this.cleanups = [];
    if (errors.length > 0) {
      console.error(`TestFixtures.cleanup(): ${errors.length} cleanup step(s) failed (see below) - check for orphaned rows`, errors);
    }
  }
}
