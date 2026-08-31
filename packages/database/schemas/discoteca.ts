import { users } from "./users";
import { rarities, cards } from "./cards";
import { sql } from "drizzle-orm";
import {
  integer,
  pgTable,
  text,
  timestamp,
  boolean,
  primaryKey,
  index,
  uniqueIndex,
  pgEnum,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

export const discotecaType = pgEnum("discoteca_type", ["single", "album"]);

export const discotecaGenres = pgTable("discoteca_genres", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: text().notNull().unique(),
  imageUrl: text(),
});

export const discotecaGenreAliases = pgTable("discoteca_genre_aliases", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  genreId: integer()
    .notNull()
    .references(() => discotecaGenres.id, { onDelete: "cascade" }),
  alias: text().notNull().unique(),
});

export const discotecaSubcategories = pgTable(
  "discoteca_subcategories",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    genreId: integer()
      .notNull()
      .references(() => discotecaGenres.id, { onDelete: "cascade" }),
    isAlbum: boolean().notNull(),
    name: text().notNull().unique(),
    emoji: text().notNull(),
    rarityModifier: integer().notNull().default(100),
    imageUrl: text(),
  },
  (table) => [uniqueIndex("discoteca_subcategories_genre_is_album_idx").on(table.genreId, table.isAlbum)],
);

export const discotecaArtists = pgTable(
  "discoteca_artists",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    name: text().notNull(),
    appleMusicArtistId: text().notNull().unique(),
    cardId: integer().references(() => cards.id, { onDelete: "set null" }),
    imageUrl: text(),
    createdAt: timestamp().notNull().defaultNow(),
  },
  (table) => [
    index("discoteca_artists_card_idx").on(table.cardId),
    index("discoteca_artists_name_trgm_idx").using("gin", sql`immutable_unaccent(${table.name}) gin_trgm_ops`),
  ],
);

export const discotecaArtistAppleIds = pgTable("discoteca_artist_apple_ids", {
  appleMusicArtistId: text().primaryKey(),
  artistId: integer()
    .notNull()
    .references(() => discotecaArtists.id, { onDelete: "cascade" }),
});

export const discotecaEntries = pgTable(
  "discoteca_entries",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    name: text().notNull(),
    artistId: integer()
      .notNull()
      .references(() => discotecaArtists.id),
    appleMusicId: text().notNull().unique(),
    type: discotecaType().notNull(),
    artworkUrl: text(),
    animatedArtworkUrl: text(),
    releaseDate: timestamp(),
    rarityId: integer()
      .notNull()
      .references(() => rarities.id),
    rarityModifier: integer().notNull().default(100),
    previewUrl: text(),
    telegramFileId: text(),
    telegramFileUniqueId: text(),
    appleMusicUrl: text(),
    albumAppleMusicId: text(),
    albumId: integer().references((): AnyPgColumn => discotecaEntries.id, { onDelete: "set null" }),
    updatedAt: timestamp().notNull().defaultNow(),
  },
  (table) => [
    index("discoteca_entries_name_trgm_idx").using("gin", sql`immutable_unaccent(${table.name}) gin_trgm_ops`),
    index("discoteca_entries_album_idx").on(table.albumId),
    index("discoteca_entries_artist_type_idx").on(table.artistId, table.type),
  ],
);

export const discotecaAlbumTracks = pgTable(
  "discoteca_album_tracks",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    entryId: integer()
      .notNull()
      .references(() => discotecaEntries.id, { onDelete: "cascade" }),
    trackAppleMusicId: text().notNull(),
    name: text().notNull(),
  },
  (table) => [index("discoteca_album_tracks_entry_idx").on(table.entryId)],
);

export const discotecaEntrySubcategories = pgTable(
  "discoteca_entry_subcategories",
  {
    entryId: integer()
      .notNull()
      .references(() => discotecaEntries.id, { onDelete: "cascade" }),
    subcategoryId: integer()
      .notNull()
      .references(() => discotecaSubcategories.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.entryId, table.subcategoryId] }),
    index("discoteca_entry_subcategories_subcategory_idx").on(table.subcategoryId),
  ],
);

export const discotecaPreviewCache = pgTable("discoteca_preview_cache", {
  appleMusicTrackId: text().primaryKey(),
  mediaRef: text().notNull(),
  createdAt: timestamp().notNull().defaultNow(),
});

export const userDiscoteca = pgTable(
  "user_discoteca",
  {
    userId: integer()
      .notNull()
      .references(() => users.id),
    entryId: integer()
      .notNull()
      .references(() => discotecaEntries.id),
    count: integer().notNull().default(1),
    tradable: boolean().notNull().default(false),
    updatedAt: timestamp().notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.entryId] }),
    index("user_discoteca_entry_idx").on(table.entryId),
  ],
);

export const discotecaWishlist = pgTable(
  "discoteca_wishlist",
  {
    userId: integer()
      .notNull()
      .references(() => users.id),
    entryId: integer()
      .notNull()
      .references(() => discotecaEntries.id),
    position: integer().notNull().default(0),
    createdAt: timestamp().notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.entryId] }),
    index("discoteca_wishlist_entry_idx").on(table.entryId),
  ],
);
