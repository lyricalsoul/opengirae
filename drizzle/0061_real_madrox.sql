ALTER TABLE "discoteca_artists" ADD COLUMN "announcedAt" timestamp;--> statement-breakpoint
ALTER TABLE "discoteca_entries" ADD COLUMN "createdAt" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "discoteca_entries" ADD COLUMN "announcedAt" timestamp;