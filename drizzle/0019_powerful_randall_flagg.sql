CREATE INDEX "subcategories_category_idx" ON "subcategories" USING btree ("categoryId");--> statement-breakpoint
CREATE INDEX "promo_code_redemptions_code_idx" ON "promo_code_redemptions" USING btree ("promoCodeId");--> statement-breakpoint
CREATE INDEX "bought_items_item_idx" ON "bought_items" USING btree ("itemId");