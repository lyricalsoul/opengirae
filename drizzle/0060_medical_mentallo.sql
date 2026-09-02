CREATE TABLE "auction_watch_notifications" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "auction_watch_notifications_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"auctionId" integer NOT NULL,
	"userId" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"notifiedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "auction_watches" (
	"userId" integer NOT NULL,
	"cardId" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "auction_watches_userId_cardId_pk" PRIMARY KEY("userId","cardId")
);
--> statement-breakpoint
ALTER TABLE "auction_watch_notifications" ADD CONSTRAINT "auction_watch_notifications_auctionId_auctions_id_fk" FOREIGN KEY ("auctionId") REFERENCES "public"."auctions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auction_watch_notifications" ADD CONSTRAINT "auction_watch_notifications_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auction_watches" ADD CONSTRAINT "auction_watches_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auction_watches" ADD CONSTRAINT "auction_watches_cardId_cards_id_fk" FOREIGN KEY ("cardId") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auction_watch_notifications_pending_idx" ON "auction_watch_notifications" USING btree ("notifiedAt");--> statement-breakpoint
CREATE INDEX "auction_watches_card_idx" ON "auction_watches" USING btree ("cardId");