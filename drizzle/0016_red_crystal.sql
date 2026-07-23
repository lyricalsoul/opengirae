CREATE TYPE "public"."allocation_ids" AS ENUM('rifa');--> statement-breakpoint
CREATE TABLE "treasury_allocations" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "treasury_allocations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"allocationId" "allocation_ids" NOT NULL,
	"name" text NOT NULL,
	"percentage" double precision DEFAULT 0 NOT NULL,
	"balance" bigint DEFAULT 0 NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "treasury_allocations_allocationId_unique" UNIQUE("allocationId")
);
--> statement-breakpoint
ALTER TABLE "economy" ADD COLUMN "lastSyncedTreasuryBalance" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
INSERT INTO "treasury_allocations" ("allocationId", "name", "percentage", "balance") VALUES ('rifa', 'Rifa', 0, 0);