ALTER TABLE "users" ADD COLUMN "hasJoinedSupportChannel" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "supportChannelCheckedAt" timestamp;