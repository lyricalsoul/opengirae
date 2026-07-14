import { t } from '$lib/trpc/t';
import { adminProcedure } from '$lib/trpc/middleware/auth';
import { StatsDB } from '@girae/database/stats';

export const statsRouter = t.router({
	overview: adminProcedure.query(() => StatsDB.getOverview())
});
