import { t } from '$lib/trpc/t';
import { adminProcedure } from '$lib/trpc/middleware/auth';
import { getOverviewCached } from '@girae/common/cache/stats';

export const statsRouter = t.router({
	overview: adminProcedure.query(() => getOverviewCached())
});
