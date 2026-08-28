CREATE TYPE "public"."auction_status" AS ENUM('active', 'sold', 'expired', 'cancelled');--> statement-breakpoint
CREATE TABLE "auction_bids" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "auction_bids_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"auctionId" integer NOT NULL,
	"bidderId" integer NOT NULL,
	"amount" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"notifiedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "auctions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "auctions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"sellerId" integer NOT NULL,
	"cardId" integer NOT NULL,
	"tradable" boolean NOT NULL,
	"customEmoji" text,
	"customMediaUrl" text,
	"customMediaType" "cativeiro_media_type",
	"status" "auction_status" DEFAULT 'active' NOT NULL,
	"startingBid" integer NOT NULL,
	"capPrice" integer NOT NULL,
	"bidIncrement" integer NOT NULL,
	"overtimeIncrement" integer NOT NULL,
	"currentBid" integer,
	"currentBidderId" integer,
	"listingFeePaid" integer NOT NULL,
	"insured" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"resolvedAt" timestamp,
	"resolutionNotifiedAt" timestamp
);
--> statement-breakpoint
ALTER TABLE "rarities" ADD COLUMN "auctionBaseValue" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "economy" ADD COLUMN "auctionListingFeeMultiplier" double precision DEFAULT 1.25 NOT NULL;--> statement-breakpoint
ALTER TABLE "economy" ADD COLUMN "auctionInsuranceFeeMultiplier" double precision DEFAULT 1.1 NOT NULL;--> statement-breakpoint
ALTER TABLE "economy" ADD COLUMN "auctionsEnabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "auction_bids" ADD CONSTRAINT "auction_bids_auctionId_auctions_id_fk" FOREIGN KEY ("auctionId") REFERENCES "public"."auctions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auction_bids" ADD CONSTRAINT "auction_bids_bidderId_users_id_fk" FOREIGN KEY ("bidderId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_sellerId_users_id_fk" FOREIGN KEY ("sellerId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_cardId_cards_id_fk" FOREIGN KEY ("cardId") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_currentBidderId_users_id_fk" FOREIGN KEY ("currentBidderId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auction_bids_auction_idx" ON "auction_bids" USING btree ("auctionId");--> statement-breakpoint
CREATE UNIQUE INDEX "auctions_active_seller_card_idx" ON "auctions" USING btree ("sellerId","cardId") WHERE "auctions"."status" = 'active';--> statement-breakpoint
CREATE INDEX "auctions_status_expires_idx" ON "auctions" USING btree ("status","expiresAt");--> statement-breakpoint
CREATE INDEX "auctions_seller_created_idx" ON "auctions" USING btree ("sellerId","createdAt");--> statement-breakpoint
-- seed /leilao reference values (at inflationRate = 1) - see rarities.auctionBaseValue
UPDATE "rarities" SET "auctionBaseValue" = 7500 WHERE "name" = 'Comum';--> statement-breakpoint
UPDATE "rarities" SET "auctionBaseValue" = 15000 WHERE "name" = 'Raro';--> statement-breakpoint
UPDATE "rarities" SET "auctionBaseValue" = 30000 WHERE "name" = 'Lendário';