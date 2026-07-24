CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "card_draw_history_card_idx" ON "card_draw_history" USING btree ("cardId");--> statement-breakpoint
CREATE INDEX "card_draw_history_drawn_at_idx" ON "card_draw_history" USING btree ("drawnAt");--> statement-breakpoint
CREATE INDEX "cards_name_trgm_idx" ON "cards" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "user_cards_card_idx" ON "user_cards" USING btree ("cardId");