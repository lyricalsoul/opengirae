import { DBOS } from '@dbos-inc/dbos-sdk'
import { Pool } from 'pg'
import { UsersDB } from '@girae/database/users'
import { EconomyDB } from '@girae/database/economy'
import { StorefrontDB } from '@girae/database/storefront'
import { CardsDB } from '@girae/database/cards'
import { VanitiesDB } from '@girae/database/vanities'
import { AuctionsDB } from '@girae/database/auctions'
import { DiscotecaDB } from '@girae/database/discoteca'
import { info } from '@girae/common/logger'
import { announceNewSubcategory, announceNewCardsGroup, groupCardsBySubcategory } from './services/cards/contentAnnouncements'
import { announceNewVanityItems } from './services/vanity/vanityAnnouncements'
import { announceNewArtist, announceNewEntriesGroup, groupEntriesByArtist } from './services/discoteca/discotecaAnnouncements'
import { sendOutbidNotifications, sendResolutionNotifications } from './services/auctions/notifications'

const ANNOUNCEMENT_LOOKBACK_MS = 60 * 60 * 1000

const dbosSystemPool = new Pool({ connectionString: process.env.DBOS_SYSTEM_DATABASE_URL })
const DBOS_GC_CUTOFF_MS = 3 * 24 * 60 * 60 * 1000

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

  @DBOS.workflow()
  static async runStorefrontRefresh(schedTime: Date) {
    info('cron', `Running storefront refresh for ${schedTime.toISOString()}`)
    await StorefrontDB.refresh()
    await CronJobs.announceNewContent(schedTime)
  }

  // piggybacks on the storefront-refresh 6h tick (see 04-dbos.md) rather than registering a second schedule.
  static async announceNewContent(schedTime: Date) {
    const chatId = process.env.ANNOUNCEMENT_CHAT_ID
    if (!chatId) return // optional infra, degrades gracefully like Ditto/S3/Mistral

    const threadId = process.env.ANNOUNCEMENT_THREAD_ID
    // schedTime, not `new Date()` - stays deterministic across a DBOS replay of this workflow.
    const cutoff = new Date(schedTime.getTime() - ANNOUNCEMENT_LOOKBACK_MS)

    const newSubcategories = await CardsDB.claimUnannouncedSubcategories(cutoff)
    for (const subcategory of newSubcategories) {
      await announceNewSubcategory(chatId, threadId, subcategory)
    }

    const newCards = await CardsDB.claimUnannouncedCards(cutoff)
    for (const group of groupCardsBySubcategory(newCards)) {
      await announceNewCardsGroup(chatId, threadId, group, schedTime)
    }

    for (const type of ['background', 'sticker'] as const) {
      const claimed = await VanitiesDB.claimUnannouncedStoreItems(type, schedTime, cutoff)
      if (claimed.length > 0) await announceNewVanityItems(chatId, threadId, type, schedTime)
    }

    const newArtists = await DiscotecaDB.claimUnannouncedArtists(cutoff)
    for (const artist of newArtists) {
      await announceNewArtist(chatId, threadId, artist)
    }

    const newEntries = await DiscotecaDB.claimUnannouncedEntries(cutoff)
    for (const group of groupEntriesByArtist(newEntries)) {
      await announceNewEntriesGroup(chatId, threadId, group, schedTime)
    }
  }

  @DBOS.workflow()
  static async runAuctionSweep(schedTime: Date) {
    await AuctionsDB.sweepExpiredAuctions(schedTime)
    await sendOutbidNotifications()
    await sendResolutionNotifications()
  }

  @DBOS.workflow()
  static async runDbosSystemDbCleanup(schedTime: Date) {
    const cutoff = schedTime.getTime() - DBOS_GC_CUTOFF_MS
    const result = await dbosSystemPool.query(
      `DELETE FROM dbos.workflow_status WHERE created_at < $1 AND status NOT IN ('PENDING', 'ENQUEUED', 'DELAYED')`,
      [cutoff],
    )
    info('cron', `Cleaned up ${result.rowCount} old DBOS workflow_status rows (and their cascaded operation_outputs)`)
  }
}
