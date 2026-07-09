CREATE TYPE "public"."store_item_types" AS ENUM('background', 'sticker', 'profile');--> statement-breakpoint
CREATE TABLE "card_draw_history" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "card_draw_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"userId" integer NOT NULL,
	"cardId" integer NOT NULL,
	"categoryId" integer NOT NULL,
	"subcategoryId" integer NOT NULL,
	"drawnAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_subcategories" (
	"cardId" integer NOT NULL,
	"subcategoryId" integer NOT NULL,
	"isMain" boolean DEFAULT false NOT NULL,
	CONSTRAINT "card_subcategories_cardId_subcategoryId_pk" PRIMARY KEY("cardId","subcategoryId")
);
--> statement-breakpoint
CREATE TABLE "cards" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cards_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"rarityId" integer NOT NULL,
	"imageUrl" text,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"rarityModifier" integer DEFAULT 100 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "categories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"emoji" text NOT NULL,
	"subcategoriesOnDraw" integer DEFAULT 4 NOT NULL,
	"isHidden" boolean DEFAULT false NOT NULL,
	"drawImageUrl" text,
	CONSTRAINT "categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "rarities" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rarities_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"weight" integer NOT NULL,
	"emoji" text NOT NULL,
	CONSTRAINT "rarities_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "subcategories" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "subcategories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"categoryId" integer NOT NULL,
	"name" text NOT NULL,
	"tags" text[],
	"isSecondary" boolean DEFAULT false NOT NULL,
	"imageUrl" text,
	"rarityModifier" integer DEFAULT 100 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_cards" (
	"userId" integer NOT NULL,
	"cardId" integer NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_cards_userId_cardId_pk" PRIMARY KEY("userId","cardId")
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "user_profiles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"userId" integer NOT NULL,
	"bio" text,
	"reputation" integer DEFAULT 0 NOT NULL,
	"favoriteColor" text DEFAULT '#FF94DB' NOT NULL,
	"isMarried" boolean DEFAULT false NOT NULL,
	"partnerId" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"hideProfileEmojis" boolean DEFAULT false NOT NULL,
	"equipedBackgroundId" integer DEFAULT 1 NOT NULL,
	"equipedStickerId" integer DEFAULT 2 NOT NULL,
	"equipedProfileId" integer DEFAULT 3 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"telegramId" text NOT NULL,
	"isBanned" boolean DEFAULT false NOT NULL,
	"banMessage" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"luckModifier" integer DEFAULT 100 NOT NULL,
	"coins" integer DEFAULT 0 NOT NULL,
	"privacyMode" boolean DEFAULT false NOT NULL,
	"displayName" text NOT NULL,
	"avatarUrl" text NOT NULL,
	"avatarUpdatedAt" timestamp,
	"maxDraws" integer DEFAULT 12 NOT NULL,
	"usedDraws" integer DEFAULT 0 NOT NULL,
	"hasGottenDaily" boolean DEFAULT false NOT NULL,
	"dailyStreak" integer DEFAULT 0 NOT NULL,
	"favoriteCardId" integer,
	CONSTRAINT "users_telegramId_unique" UNIQUE("telegramId")
);
--> statement-breakpoint
CREATE TABLE "bought_items" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "bought_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"userId" integer NOT NULL,
	"itemId" integer NOT NULL,
	"boughtAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_items" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "store_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"title" text NOT NULL,
	"description" text NOT NULL,
	"type" "store_item_types" NOT NULL,
	"price" integer NOT NULL,
	"itemURL" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"isAvailable" boolean DEFAULT true NOT NULL,
	"isSearchable" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "card_draw_history" ADD CONSTRAINT "card_draw_history_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_draw_history" ADD CONSTRAINT "card_draw_history_cardId_cards_id_fk" FOREIGN KEY ("cardId") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_draw_history" ADD CONSTRAINT "card_draw_history_categoryId_categories_id_fk" FOREIGN KEY ("categoryId") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_draw_history" ADD CONSTRAINT "card_draw_history_subcategoryId_subcategories_id_fk" FOREIGN KEY ("subcategoryId") REFERENCES "public"."subcategories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_subcategories" ADD CONSTRAINT "card_subcategories_cardId_cards_id_fk" FOREIGN KEY ("cardId") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_subcategories" ADD CONSTRAINT "card_subcategories_subcategoryId_subcategories_id_fk" FOREIGN KEY ("subcategoryId") REFERENCES "public"."subcategories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_rarityId_rarities_id_fk" FOREIGN KEY ("rarityId") REFERENCES "public"."rarities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcategories" ADD CONSTRAINT "subcategories_categoryId_categories_id_fk" FOREIGN KEY ("categoryId") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_cards" ADD CONSTRAINT "user_cards_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_cards" ADD CONSTRAINT "user_cards_cardId_cards_id_fk" FOREIGN KEY ("cardId") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_partnerId_users_id_fk" FOREIGN KEY ("partnerId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_equipedBackgroundId_store_items_id_fk" FOREIGN KEY ("equipedBackgroundId") REFERENCES "public"."store_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_equipedStickerId_store_items_id_fk" FOREIGN KEY ("equipedStickerId") REFERENCES "public"."store_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_equipedProfileId_store_items_id_fk" FOREIGN KEY ("equipedProfileId") REFERENCES "public"."store_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_favoriteCardId_cards_id_fk" FOREIGN KEY ("favoriteCardId") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bought_items" ADD CONSTRAINT "bought_items_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bought_items" ADD CONSTRAINT "bought_items_itemId_store_items_id_fk" FOREIGN KEY ("itemId") REFERENCES "public"."store_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_subcategories_sub_idx" ON "card_subcategories" USING btree ("subcategoryId");