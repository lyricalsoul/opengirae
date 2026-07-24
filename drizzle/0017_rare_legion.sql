CREATE TYPE "public"."cativeiro_media_type" AS ENUM('photo', 'video');--> statement-breakpoint
CREATE TYPE "public"."cativeiro_submission_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "card_customization_submissions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "card_customization_submissions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"userId" integer NOT NULL,
	"cardId" integer NOT NULL,
	"mediaUrl" text NOT NULL,
	"mediaType" "cativeiro_media_type" NOT NULL,
	"status" "cativeiro_submission_status" DEFAULT 'pending' NOT NULL,
	"submitterPlatform" text NOT NULL,
	"submitterPlatformId" text NOT NULL,
	"submitterName" text NOT NULL,
	"submitterChatId" text NOT NULL,
	"submitterThreadId" text,
	"reviewChatId" text,
	"reviewMessageId" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rarities" ADD COLUMN "cativeiroThreshold" integer DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE "subcategories" ADD COLUMN "emoji" text;--> statement-breakpoint
ALTER TABLE "user_cards" ADD COLUMN "customEmoji" text;--> statement-breakpoint
ALTER TABLE "user_cards" ADD COLUMN "customMediaUrl" text;--> statement-breakpoint
ALTER TABLE "user_cards" ADD COLUMN "customMediaType" "cativeiro_media_type";--> statement-breakpoint
ALTER TABLE "card_customization_submissions" ADD CONSTRAINT "card_customization_submissions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_customization_submissions" ADD CONSTRAINT "card_customization_submissions_cardId_cards_id_fk" FOREIGN KEY ("cardId") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "card_customization_submissions_pending_unique" ON "card_customization_submissions" USING btree ("userId","cardId") WHERE "card_customization_submissions"."status" = 'pending';