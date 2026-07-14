import { t } from '$lib/trpc/t';
import { TRPCError } from '@trpc/server';

export const adminProcedure = t.procedure.use(({ ctx, next }) => {
	if (!ctx.session) throw new TRPCError({ code: 'UNAUTHORIZED' });
	return next({ ctx });
});
