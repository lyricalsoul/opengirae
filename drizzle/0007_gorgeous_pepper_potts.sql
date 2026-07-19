CREATE TABLE "linked_accounts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "linked_accounts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"userId" integer NOT NULL,
	"platform" text NOT NULL,
	"platformId" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "linked_accounts_platform_platformId_unique" UNIQUE("platform","platformId")
);
--> statement-breakpoint
INSERT INTO "linked_accounts" ("userId", "platform", "platformId")
SELECT "id", CASE WHEN length("telegramId") >= 17 THEN 'discord' ELSE 'telegram' END, "telegramId"
FROM "users";
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "telegramId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "linked_accounts" ADD CONSTRAINT "linked_accounts_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;