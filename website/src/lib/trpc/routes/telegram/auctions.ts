import { z } from 'zod';
import { telegramProcedure, requireUser } from '$lib/trpc/middleware/telegramAuth';
import { t } from '$lib/trpc/t';
import { AuctionsDB } from '@girae/database/auctions';

export const telegramAuctionsRouter = t.router({
	list: telegramProcedure
		.input(z.object({ query: z.string().optional(), categoryId: z.number().int().positive().optional(), sortBy: z.enum(['recent', 'urgency']).optional(), limit: z.number().int().positive().max(100).optional(), offset: z.number().int().nonnegative().optional() }).optional())
		.query(({ input }) => AuctionsDB.listActiveAuctions(input ?? {})),

	byCategory: telegramProcedure
		.input(z.object({ query: z.string().optional(), limit: z.number().int().positive().max(50).optional(), offset: z.number().int().nonnegative().optional() }).optional())
		.query(({ input }) => AuctionsDB.listActiveAuctionsByCategory(input ?? {})),

	// "Meus leilões" - the caller's own listings across every status, not just active.
	mine: telegramProcedure
		.input(z.object({ limit: z.number().int().positive().max(50).optional(), offset: z.number().int().nonnegative().optional() }).optional())
		.query(async ({ ctx, input }) => {
			const user = await requireUser(ctx.tgUser.id.toString());
			return AuctionsDB.listActiveAuctions({ ...input, status: null, sellerId: user.id });
		}),

	// "A licitar" - isLeading is computed server-side so the client never needs the other bidder's raw id.
	bidding: telegramProcedure
		.input(z.object({ limit: z.number().int().positive().max(50).optional(), offset: z.number().int().nonnegative().optional() }).optional())
		.query(async ({ ctx, input }) => {
			const user = await requireUser(ctx.tgUser.id.toString());
			const result = await AuctionsDB.listActiveAuctions({ ...input, status: null, biddingUserId: user.id });
			return { ...result, rows: result.rows.map(r => ({ ...r, isLeading: r.auction.currentBidderId === user.id })) };
		}),

	get: telegramProcedure
		.input(z.object({ id: z.number().int().positive() }))
		.query(async ({ input }) => {
			const [details, bids] = await Promise.all([AuctionsDB.getAuction(input.id), AuctionsDB.getRecentBids(input.id)]);
			return details ? { ...details, bids } : null;
		}),

	create: telegramProcedure
		.input(z.object({ cardId: z.number().int().positive() }))
		.mutation(async ({ ctx, input }) => {
			const user = await requireUser(ctx.tgUser.id.toString());
			return AuctionsDB.createAuction(user.id, input.cardId);
		}),

	previewTerms: telegramProcedure
		.input(z.object({ cardId: z.number().int().positive() }))
		.query(({ input }) => AuctionsDB.previewAuctionTerms(input.cardId)),

	bid: telegramProcedure
		.input(z.object({ auctionId: z.number().int().positive(), amount: z.number().int().positive() }))
		.mutation(async ({ ctx, input }) => {
			const user = await requireUser(ctx.tgUser.id.toString());
			return AuctionsDB.placeBid(input.auctionId, user.id, input.amount);
		}),

	cancel: telegramProcedure
		.input(z.object({ auctionId: z.number().int().positive() }))
		.mutation(async ({ ctx, input }) => {
			const user = await requireUser(ctx.tgUser.id.toString());
			return AuctionsDB.cancelAuction(input.auctionId, user.id, { asAdmin: false });
		}),
});
