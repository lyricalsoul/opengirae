ALTER TABLE "trades" ADD COLUMN "discotecaUser1" integer[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "discotecaUser2" integer[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_discoteca" ADD COLUMN "tradable" boolean DEFAULT false NOT NULL;