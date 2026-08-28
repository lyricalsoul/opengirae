import { DBOS } from '@girae/common/dbos';
import { info } from '@girae/common/logger';
import { startHealthServer } from '@girae/common/health';
import './services'
import './loaders/hooks'
import { CronJobs } from './cron'

startHealthServer(parseInt(process.env.PORT ?? '8080', 10))

DBOS.setConfig({
    name: 'openGIRAÊ',
    systemDatabaseUrl: process.env.DBOS_SYSTEM_DATABASE_URL!,
    systemDatabasePoolSize: 10
})

await DBOS.launch()

await import('./worker')

await DBOS.applySchedules([
    {
        scheduleName: 'daily-midnight-reset',
        workflowFn: CronJobs.runMidnightReset,
        schedule: '0 3 * * *',
    },
    {
        scheduleName: 'hourly-draw-decay',
        workflowFn: CronJobs.runHourlyDrawDecay,
        schedule: '0 * * * *',
    },
    {
        scheduleName: 'storefront-refresh',
        workflowFn: CronJobs.runStorefrontRefresh,
        schedule: '0 */6 * * *',
    },
    {
        scheduleName: 'dbos-system-db-cleanup',
        workflowFn: CronJobs.runDbosSystemDbCleanup,
        schedule: '0 5 * * *',
    },
    {
        scheduleName: 'auction-sweep',
        workflowFn: CronJobs.runAuctionSweep,
        schedule: '* * * * *',
    }
])

info('commandeer', 'Command worker is ready');