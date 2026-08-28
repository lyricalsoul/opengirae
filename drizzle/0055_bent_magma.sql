ALTER TABLE "auctions" ADD COLUMN "saleFeePaid" integer;--> statement-breakpoint
ALTER TABLE "economy" ADD COLUMN "auctionSaleFeeRate" double precision DEFAULT 0.1 NOT NULL;