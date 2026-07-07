import { DBOS } from '@dbos-inc/dbos-sdk'
import { UsersDB } from '@girae/database/users'
import { info } from '@girae/common/logger'

export class CronJobs {
  @DBOS.workflow()
  static async runMidnightReset(schedTime: Date) {
    info('cron', `Running midnight reset for ${schedTime.toISOString()}`)
    await UsersDB.resetMidnightStats()
  }
}
