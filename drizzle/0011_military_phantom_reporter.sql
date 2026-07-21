CREATE TABLE "subcategory_goals" (
	"userId" integer NOT NULL,
	"subcategoryId" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "subcategory_goals_userId_subcategoryId_pk" PRIMARY KEY("userId","subcategoryId")
);
--> statement-breakpoint
ALTER TABLE "subcategory_goals" ADD CONSTRAINT "subcategory_goals_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subcategory_goals" ADD CONSTRAINT "subcategory_goals_subcategoryId_subcategories_id_fk" FOREIGN KEY ("subcategoryId") REFERENCES "public"."subcategories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subcategory_goals_sub_idx" ON "subcategory_goals" USING btree ("subcategoryId");