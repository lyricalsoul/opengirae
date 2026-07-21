import { DBOS } from '@girae/common/dbos';
import { info } from '@girae/common/logger';
import { startHealthServer } from '@girae/common/health';
import './services'
import { CronJobs } from './cron'

startHealthServer(parseInt(process.env.PORT ?? '8080', 10))

DBOS.setConfig({
    name: 'openGIRAÊ',
    systemDatabaseUrl: process.env.DBOS_SYSTEM_DATABASE_URL!,
    systemDatabasePoolSize: 5
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
    }
])

info('commandeer', 'Command worker is ready');