CREATE TABLE "wishlist" (
	"userId" integer NOT NULL,
	"cardId" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "wishlist_userId_cardId_pk" PRIMARY KEY("userId","cardId")
);
--> statement-breakpoint
ALTER TABLE "user_cards" ADD COLUMN "tradable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "makeCardsTradeableByDefault" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "wishlist" ADD CONSTRAINT "wishlist_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist" ADD CONSTRAINT "wishlist_cardId_cards_id_fk" FOREIGN KEY ("cardId") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wishlist_card_idx" ON "wishlist" USING btree ("cardId");