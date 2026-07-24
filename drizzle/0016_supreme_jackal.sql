ALTER TABLE "card_customization_submissions" DROP CONSTRAINT "card_customization_submissions_reviewerUserId_users_id_fk";
--> statement-breakpoint
ALTER TABLE "card_customization_submissions" DROP COLUMN "reviewerUserId";--> statement-breakpoint
ALTER TABLE "card_customization_submissions" DROP COLUMN "reviewedAt";