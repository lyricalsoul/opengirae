CREATE TABLE "trades" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "trades_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user1Id" integer NOT NULL,
	"user2Id" integer NOT NULL,
	"cardsUser1" integer[] NOT NULL,
	"cardsUser2" integer[] NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "card_draw_history" DROP CONSTRAINT "card_draw_history_subcategoryId_subcategories_id_fk";
--> statement-breakpoint
ALTER TABLE "card_subcategories" DROP CONSTRAINT "card_subcategories_subcategoryId_subcategories_id_fk";
--> statement-breakpoint
ALTER TABLE "chocolate_factory_corrections" DROP CONSTRAINT "chocolate_factory_corrections_subcategoryId_subcategories_id_fk";
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "username" text;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_user1Id_users_id_fk" FOREIGN KEY ("user1Id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_user2Id_users_id_fk" FOREIGN KEY ("user2Id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_draw_history" ADD CONSTRAINT "card_draw_history_subcategoryId_subcategories_id_fk" FOREIGN KEY ("subcategoryId") REFERENCES "public"."subcategories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_subcategories" ADD CONSTRAINT "card_subcategories_subcategoryId_subcategories_id_fk" FOREIGN KEY ("subcategoryId") REFERENCES "public"."subcategories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chocolate_factory_corrections" ADD CONSTRAINT "chocolate_factory_corrections_subcategoryId_subcategories_id_fk" FOREIGN KEY ("subcategoryId") REFERENCES "public"."subcategories"("id") ON DELETE cascade ON UPDATE no action;