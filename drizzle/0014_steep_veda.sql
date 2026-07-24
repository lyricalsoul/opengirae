CREATE TABLE "economy" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "economy_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"treasuryBalance" integer DEFAULT 0 NOT NULL,
	"inflationRate" double precision DEFAULT 1 NOT NULL,
	"incomeInflationRate" double precision DEFAULT 1 NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "treasuryContributed" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
INSERT INTO "economy" DEFAULT VALUES;