import { t } from '$lib/trpc/t';
import { z } from 'zod';
import { adminProcedure } from '$lib/trpc/middleware/auth';
import { AuctionsDB } from '@girae/database/auctions';

const AUCTION_STATUS = z.enum(['active', 'sold', 'expired', 'cancelled']);

export const auctionsRouter = t.router({
	// status omitted lists every state - the admin view, unlike the mini app's, isn't limited to 'active'.
	list: adminProcedure
		.input(z.object({ query: z.string().optional(), status: AUCTION_STATUS.optional(), limit: z.number().int().positive().max(100).optional(), offset: z.number().int().nonnegative().optional() }).optional())
		.query(({ input }) => AuctionsDB.listActiveAuctions({ ...input, status: input?.status ?? null })),

	get: adminProcedure
		.input(z.object({ id: z.number().int().positive() }))
		.query(({ input }) => AuctionsDB.getAuction(input.id)),

	forceClose: adminProcedure
		.input(z.object({ id: z.number().int().positive() }))
		.mutation(({ input }) => AuctionsDB.forceCloseAuction(input.id)),

	// requestedBy is unused by the asAdmin branch - the admin site's session isn't a game users.id, so there's nothing meaningful to pass here.
	cancel: adminProcedure
		.input(z.object({ id: z.number().int().positive() }))
		.mutation(({ input }) => AuctionsDB.cancelAuction(input.id, 0, { asAdmin: true })),
});
