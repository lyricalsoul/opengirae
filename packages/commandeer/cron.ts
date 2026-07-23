import { DBOS } from '@dbos-inc/dbos-sdk'
import { UsersDB } from '@girae/database/users'
import { EconomyDB } from '@girae/database/economy'
import { info } from '@girae/common/logger'

export class CronJobs {
  @DBOS.workflow()
  static async runMidnightReset(schedTime: Date) {
    info('cron', `Running midnight reset for ${schedTime.toISOString()}`)
    await UsersDB.resetMidnightStats()
  }

  @DBOS.workflow()
  static async runHourlyDrawDecay(schedTime: Date) {
    info('cron', `Running hourly draw decay for ${schedTime.toISOString()}`)
    await UsersDB.decrementUsedDraws(2)
    await EconomyDB.syncAllocations()
  }
}
