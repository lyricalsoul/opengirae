import { DBOS } from '@girae/common/dbos';
import { info } from '@girae/common/logger';
import './services'
import './worker'

DBOS.setConfig({
    name: 'openGIRAÊ',
    systemDatabaseUrl: process.env.DBOS_SYSTEM_DATABASE_URL!,
    systemDatabasePoolSize: 5
})

await DBOS.launch()

info('commandeer', 'Command worker is ready');