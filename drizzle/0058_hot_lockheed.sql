CREATE TABLE "discoteca_wishlist" (
	"userId" integer NOT NULL,
	"entryId" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "discoteca_wishlist_userId_entryId_pk" PRIMARY KEY("userId","entryId")
);
--> statement-breakpoint
ALTER TABLE "discoteca_wishlist" ADD CONSTRAINT "discoteca_wishlist_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discoteca_wishlist" ADD CONSTRAINT "discoteca_wishlist_entryId_discoteca_entries_id_fk" FOREIGN KEY ("entryId") REFERENCES "public"."discoteca_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discoteca_wishlist_entry_idx" ON "discoteca_wishlist" USING btree ("entryId");