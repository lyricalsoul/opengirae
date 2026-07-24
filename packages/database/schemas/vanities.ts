import {
    integer,
    pgTable,
    text,
    boolean,
    timestamp,
    pgEnum,
    unique,
    index,
} from "drizzle-orm/pg-core";
import {
    users
} from './users'

export const storeItemTypes = pgEnum("store_item_types", ["background", "sticker", "profile"])
export const storeItems = pgTable("store_items", {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    title: text().notNull(),
    description: text().notNull(),
    type: storeItemTypes("type").notNull(),
    price: integer().notNull(),
    itemURL: text().notNull(),

    createdAt: timestamp().notNull().defaultNow(),

    isAvailable: boolean().notNull().default(true),
    isSearchable: boolean().notNull().default(true)
}, (table) => [
    unique().on(table.title, table.type),
]);

export const boughtItems = pgTable("bought_items", {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer().notNull().references(() => users.id),
    itemId: integer().notNull().references(() => storeItems.id, { onDelete: "cascade" }),
    boughtAt: timestamp().notNull().defaultNow(),
}, (table) => [
    unique().on(table.userId, table.itemId),
    // /loja's purchaseCount join filters by itemId
    index("bought_items_item_idx").on(table.itemId),
]);
