ALTER TABLE "audit_logs" ADD COLUMN "revertedAt" timestamp;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "revertedByAdminId" integer;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_revertedByAdminId_users_id_fk" FOREIGN KEY ("revertedByAdminId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
