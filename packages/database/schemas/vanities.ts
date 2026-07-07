import {
    integer,
    pgTable,
    text,
    boolean,
    timestamp,
    pgEnum,
} from "drizzle-orm/pg-core";

export const storeItemTypes = pgEnum("store_item_types", ["background", "sticker"])
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
});
